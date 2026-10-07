import { describe, expect, it, vi } from 'vitest';
import type { AIProviderInfo, AIStreamEvent } from '@/shared/ai';
import {
  createContinuationService,
  resolveContinuationProvider,
  type ContinuationDeps,
  type WritingSources,
} from '@/render/utils/continuationService';
import { createAIStreamRouter } from '@/render/utils/aiStreamRouter';
import type {
  ContinuationContextSummary,
  ContinuationHandlers,
} from '@/render/components/TextEditor/assist/types';

function provider(id: string, patch: Partial<AIProviderInfo> = {}): AIProviderInfo {
  return {
    id,
    kind: 'text',
    label: id === 'grok' ? 'xAI Grok' : id === 'openai-compatible' ? '默认 AI' : id,
    description: '',
    defaultBaseUrl: '',
    defaultModel: '',
    models: [],
    configured: true,
    secureStorage: true,
    enabled: true,
    baseUrl: '',
    model: '',
    ...patch,
  };
}

describe('resolveContinuationProvider', () => {
  it('Grok 已配置时优先 Grok，否则默认 AI；指定的服务可用时用指定的', () => {
    const all = [provider('openai-compatible'), provider('grok')];
    expect(resolveContinuationProvider(all)).toEqual({ providerId: 'grok', label: 'xAI Grok' });
    expect(resolveContinuationProvider(all, 'openai-compatible')).toEqual({
      providerId: undefined,
      label: '默认 AI',
    });
    expect(
      resolveContinuationProvider([
        provider('openai-compatible'),
        provider('grok', { configured: false }),
      ])
    ).toEqual({ providerId: undefined, label: '默认 AI' });
  });

  it('都没有配置 / 未启用 / 视频服务不算', () => {
    expect(
      resolveContinuationProvider([
        provider('openai-compatible', { enabled: false }),
        provider('grok', { configured: false }),
        provider('minimax-video', { kind: 'video' }),
      ])
    ).toBeNull();
  });
});

const SOURCES: WritingSources = {
  chapterTitle: '001-启程',
  outline: ['林舟离开青石镇'],
  characters: [{ name: '林舟', aliases: ['阿舟'], summary: '主角', status: '伤势：左臂旧伤' }],
  growth: [{ name: '林舟', level: 4, summary: '属性：力量 12' }],
  rules: ['等级上限 20'],
};

function setup(overrides: Partial<ContinuationDeps> = {}) {
  let emit: ((event: unknown, payload: AIStreamEvent) => void) | null = null;
  const router = createAIStreamRouter((listener) => {
    emit = listener;
    return () => {
      emit = null;
    };
  });
  const startStream = vi.fn(async () => {
    // 片段在 streamId 返回之前就到达：路由需要暂存
    emit?.(null, { streamId: 's1', type: 'delta', text: '林舟拔剑。' });
    return { ok: true as const, data: { streamId: 's1' } };
  });
  const cancelStream = vi.fn();
  const deps: ContinuationDeps = {
    loadSources: vi.fn(async () => SOURCES),
    listProviders: vi.fn(async () => [provider('openai-compatible'), provider('grok')]),
    prepareStream: () => router.prepare(),
    startStream,
    cancelStream,
    subscribe: (id, listener) => router.subscribe(id, listener),
    ...overrides,
  };
  const handlers = {
    onContext: vi.fn<(summary: ContinuationContextSummary) => void>(),
    onText: vi.fn<(text: string) => void>(),
    onDone: vi.fn(),
    onError: vi.fn(),
  } satisfies ContinuationHandlers;
  const send = (payload: AIStreamEvent) => emit?.(null, payload);
  return { deps, handlers, send, startStream, cancelStream };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createContinuationService', () => {
  it('组装上下文 → 用 Grok 流式续写；去掉复述的前文；上下文摘要可展开', async () => {
    const { deps, handlers, send, startStream } = setup();
    const service = createContinuationService(deps);
    service.start(
      {
        docText: '林舟拔剑。',
        cursor: 5,
        filePath: '/w/001-启程.md',
        options: { length: 'paragraph', direction: 'conflict', followOutline: true },
      },
      handlers
    );
    await flush();
    expect(deps.loadSources).toHaveBeenCalledWith('/w/001-启程.md');
    const payload = startStream.mock.calls[0][0];
    expect(payload.providerId).toBe('grok');
    expect(payload.maxTokens).toBeGreaterThan(64);
    expect(payload.temperature).toBe(1);
    const prompt = payload.messages?.[1]?.content ?? '';
    expect(prompt).toContain('【核心规则】');
    expect(prompt).toContain('林舟 Lv.4');
    expect(prompt).toContain('【本章章纲】');
    expect(prompt).toContain('制造新的冲突');

    const summary = handlers.onContext.mock.calls[0][0];
    expect(summary.providerLabel).toBe('xAI Grok');
    expect(summary.sections.map((section) => section.label)).toEqual(
      expect.arrayContaining(['核心规则', '本章章纲', '出场人物', '成长档案', '前文'])
    );
    expect(summary.usedTokens).toBeLessThanOrEqual(summary.budget);

    // 早到的片段（复述了前文）被暂存并清理
    expect(handlers.onText).toHaveBeenLastCalledWith('');
    send({ streamId: 's1', type: 'delta', text: '雾气翻涌。' });
    expect(handlers.onText).toHaveBeenLastCalledWith('雾气翻涌。');
    send({ streamId: 'other', type: 'delta', text: '别的流' });
    send({ streamId: 's1', type: 'done' });
    expect(handlers.onDone).toHaveBeenCalledOnce();
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('没有可用服务 → not-configured，不发起请求', async () => {
    const { deps, handlers, startStream } = setup({
      listProviders: async () => [provider('grok', { configured: false })],
    });
    createContinuationService(deps).start(
      {
        docText: '',
        cursor: 0,
        filePath: null,
        options: { length: 'sentence', direction: 'continue', followOutline: true },
      },
      handlers
    );
    await flush();
    expect(startStream).not.toHaveBeenCalled();
    expect(handlers.onError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'not-configured' })
    );
  });

  it('启动失败（鉴权 / 额度）原样交给界面；资料读取失败不影响续写', async () => {
    const { deps, handlers } = setup({
      loadSources: async () => {
        throw new Error('db closed');
      },
      startStream: async () => ({
        ok: false as const,
        error: { kind: 'quota' as const, message: 'insufficient balance', retryable: false },
      }),
    });
    createContinuationService(deps).start(
      {
        docText: '开头',
        cursor: 2,
        filePath: null,
        options: { length: 'sentence', direction: 'continue', followOutline: true },
      },
      handlers
    );
    await flush();
    expect(handlers.onContext).toHaveBeenCalled();
    expect(handlers.onError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'quota' }));
  });

  it('取消：中止主进程的流，之后的片段不再回调', async () => {
    const { deps, handlers, send, cancelStream } = setup();
    const cancel = createContinuationService(deps).start(
      {
        docText: '开头',
        cursor: 2,
        filePath: null,
        options: { length: 'sentence', direction: 'continue', followOutline: true },
      },
      handlers
    );
    await flush();
    cancel();
    cancel();
    expect(cancelStream).toHaveBeenCalledTimes(1);
    expect(cancelStream).toHaveBeenCalledWith('s1');
    const calls = handlers.onText.mock.calls.length;
    send({ streamId: 's1', type: 'delta', text: '迟到' });
    expect(handlers.onText.mock.calls.length).toBe(calls);
  });

  it('在拿到 streamId 之前取消：拿到后立即中止', async () => {
    const { deps, handlers, cancelStream } = setup();
    const cancel = createContinuationService(deps).start(
      {
        docText: '开头',
        cursor: 2,
        filePath: null,
        options: { length: 'sentence', direction: 'continue', followOutline: true },
      },
      handlers
    );
    cancel();
    await flush();
    expect(handlers.onContext).not.toHaveBeenCalled();
    expect(cancelStream).not.toHaveBeenCalled();
  });

  it('流式错误（内容安全）交给界面', async () => {
    const { deps, handlers, send } = setup();
    createContinuationService(deps).start(
      {
        docText: '开头',
        cursor: 2,
        filePath: null,
        options: { length: 'sentence', direction: 'continue', followOutline: true },
      },
      handlers
    );
    await flush();
    send({
      streamId: 's1',
      type: 'error',
      error: { kind: 'content-safety', message: 'blocked', retryable: false },
    });
    expect(handlers.onError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'content-safety' })
    );
  });
});

describe('createAIStreamRouter', () => {
  it('订阅前到达的事件被暂存并补发；退订后不再分发', () => {
    let emit: ((event: unknown, payload: AIStreamEvent) => void) | null = null;
    const dispose = vi.fn();
    const router = createAIStreamRouter((listener) => {
      emit = listener;
      return dispose;
    });
    router.prepare();
    router.prepare();
    emit!(null, { streamId: 'a', type: 'delta', text: '1' });
    const seen: string[] = [];
    const off = router.subscribe('a', (event) => seen.push(event.type));
    emit!(null, { streamId: 'a', type: 'done' });
    off();
    emit!(null, { streamId: 'a', type: 'delta', text: '2' });
    expect(seen).toEqual(['delta', 'done']);
    router.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
