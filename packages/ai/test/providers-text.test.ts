import { describe, expect, it } from 'vitest';
import {
  buildChatCompletionBody,
  createDefaultRegistry,
  createGrokProvider,
  createOpenAICompatibleProvider,
  GROK_DEFAULTS,
  NO_RETRY,
  providerEnvKey,
  type StreamChunk,
} from '../src';
import {
  chunkedStream,
  collect,
  instantSleep,
  jsonResponse,
  mockFetch,
  sseResponse,
} from './helpers';

const messages = [
  { role: 'system' as const, content: 'sys' },
  { role: 'user' as const, content: '你好' },
];

describe('openai-compatible：请求映射', () => {
  it('请求体快照（非流式 / 流式）', () => {
    expect(buildChatCompletionBody({ messages }, { model: ' gpt-x ' }, false))
      .toMatchInlineSnapshot(`
      {
        "max_tokens": 8192,
        "messages": [
          {
            "content": "sys",
            "role": "system",
          },
          {
            "content": "你好",
            "role": "user",
          },
        ],
        "model": "gpt-x",
        "temperature": 1.3,
      }
    `);
    expect(
      buildChatCompletionBody(
        { messages, temperature: 0, maxTokens: 10, model: 'override' },
        { model: 'm', temperature: 0.5, maxTokens: 99 },
        true
      )
    ).toMatchObject({
      model: 'override',
      temperature: 0,
      max_tokens: 10,
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(
      buildChatCompletionBody({ messages }, { model: 'm', temperature: 0.5, maxTokens: 99 }, false)
    ).toMatchObject({
      temperature: 0.5,
      max_tokens: 99,
    });
  });

  it('缺少 Key 时抛出 not-configured', () => {
    expect(() => createOpenAICompatibleProvider({ apiKey: ' ' })).toThrow(/未配置 AI Key/);
  });
});

describe('openai-compatible：complete', () => {
  it('发送到 {baseUrl}/chat/completions，带 Bearer 鉴权', async () => {
    const { fetch, requests } = mockFetch(
      jsonResponse({
        model: 'm1',
        choices: [{ message: { content: '结果' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      })
    );
    const provider = createOpenAICompatibleProvider({
      apiKey: ' sk-1 ',
      baseUrl: 'https://api.example.com/v1/',
      model: 'm1',
      fetch,
    });
    const result = await provider.complete({ messages });
    expect(result).toEqual({
      text: '结果',
      model: 'm1',
      finishReason: 'stop',
      usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
    });
    expect(requests[0].url).toBe('https://api.example.com/v1/chat/completions');
    expect(requests[0].headers.Authorization).toBe('Bearer sk-1');
  });

  it('content 为数组时拼接 text', async () => {
    const { fetch } = mockFetch(
      jsonResponse({ choices: [{ message: { content: [{ text: 'a' }, { text: 'b' }, {}] } }] })
    );
    const provider = createOpenAICompatibleProvider({ apiKey: 'k', fetch });
    expect((await provider.complete({ messages })).text).toBe('ab');
  });

  it.each([
    [401, { error: { message: 'Incorrect API key' } }, 'auth', 1],
    [
      429,
      { error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } },
      'quota',
      1,
    ],
    [429, { error: { message: 'Rate limit' } }, 'rate-limit', 3],
    [500, {}, 'server', 3],
    [400, { error: { message: 'content policy violation' } }, 'content-safety', 1],
  ] as const)('HTTP %i → %s（请求 %i 次）', async (status, body, kind, attempts) => {
    const { sleep } = instantSleep();
    const { fetch, requests } = mockFetch(jsonResponse(body, status));
    const provider = createOpenAICompatibleProvider({ apiKey: 'k', fetch, sleep });
    await expect(provider.complete({ messages })).rejects.toMatchObject({
      kind,
      providerId: 'openai-compatible',
    });
    expect(requests).toHaveLength(attempts);
  });

  it('网络错误保留旧版文案', async () => {
    const { fetch } = mockFetch(new TypeError('getaddrinfo ENOTFOUND'));
    const provider = createOpenAICompatibleProvider({
      apiKey: 'k',
      fetch,
      retry: NO_RETRY,
      baseUrl: 'https://x/v1',
    });
    await expect(provider.complete({ messages })).rejects.toThrow(
      '无法连接 AI 服务 (https://x/v1/chat/completions): getaddrinfo ENOTFOUND'
    );
  });

  it('testConnection 发送 1 token 的请求且不重试', async () => {
    const { fetch, requests } = mockFetch(jsonResponse({ error: { message: 'boom' } }, 500));
    const provider = createOpenAICompatibleProvider({ apiKey: 'k', fetch });
    await expect(provider.testConnection()).rejects.toMatchObject({ kind: 'server' });
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toMatchObject({ max_tokens: 1, temperature: 0 });
  });
});

describe('openai-compatible：stream', () => {
  const deltas = ['第', '一句', '。'];
  const events = [
    ...deltas.map((text) =>
      JSON.stringify({ model: 'm', choices: [{ delta: { content: text } }] })
    ),
    JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
    JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 1, completion_tokens: 3, total_tokens: 4 },
    }),
    '[DONE]',
  ];

  it.each([1, 3, 17, 4096])('分片大小 %i：逐段产出 delta 并以 done 结束', async (size) => {
    const { fetch, requests } = mockFetch(sseResponse(events, size));
    const provider = createOpenAICompatibleProvider({ apiKey: 'k', fetch });
    const chunks = await collect(provider.stream({ messages }));
    expect(chunks).toEqual<StreamChunk[]>([
      { type: 'delta', text: '第' },
      { type: 'delta', text: '一句' },
      { type: 'delta', text: '。' },
      {
        type: 'done',
        finishReason: 'stop',
        model: 'm',
        usage: { promptTokens: 1, completionTokens: 3, totalTokens: 4 },
      },
    ]);
    expect(requests[0].body).toMatchObject({ stream: true });
  });

  it('[DONE] 之后的数据被忽略；没有 [DONE] 时流结束也正常完成', async () => {
    const after = [
      JSON.stringify({ choices: [{ delta: { content: 'a' } }] }),
      '[DONE]',
      JSON.stringify({ choices: [{ delta: { content: 'b' } }] }),
    ];
    const { fetch } = mockFetch(
      sseResponse(after),
      sseResponse([JSON.stringify({ choices: [{ delta: { content: 'c' } }] })])
    );
    const provider = createOpenAICompatibleProvider({ apiKey: 'k', fetch });
    expect(
      (await collect(provider.stream({ messages }))).filter((c) => c.type === 'delta')
    ).toEqual([{ type: 'delta', text: 'a' }]);
    expect((await collect(provider.stream({ messages }))).map((c) => c.type)).toEqual([
      'delta',
      'done',
    ]);
  });

  it('流中的 error 事件与无法解析的数据', async () => {
    const { fetch } = mockFetch(
      sseResponse([JSON.stringify({ error: { message: 'overloaded', code: 'x' } })]),
      sseResponse(['{not json'])
    );
    const provider = createOpenAICompatibleProvider({ apiKey: 'k', fetch });
    await expect(collect(provider.stream({ messages }))).rejects.toMatchObject({
      message: 'overloaded',
      code: 'x',
    });
    await expect(collect(provider.stream({ messages }))).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });

  it('中途取消：抛出 aborted 并停止产出', async () => {
    const controller = new AbortController();
    const body = events
      .slice(0, 3)
      .map((data) => `data: ${data}\n\n`)
      .join('');
    const { fetch } = mockFetch(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(ctrl) {
              ctrl.enqueue(new TextEncoder().encode(body.slice(0, body.indexOf('\n\n') + 2)));
            },
          })
        )
    );
    const provider = createOpenAICompatibleProvider({ apiKey: 'k', fetch });
    const received: string[] = [];
    const run = (async () => {
      for await (const chunk of provider.stream({ messages }, { signal: controller.signal })) {
        if (chunk.type === 'delta') received.push(chunk.text);
        controller.abort();
      }
    })();
    await expect(run).rejects.toMatchObject({ kind: 'aborted' });
    expect(received).toEqual(['第']);
  });

  it('请求前已取消：不发请求', async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetch, requests } = mockFetch(sseResponse(events));
    const provider = createOpenAICompatibleProvider({ apiKey: 'k', fetch });
    await expect(
      collect(provider.stream({ messages }, { signal: controller.signal }))
    ).rejects.toMatchObject({
      kind: 'aborted',
    });
    expect(requests).toHaveLength(0);
  });

  it('响应头前 429 会重试，响应没有 body 报 invalid-response', async () => {
    const { sleep } = instantSleep();
    const { fetch, requests } = mockFetch(
      jsonResponse({ error: { message: 'slow down' } }, 429),
      sseResponse(events)
    );
    const provider = createOpenAICompatibleProvider({ apiKey: 'k', fetch, sleep });
    expect((await collect(provider.stream({ messages }))).length).toBe(4);
    expect(requests).toHaveLength(2);
    const empty = mockFetch(new Response(null, { status: 200 }));
    const p2 = createOpenAICompatibleProvider({ apiKey: 'k', fetch: empty.fetch });
    await expect(collect(p2.stream({ messages }))).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });

  it('chunkedStream 工具支持取消', async () => {
    const controller = new AbortController();
    controller.abort();
    const reader = chunkedStream('abc', 1, controller.signal).getReader();
    await expect(reader.read()).rejects.toThrow();
  });
});

describe('grok', () => {
  it('默认使用 xAI 地址与模型，id 为 grok', async () => {
    const { fetch, requests } = mockFetch(
      jsonResponse({ choices: [{ message: { content: 'ok' } }] })
    );
    const provider = createGrokProvider({ apiKey: 'xai-1', fetch });
    expect(provider.id).toBe('grok');
    await provider.complete({ messages });
    expect(requests[0].url).toBe(`${GROK_DEFAULTS.baseUrl}/chat/completions`);
    expect(requests[0].body).toMatchObject({ model: GROK_DEFAULTS.model });
    expect(requests[0].headers.Authorization).toBe('Bearer xai-1');
  });

  it('错误带上 grok 的 providerId；模型可覆盖', async () => {
    const { fetch, requests } = mockFetch(
      jsonResponse({ error: 'Incorrect API key' }, 400),
      jsonResponse({ choices: [] })
    );
    const provider = createGrokProvider({ apiKey: 'k', fetch, model: 'grok-3-mini' });
    await expect(provider.complete({ messages })).rejects.toMatchObject({
      kind: 'auth',
      providerId: 'grok',
    });
    await provider.complete({ messages });
    expect(requests[1].body).toMatchObject({ model: 'grok-3-mini' });
  });
});

describe('注册表', () => {
  it('内置四个 Provider，按类型列出', () => {
    const registry = createDefaultRegistry();
    expect(registry.list().map((item) => item.id)).toEqual([
      'openai-compatible',
      'grok',
      'minimax-video',
      'seedance-video',
    ]);
    expect(registry.list('video').map((item) => item.id)).toEqual([
      'minimax-video',
      'seedance-video',
    ]);
    expect(registry.get('grok')?.envKey).toBe('NOVEL_EDITOR_GROK_API_KEY');
    expect(providerEnvKey('minimax-video')).toBe('NOVEL_EDITOR_MINIMAX_VIDEO_API_KEY');
    expect(registry.has('nope')).toBe(false);
  });

  it('按类型创建，类型不符或未知 id 报错', () => {
    const registry = createDefaultRegistry();
    expect(registry.createText('grok', { apiKey: 'k' }).kind).toBe('text');
    expect(registry.createVideo('seedance-video', { apiKey: 'k' }).kind).toBe('video');
    expect(() => registry.createVideo('grok', { apiKey: 'k' })).toThrow(/不是视频服务/);
    expect(() => registry.createText('minimax-video', { apiKey: 'k' })).toThrow(/不是文本服务/);
    expect(() => registry.createText('nope', { apiKey: 'k' })).toThrow(/未知的 AI 服务/);
    const descriptor = registry.get('grok');
    expect(() =>
      registry.registerVideo(descriptor!, () =>
        registry.createVideo('seedance-video', { apiKey: 'k' })
      )
    ).toThrow();
    expect(() =>
      registry.registerText({ ...descriptor!, kind: 'video' }, () =>
        registry.createText('grok', { apiKey: 'k' })
      )
    ).toThrow();
  });
});
