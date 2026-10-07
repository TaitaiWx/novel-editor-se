/**
 * ne ai / ne video 共用：从环境变量取得 Provider 配置、AI 错误转换、流式收集
 *
 * CLI 不保存密钥（没有 safeStorage）：
 *   NOVEL_EDITOR_<PROVIDER>_API_KEY   必填，例如 NOVEL_EDITOR_GROK_API_KEY
 *   NOVEL_EDITOR_<PROVIDER>_BASE_URL  可选，覆盖默认接口地址（自建代理 / 本地 mock）
 *   NOVEL_EDITOR_<PROVIDER>_MODEL     可选，覆盖默认模型（--model 优先）
 * 没有 Key 时命令只输出提示词与期望的 JSON 结构，交给驱动 CLI 的 AI agent 执行。
 */
import {
  AI_ERROR_HINTS,
  createDefaultRegistry,
  isAIError,
  providerEnvKey,
  type ProviderDescriptor,
  type StreamChunk,
  type TextProvider,
  type TokenUsage,
} from '@novel-editor/ai';
import { CliError } from '../errors';
import type { CliContext, OptionSpec } from '../types';

export const registry = createDefaultRegistry();
export const TEXT_PROVIDER_IDS = registry.list('text').map((item) => item.id);
export const DEFAULT_CLI_TEXT_PROVIDER = 'grok';

export const PROVIDER_OPTION: OptionSpec = {
  name: 'provider',
  short: 'p',
  type: 'string',
  valueName: 'id',
  choices: TEXT_PROVIDER_IDS,
  default: DEFAULT_CLI_TEXT_PROVIDER,
  description: `文本服务（Key 读取环境变量 NOVEL_EDITOR_<PROVIDER>_API_KEY，例如 ${providerEnvKey('grok')}）`,
};
export const MODEL_OPTION: OptionSpec = {
  name: 'model',
  short: 'm',
  type: 'string',
  valueName: 'name',
  description: '覆盖默认模型',
};
export const PROMPT_ONLY_OPTION: OptionSpec = {
  name: 'prompt-only',
  type: 'boolean',
  description: '只输出提示词（不调用 AI，交给 AI agent 执行）',
};

export function envSuffix(providerId: string, suffix: 'API_KEY' | 'BASE_URL' | 'MODEL'): string {
  return providerEnvKey(providerId).replace(/_API_KEY$/, `_${suffix}`);
}

export interface CliProviderConfig {
  descriptor: ProviderDescriptor;
  envKey: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export function resolveTextProviderConfig(
  ctx: CliContext,
  providerId: string,
  modelOverride?: string
): CliProviderConfig {
  const descriptor = registry.get(providerId);
  if (!descriptor || descriptor.kind !== 'text') {
    throw new CliError(
      'INVALID_ARGUMENT',
      `不是文本服务: ${providerId}`,
      `可选: ${TEXT_PROVIDER_IDS.join(' | ')}`
    );
  }
  const read = (name: string) => ctx.env[name]?.trim() || undefined;
  return {
    descriptor,
    envKey: providerEnvKey(providerId),
    apiKey: read(providerEnvKey(providerId)),
    baseUrl: read(envSuffix(providerId, 'BASE_URL')),
    model: modelOverride?.trim() || read(envSuffix(providerId, 'MODEL')),
  };
}

export function createTextProvider(config: CliProviderConfig): TextProvider {
  return registry.createText(config.descriptor.id, {
    apiKey: config.apiKey ?? '',
    baseUrl: config.baseUrl,
    model: config.model,
  });
}

/** AIError → CliError（保留类别，附带下一步建议） */
export function toCliError(error: unknown): unknown {
  if (!isAIError(error)) return error;
  const hint =
    error.kind === 'auth' || error.kind === 'not-configured'
      ? `检查环境变量中的 API Key（${error.providerId ? providerEnvKey(error.providerId) : 'NOVEL_EDITOR_<PROVIDER>_API_KEY'}）`
      : AI_ERROR_HINTS[error.kind];
  return new CliError('AI_ERROR', `[${error.kind}] ${error.message}`, hint);
}

export interface StreamOutcome {
  text: string;
  finishReason?: string;
  usage?: TokenUsage;
  model?: string;
  streamed: boolean;
}

/**
 * 流式调用：人类可读模式下边生成边写到 stdout；--json / daemon 下只收集。
 * 前台运行时 Ctrl+C 取消请求（已输出的部分保留）。
 */
export async function runStream(
  ctx: CliContext,
  source: (signal: AbortSignal) => AsyncIterable<StreamChunk>
): Promise<StreamOutcome> {
  const controller = new AbortController();
  const onSigint = () => controller.abort();
  const live = ctx.stream;
  if (!ctx.inDaemon) process.once('SIGINT', onSigint);
  let text = '';
  let outcome: Omit<StreamOutcome, 'text' | 'streamed'> = {};
  try {
    for await (const chunk of source(controller.signal)) {
      if (chunk.type === 'delta') {
        text += chunk.text;
        live?.(chunk.text);
      } else {
        outcome = { finishReason: chunk.finishReason, usage: chunk.usage, model: chunk.model };
      }
    }
  } catch (error) {
    if (live && text) live('\n');
    throw toCliError(error);
  } finally {
    if (!ctx.inDaemon) process.removeListener('SIGINT', onSigint);
  }
  if (live && text && !text.endsWith('\n')) live('\n');
  return { text, ...outcome, streamed: Boolean(live) };
}
