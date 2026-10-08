import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
const userData = mkdtempSync(path.join(os.tmpdir(), 'ne-ai-ipc-'));
const settingsRows = new Map<string, string>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
  },
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(`enc:${text}`),
    decryptString: (buffer: Buffer) => buffer.toString().slice(4),
  },
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('@novel-editor/store', () => ({
  isDatabaseReady: () => true,
  settingsOps: {
    get: (key: string) => settingsRows.get(key),
    set: (key: string, value: string) => void settingsRows.set(key, value),
  },
  statsOps: {},
  aiCacheOps: {},
}));

const runtime = await import('../../../src/main/ai/runtime');
const { registerAIProviderHandlers, AIStreamManager } = await import(
  '../../../src/main/handlers/ai-providers'
);
const { registerSettingsAndCacheHandlers } = await import(
  '../../../src/main/handlers/database/settings-cache'
);
const { invokeConfiguredAI, registerAIHandlers } = await import('../../../src/main/handlers/ai');
registerAIHandlers();
registerAIProviderHandlers();
registerSettingsAndCacheHandlers();

const SETTINGS_KEY = 'novel-editor:settings-center';
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

interface FakeSender {
  id: number;
  sent: Array<{ channel: string; payload: Record<string, unknown> }>;
  destroyed: boolean;
  destroyListeners: Array<() => void>;
  send(channel: string, payload: unknown): void;
  isDestroyed(): boolean;
  once(event: string, listener: () => void): void;
}

function fakeSender(id = 1): FakeSender {
  const sender: FakeSender = {
    id,
    sent: [],
    destroyed: false,
    destroyListeners: [],
    send(channel, payload) {
      sender.sent.push({ channel, payload: payload as Record<string, unknown> });
    },
    isDestroyed: () => sender.destroyed,
    once(_event, listener) {
      sender.destroyListeners.push(listener);
    },
  };
  return sender;
}

async function call<T>(channel: string, sender: FakeSender | null, ...args: unknown[]): Promise<T> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`未注册: ${channel}`);
  return (await handler({ sender: sender ?? fakeSender(99) }, ...args)) as T;
}

function sseBody(texts: string[], hang = false): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const text of texts) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`)
        );
      }
      if (!hang) {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });
}

async function waitForEvent(sender: FakeSender, type: string) {
  await vi.waitFor(() => {
    if (!sender.sent.some((item) => item.payload.type === type)) throw new Error('waiting');
  });
}

beforeEach(() => {
  settingsRows.clear();
  fetchMock.mockReset();
  rmSync(path.join(userData, 'ai-credentials.json'), { force: true });
  rmSync(path.join(userData, 'ai-providers.json'), { force: true });
});

afterAll(() => {
  rmSync(userData, { recursive: true, force: true });
});

describe('设置中心 Key：只写不读', () => {
  it('db-settings-set 转存 Key，db-settings-get 只返回 hasApiKey', async () => {
    await call(
      'db-settings-set',
      null,
      SETTINGS_KEY,
      JSON.stringify({
        ai: {
          apiKey: 'sk-gui',
          enabled: true,
          enabledExplicitlySet: true,
          baseUrl: 'https://llm.test/v1',
          model: 'm',
        },
      })
    );
    expect(settingsRows.get(SETTINGS_KEY)).not.toContain('sk-gui');
    expect(runtime.getCredentialStore().get('openai-compatible')).toBe('sk-gui');
    const read = JSON.parse(await call<string>('db-settings-get', null, SETTINGS_KEY));
    expect(read.ai).toMatchObject({ hasApiKey: true, model: 'm' });
    expect(read.ai.apiKey).toBeUndefined();
    // 其他键不受影响
    await call('db-settings-set', null, 'other', 'apiKey-like-value');
    expect(await call('db-settings-get', null, 'other')).toBe('apiKey-like-value');
  });

  it('打开数据库时迁移明文 Key，并通知监听者', () => {
    const listener = vi.fn();
    const dispose = runtime.onDatabaseOpened(listener);
    settingsRows.set(SETTINGS_KEY, JSON.stringify({ ai: { apiKey: 'sk-plain' } }));
    runtime.handleDatabaseOpened();
    expect(settingsRows.get(SETTINGS_KEY)).not.toContain('sk-plain');
    expect(runtime.getCredentialStore().get('openai-compatible')).toBe('sk-plain');
    expect(listener).toHaveBeenCalledTimes(1);
    dispose();
    runtime.onDatabaseOpened(() => {
      throw new Error('监听者出错不影响其他逻辑');
    });
    expect(() => runtime.handleDatabaseOpened()).not.toThrow();
  });

  it('invokeConfiguredAI 使用安全存储中的 Key', async () => {
    runtime.getCredentialStore().set('openai-compatible', 'sk-safe');
    settingsRows.set(
      SETTINGS_KEY,
      JSON.stringify({
        ai: {
          enabled: true,
          enabledExplicitlySet: true,
          baseUrl: 'https://llm.test/v1',
          model: 'm',
        },
      })
    );
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
    );
    expect(await invokeConfiguredAI({ prompt: 'p' })).toEqual({ ok: true, text: 'ok' });
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer sk-safe',
    });
    expect(await call('ai-request', null, { prompt: 'p' })).toEqual({ ok: true, text: 'ok' });
  });
});

describe('ai-providers-*', () => {
  it('list / set / get 不返回密钥', async () => {
    const set = await call<{ ok: boolean; data: Record<string, unknown> }>(
      'ai-providers-set',
      null,
      'grok',
      { apiKey: 'xai-secret', model: 'grok-3' }
    );
    expect(set).toMatchObject({
      ok: true,
      data: { id: 'grok', configured: true, model: 'grok-3' },
    });
    expect(JSON.stringify(set)).not.toContain('xai-secret');
    const list = await call<{ ok: boolean; data: unknown[] }>('ai-providers-list', null);
    expect(list.ok).toBe(true);
    expect(JSON.stringify(list)).not.toContain('xai-secret');
    expect(await call('ai-providers-get', null, 'grok')).toMatchObject({
      ok: true,
      data: { configured: true },
    });
    expect(await call('ai-providers-get', null, '../x')).toMatchObject({
      ok: false,
      error: { message: '未知的 AI 模型: ../x' },
    });
  });

  it('test：成功返回耗时，失败返回规范化错误', async () => {
    expect(await call('ai-providers-test', null, 'grok')).toMatchObject({
      ok: false,
      error: { kind: 'not-configured' },
    });
    runtime.getCredentialStore().set('grok', 'xai');
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ choices: [] })));
    expect(await call('ai-providers-test', null, 'grok')).toMatchObject({
      ok: true,
      data: { latencyMs: expect.any(Number) },
    });
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 })
    );
    expect(await call('ai-providers-test', null, 'grok')).toMatchObject({
      ok: false,
      error: { kind: 'auth', message: 'bad key', providerId: 'grok' },
    });
  });

  it('ai-complete', async () => {
    runtime.getCredentialStore().set('grok', 'xai');
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            model: 'grok-4',
            choices: [{ message: { content: '续写' }, finish_reason: 'stop' }],
          })
        )
    );
    expect(
      await call('ai-complete', null, {
        providerId: 'grok',
        messages: [{ role: 'user', content: 'x' }],
      })
    ).toEqual({ ok: true, data: { text: '续写', model: 'grok-4', finishReason: 'stop' } });
    expect(await call('ai-complete', null, { providerId: 'grok', messages: 'bad' })).toMatchObject({
      ok: false,
      error: { kind: 'bad-request' },
    });
  });
});

describe('ai-models-*（IPC）', () => {
  it('add / list / set-default / remove / test；校验输入；Key 不出现在返回值里', async () => {
    const added = await call<{ ok: boolean; data: Record<string, unknown> }>(
      'ai-models-add',
      null,
      {
        capability: 'text',
        vendor: 'openai-compatible',
        preset: 'qwen',
        baseUrl: 'https://qwen.test/v1',
        model: 'qwen-plus',
        apiKey: 'sk-qwen',
      }
    );
    expect(added).toMatchObject({
      ok: true,
      data: {
        id: 'text-1',
        capability: 'text',
        vendor: 'openai-compatible',
        label: '通义千问 · qwen-plus',
        providerLabel: '通义千问',
        configured: true,
      },
    });
    expect(JSON.stringify(added)).not.toContain('sk-qwen');
    for (const bad of [
      null,
      { capability: 'text', vendor: 'seedance-video', baseUrl: 'https://a.test' },
      { capability: 'music', vendor: 'grok' },
      { capability: 'text', vendor: 'openai-compatible' },
      { capability: 'text', vendor: 'openai-compatible', baseUrl: 'javascript:alert(1)' },
      { capability: 'text', vendor: 'openai-compatible', baseUrl: 'https://user:pw@a.test' },
      { capability: 'text', vendor: 'grok', label: 'x'.repeat(90) },
      { capability: 'text', vendor: 'grok', model: 'm'.repeat(201) },
      { capability: 'text', vendor: 'grok', preset: 'seedance' },
      { capability: 'video', vendor: 'seedance-video', reuseKeyFrom: 'text-1' },
    ]) {
      expect(await call('ai-models-add', null, bad)).toMatchObject({
        ok: false,
        error: { kind: 'bad-request' },
      });
    }
    // 沿用 Key：同一服务商 + 地址，主进程复制，返回值里没有 Key
    const second = await call<{ ok: boolean; data: Record<string, unknown> }>(
      'ai-models-add',
      null,
      {
        capability: 'text',
        vendor: 'openai-compatible',
        preset: 'qwen',
        baseUrl: 'https://qwen.test/v1/',
        model: 'qwen-max',
        reuseKeyFrom: 'text-1',
      }
    );
    expect(second).toMatchObject({ ok: true, data: { id: 'text-2', configured: true } });
    expect(JSON.stringify(second)).not.toContain('sk-qwen');
    expect(runtime.getCredentialStore().get('text-2')).toBe('sk-qwen');
    // 不同地址不能沿用
    expect(
      await call('ai-models-add', null, {
        capability: 'text',
        vendor: 'openai-compatible',
        baseUrl: 'https://evil.test/v1',
        reuseKeyFrom: 'text-1',
      })
    ).toMatchObject({ ok: false, error: { message: '只能沿用同一接口地址的 Key' } });

    const list = await call<{ ok: boolean; data: Array<Record<string, unknown>> }>(
      'ai-providers-list',
      null
    );
    expect(list.data.map((item) => item.id)).toEqual(['text-1', 'text-2']);
    expect(list.data.find((item) => item.isDefault)?.id).toBe('text-1');
    expect(JSON.stringify(list)).not.toContain('sk-qwen');

    // 设为默认：返回新列表；设置 JSON 注入默认文本模型摘要（含上下文长度）
    await call('ai-models-update', null, 'text-2', { contextTokens: 64_000, label: '通义 Max' });
    const setDefault = await call<{ ok: boolean; data: Array<Record<string, unknown>> }>(
      'ai-models-set-default',
      null,
      'text',
      'text-2'
    );
    expect(setDefault.ok).toBe(true);
    expect(setDefault.data.find((item) => item.isDefault)?.id).toBe('text-2');
    settingsRows.set(
      SETTINGS_KEY,
      JSON.stringify({ ai: { enabled: true, enabledExplicitlySet: true } })
    );
    const read = JSON.parse(await call<string>('db-settings-get', null, SETTINGS_KEY));
    expect(read.ai).toMatchObject({
      hasApiKey: true,
      defaultTextProviderId: 'text-2',
      defaultTextLabel: '通义 Max',
      defaultTextReady: true,
      contextTokens: 64_000,
    });

    // ai-request（成长推演、灵感等）走默认文本模型
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ choices: [{ message: { content: '通义回答' } }] }))
    );
    expect(await call('ai-request', null, { prompt: 'p' })).toEqual({ ok: true, text: '通义回答' });
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('https://qwen.test/v1/chat/completions');
    expect(JSON.parse(String((fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body)).model).toBe(
      'qwen-max'
    );
    expect(await call('ai-models-test', null, 'text-2')).toMatchObject({ ok: true });

    expect(await call('ai-models-set-default', null, 'video', 'text-1')).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('不是视频模型') },
    });
    expect(await call('ai-models-set-default', null, 'text', '../x')).toMatchObject({ ok: false });
    expect(await call('ai-models-update', null, '../x', {})).toMatchObject({ ok: false });

    // 删除：Key 一并删除；默认被删后回到第一个可用的
    expect(await call('ai-models-remove', null, '../x')).toMatchObject({ ok: false });
    expect(await call('ai-models-remove', null, 'text-2')).toEqual({
      ok: true,
      data: { removed: true },
    });
    expect(runtime.getCredentialStore().get('text-2')).toBeNull();
    const after = await call<{ ok: boolean; data: Array<Record<string, unknown>> }>(
      'ai-providers-list',
      null
    );
    expect(after.data.find((item) => item.isDefault)?.id).toBe('text-1');
    const reread = JSON.parse(await call<string>('db-settings-get', null, SETTINGS_KEY));
    expect(reread.ai.defaultTextProviderId).toBe('text-1');
  });
});

describe('ai-stream-*', () => {
  it('片段推送给发起的窗口，最后 done', async () => {
    runtime.getCredentialStore().set('grok', 'xai');
    fetchMock.mockImplementation(async () => new Response(sseBody(['第一', '句'])));
    const sender = fakeSender(1);
    const started = await call<{ ok: true; data: { streamId: string } }>(
      'ai-stream-start',
      sender,
      { providerId: 'grok', prompt: '续写' }
    );
    expect(started.ok).toBe(true);
    await waitForEvent(sender, 'done');
    expect(sender.sent.map((item) => item.channel)).toEqual([
      'ai-stream-event',
      'ai-stream-event',
      'ai-stream-event',
    ]);
    expect(sender.sent.map((item) => item.payload)).toEqual([
      { streamId: started.data.streamId, type: 'delta', text: '第一' },
      { streamId: started.data.streamId, type: 'delta', text: '句' },
      { streamId: started.data.streamId, type: 'done', finishReason: undefined, model: undefined },
    ]);
  });

  it('未配置时同步返回错误；HTTP 错误通过 error 事件推送', async () => {
    const sender = fakeSender(2);
    expect(
      await call('ai-stream-start', sender, { providerId: 'grok', prompt: 'x' })
    ).toMatchObject({ ok: false, error: { kind: 'not-configured' } });
    runtime.getCredentialStore().set('grok', 'xai');
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: { message: 'content policy' } }), { status: 400 })
    );
    await call('ai-stream-start', sender, { providerId: 'grok', prompt: 'x' });
    await waitForEvent(sender, 'error');
    expect(sender.sent.at(-1)?.payload).toMatchObject({
      type: 'error',
      error: { kind: 'content-safety' },
    });
  });

  it('取消：只能取消自己的流；窗口关闭时自动取消', async () => {
    runtime.getCredentialStore().set('grok', 'xai');
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = sseBody(['a'], true);
      init.signal?.addEventListener('abort', () => undefined);
      return new Response(body);
    });
    const sender = fakeSender(3);
    const started = await call<{ ok: true; data: { streamId: string } }>(
      'ai-stream-start',
      sender,
      { providerId: 'grok', prompt: 'x' }
    );
    await waitForEvent(sender, 'delta');
    expect(await call('ai-stream-cancel', fakeSender(4), started.data.streamId)).toEqual({
      ok: true,
      data: { cancelled: false },
    });
    expect(await call('ai-stream-cancel', sender, 123)).toEqual({
      ok: true,
      data: { cancelled: false },
    });
    expect(await call('ai-stream-cancel', sender, started.data.streamId)).toEqual({
      ok: true,
      data: { cancelled: true },
    });
    await waitForEvent(sender, 'error');
    expect(sender.sent.at(-1)?.payload).toMatchObject({
      type: 'error',
      error: { kind: 'aborted' },
    });

    const other = fakeSender(5);
    await call('ai-stream-start', other, { providerId: 'grok', prompt: 'x' });
    await waitForEvent(other, 'delta');
    other.destroyed = true;
    other.destroyListeners.forEach((listener) => listener());
    await new Promise((resolve) => setTimeout(resolve, 20));
    // 窗口已销毁：不再推送
    expect(other.sent.filter((item) => item.payload.type === 'error')).toHaveLength(0);
  });

  it('每个窗口最多 4 个并发流', async () => {
    let id = 0;
    const neverEnding = {
      stream: () => ({
        async *[Symbol.asyncIterator]() {
          await new Promise(() => undefined);
        },
      }),
    };
    const manager = new AIStreamManager(
      () => neverEnding as never,
      () => `s${(id += 1)}`
    );
    const sender = fakeSender(6);
    for (let i = 0; i < 4; i += 1) manager.start(sender, { prompt: 'x' });
    expect(manager.size).toBe(4);
    expect(() => manager.start(sender, { prompt: 'x' })).toThrow('同时进行的 AI 生成过多');
    expect(manager.start(fakeSender(7), { prompt: 'x' })).toBe('s5');
    manager.cancelAllFor(6);
  });
});
