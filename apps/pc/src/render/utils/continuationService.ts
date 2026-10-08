/**
 * 续写服务（GUI）：组装上下文 → 选择服务 → ai-stream-start → 按片段回调清理后的续写文本
 *
 * 上下文组装与提示词和 CLI `ne ai continue` 共用 @novel-editor/ai；依赖全部注入，便于用假 IPC 测试。
 */
import {
  assembleWritingContext,
  type AssembledContext,
  type ContextCharacter,
  type ContextGrowth,
} from '@novel-editor/ai/context';
import { buildContinuationPrompt, cleanContinuationOutput } from '@novel-editor/ai/prompts';
import type {
  AICompletePayload,
  AIIpcResult,
  AIProviderInfo,
  AIStreamEvent,
  SerializedAIError,
} from '@/shared/ai';
import { providerIdForRequest, resolveModelChoice } from './textProviders';
import type {
  ContinuationContextSummary,
  ContinuationService,
} from '../components/TextEditor/assist/types';

/** 服务没有填写上下文长度时的续写上下文预算（tokens） */
export const CONTINUATION_BUDGET = 6000;
const MIN_CONTINUATION_BUDGET = 1000;
const MAX_CONTINUATION_BUDGET = 32000;

/**
 * 续写的上下文预算：按所选服务的「上下文长度」决定——取 5%（128K 模型约 6400，与旧版 6000 接近），
 * 夹在 1000–32000 之间，且不超过上下文长度的一半（给系统提示与回复留空间）；没填时为 CONTINUATION_BUDGET
 */
export function continuationBudget(contextTokens: number | undefined): number {
  if (typeof contextTokens !== 'number' || !Number.isFinite(contextTokens) || contextTokens <= 0) {
    return CONTINUATION_BUDGET;
  }
  const scaled = Math.round(contextTokens * 0.05);
  const clamped = Math.min(MAX_CONTINUATION_BUDGET, Math.max(MIN_CONTINUATION_BUDGET, scaled));
  return Math.max(1, Math.min(clamped, Math.floor(contextTokens / 2)));
}

/** 续写需要的作品资料（当前章章纲、人物、成长档案、核心规则） */
export interface WritingSources {
  chapterTitle?: string;
  outline: string[];
  characters: ContextCharacter[];
  growth: ContextGrowth[];
  rules: string[];
}

export const EMPTY_WRITING_SOURCES: WritingSources = {
  outline: [],
  characters: [],
  growth: [],
  rules: [],
};

export interface ContinuationDeps {
  loadSources: (filePath: string | null) => Promise<WritingSources>;
  listProviders: () => Promise<AIProviderInfo[]>;
  /** 发起流之前调用（开始监听片段） */
  prepareStream?: () => void;
  startStream: (payload: AICompletePayload) => Promise<AIIpcResult<{ streamId: string }>>;
  cancelStream: (streamId: string) => void;
  subscribe: (streamId: string, listener: (event: AIStreamEvent) => void) => () => void;
}

export interface ResolvedProvider {
  /** undefined 表示默认写作 AI（由主进程解析） */
  providerId: string | undefined;
  label: string;
  /** 服务的上下文长度（决定续写的上下文预算） */
  contextTokens?: number;
}

/** 选择续写模型：指定的模型（可用时）> 默认文本模型 > 第一个可用的文本模型；都没有时返回 null */
export function resolveContinuationProvider(
  providers: readonly AIProviderInfo[],
  preferred?: string
): ResolvedProvider | null {
  const chosen = resolveModelChoice(providers, 'text', preferred);
  return chosen
    ? {
        providerId: providerIdForRequest(providers, chosen),
        label: chosen.label,
        ...(typeof chosen.contextTokens === 'number'
          ? { contextTokens: chosen.contextTokens }
          : {}),
      }
    : null;
}

export function summarizeContext(
  context: AssembledContext,
  providerLabel: string
): ContinuationContextSummary {
  return {
    budget: context.budget,
    usedTokens: context.usedTokens,
    providerLabel,
    sections: context.sections.map((section) => ({
      key: section.key,
      label: section.label,
      tokens: section.tokens,
      truncated: section.truncated,
      omittedItems: section.omittedItems,
      text: section.text,
    })),
  };
}

function toError(error: unknown): SerializedAIError {
  return {
    kind: 'unknown',
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
}

export const NOT_CONFIGURED_ERROR: SerializedAIError = {
  kind: 'not-configured',
  message: '还没有可用的 AI 服务',
  retryable: false,
};

export function createContinuationService(deps: ContinuationDeps): ContinuationService {
  return {
    start(request, handlers) {
      let cancelled = false;
      let streamId: string | null = null;
      let unsubscribe: (() => void) | null = null;

      const run = async () => {
        const [sources, providers] = await Promise.all([
          deps.loadSources(request.filePath).catch(() => EMPTY_WRITING_SOURCES),
          deps.listProviders().catch(() => [] as AIProviderInfo[]),
        ]);
        if (cancelled) return;
        const provider = resolveContinuationProvider(providers, request.options.providerId);
        if (!provider) {
          handlers.onError(NOT_CONFIGURED_ERROR);
          return;
        }
        const context = assembleWritingContext({
          chapterText: request.docText,
          cursor: request.cursor,
          chapterTitle: sources.chapterTitle,
          outline: sources.outline,
          characters: sources.characters,
          growth: sources.growth,
          rules: sources.rules,
          budget: continuationBudget(provider.contextTokens),
        });
        const prompt = buildContinuationPrompt({
          context,
          length: request.options.length,
          direction: request.options.direction,
          followOutline: request.options.followOutline,
        });
        handlers.onContext(summarizeContext(context, provider.label));
        deps.prepareStream?.();
        const result = await deps.startStream({
          ...(provider.providerId ? { providerId: provider.providerId } : {}),
          messages: prompt.messages,
          maxTokens: prompt.maxTokens,
          temperature: prompt.temperature,
        });
        if (!result.ok) {
          if (!cancelled) handlers.onError(result.error);
          return;
        }
        streamId = result.data.streamId;
        if (cancelled) {
          deps.cancelStream(streamId);
          return;
        }
        let raw = '';
        unsubscribe = deps.subscribe(streamId, (event) => {
          if (cancelled) return;
          if (event.type === 'delta') {
            raw += event.text;
            handlers.onText(cleanContinuationOutput(raw, context.precedingText));
            return;
          }
          unsubscribe?.();
          unsubscribe = null;
          streamId = null;
          if (event.type === 'done') handlers.onDone();
          else handlers.onError(event.error);
        });
      };

      run().catch((error: unknown) => {
        if (!cancelled) handlers.onError(toError(error));
      });

      return () => {
        if (cancelled) return;
        cancelled = true;
        unsubscribe?.();
        unsubscribe = null;
        if (streamId) deps.cancelStream(streamId);
      };
    },
  };
}
