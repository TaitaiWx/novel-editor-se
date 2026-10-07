import { describe, expect, it } from 'vitest';
import {
  AIError,
  classifyHttpError,
  describeAIError,
  errorFromFetchFailure,
  errorFromHttpResponse,
  extractErrorInfo,
  toAIError,
} from '../src/errors';
import {
  createHttpClient,
  createRequestSignal,
  joinUrl,
  NO_RETRY,
  retryDelayMs,
  sleep,
  withRetry,
} from '../src/http';
import { instantSleep, jsonResponse, mockFetch } from './helpers';

describe('错误规范化', () => {
  it.each([
    [401, 'Incorrect API key provided', undefined, 'auth'],
    [403, 'forbidden', undefined, 'auth'],
    [402, 'payment required', undefined, 'quota'],
    [429, 'Rate limit reached', undefined, 'rate-limit'],
    [429, 'You exceeded your current quota', 'insufficient_quota', 'quota'],
    [400, 'Your request was rejected by our content policy', undefined, 'content-safety'],
    [400, 'bad', 'InputTextSensitiveContentDetected', 'content-safety'],
    [400, 'account overdue', 'AccountOverdueError', 'quota'],
    [400, 'invalid model', undefined, 'bad-request'],
    [400, 'invalid api_key', undefined, 'auth'],
    [408, 'timeout', undefined, 'timeout'],
    [500, 'boom', undefined, 'server'],
    [503, 'unavailable', undefined, 'server'],
  ] as const)('HTTP %i「%s」→ %s', (status, message, code, kind) => {
    expect(classifyHttpError(status, message, code)).toBe(kind);
  });

  it('提取各种错误体', () => {
    expect(extractErrorInfo({ error: { message: 'm', code: 'c' } })).toEqual({
      message: 'm',
      code: 'c',
    });
    expect(extractErrorInfo({ error: { message: 'm', type: 'invalid_request_error' } })).toEqual({
      message: 'm',
      code: 'invalid_request_error',
    });
    expect(extractErrorInfo({ error: 'plain' })).toEqual({ message: 'plain' });
    expect(extractErrorInfo({ detail: 'd' })).toEqual({ message: 'd' });
    expect(extractErrorInfo('text body')).toEqual({ message: 'text body' });
    expect(extractErrorInfo(null)).toEqual({});
  });

  it('HTTP 错误没有信息时使用旧版的兜底文案', () => {
    const error = errorFromHttpResponse(502, {}, { providerId: 'p' });
    expect(error.message).toBe('AI 请求失败 (HTTP 502)');
    expect(error).toMatchObject({ kind: 'server', retryable: true, providerId: 'p', status: 502 });
  });

  it('fetch 异常：网络 / 超时 / 取消', () => {
    expect(
      errorFromFetchFailure(new TypeError('fetch failed'), { endpoint: 'http://x' }).message
    ).toBe('无法连接 AI 服务 (http://x): fetch failed');
    expect(errorFromFetchFailure(new Error('x'), { timedOut: true }).kind).toBe('timeout');
    const abort = Object.assign(new Error('a'), { name: 'AbortError' });
    expect(errorFromFetchFailure(abort).kind).toBe('aborted');
    expect(toAIError(abort).kind).toBe('aborted');
    expect(toAIError('weird').kind).toBe('unknown');
    const existing = new AIError({ kind: 'auth', message: 'x' });
    expect(toAIError(existing)).toBe(existing);
    expect(errorFromFetchFailure(existing)).toBe(existing);
  });

  it('toJSON 与 describeAIError', () => {
    const error = new AIError({
      kind: 'quota',
      message: '余额不足',
      code: '1008',
      providerId: 'm',
    });
    expect(error.toJSON()).toEqual({
      kind: 'quota',
      message: '余额不足',
      retryable: false,
      providerId: 'm',
      code: '1008',
    });
    expect(describeAIError(new AIError({ kind: 'auth', message: 'bad key' }))).toContain('API Key');
    expect(describeAIError(new AIError({ kind: 'unknown', message: 'x' }))).toBe('x');
  });
});

describe('重试', () => {
  it('退避时间确定且有上限', () => {
    expect([1, 2, 3, 4, 5].map((n) => retryDelayMs(n))).toEqual([800, 1600, 3200, 6400, 8000]);
  });

  it('可重试错误按策略重试，最终成功', async () => {
    const { sleep: fakeSleep, delays } = instantSleep();
    let calls = 0;
    const onRetry: number[] = [];
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new AIError({ kind: 'server', message: '5xx' });
        return 'ok';
      },
      { sleep: fakeSleep, onRetry: (info) => onRetry.push(info.attempt) }
    );
    expect(result).toBe('ok');
    expect(delays).toEqual([800, 1600]);
    expect(onRetry).toEqual([1, 2]);
  });

  it('不可重试错误立即失败；超过次数后抛出最后的错误', async () => {
    const { sleep: fakeSleep } = instantSleep();
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new AIError({ kind: 'auth', message: 'no' });
        },
        { sleep: fakeSleep }
      )
    ).rejects.toMatchObject({ kind: 'auth' });
    expect(calls).toBe(1);
    calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new TypeError('fetch failed');
        },
        { sleep: fakeSleep }
      )
    ).rejects.toMatchObject({ kind: 'network' });
    expect(calls).toBe(3);
  });

  it('取消信号中止重试与等待', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(withRetry(async () => 'x', { signal: controller.signal })).rejects.toMatchObject({
      kind: 'aborted',
    });
    const c2 = new AbortController();
    const waiting = sleep(10_000, c2.signal);
    c2.abort();
    await expect(waiting).rejects.toMatchObject({ kind: 'aborted' });
    await expect(sleep(1)).resolves.toBeUndefined();
  });

  it('createRequestSignal 合并外部取消与超时', async () => {
    const external = new AbortController();
    const linked = createRequestSignal(external.signal, 0);
    external.abort();
    expect(linked.signal.aborted).toBe(true);
    expect(linked.timedOut()).toBe(false);
    const timed = createRequestSignal(undefined, 5);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(timed.signal.aborted).toBe(true);
    expect(timed.timedOut()).toBe(true);
    timed.dispose();
  });
});

describe('HTTP 客户端', () => {
  it('joinUrl 处理斜杠、完整 URL 与查询参数', () => {
    expect(joinUrl('https://a/v1/', '/chat')).toBe('https://a/v1/chat');
    expect(joinUrl('https://a', 'https://b/x', { q: 'a b', n: 1, u: undefined })).toBe(
      'https://b/x?q=a%20b&n=1'
    );
    expect(joinUrl('https://a', '/x?y=1', { z: 2 })).toBe('https://a/x?y=1&z=2');
  });

  it('json：带鉴权头、解析响应、5xx 重试', async () => {
    const { sleep: fakeSleep } = instantSleep();
    const { fetch, requests } = mockFetch(
      jsonResponse({ error: { message: 'busy' } }, 503),
      jsonResponse({ ok: 1 })
    );
    const client = createHttpClient({
      providerId: 'p',
      baseUrl: 'https://api.test/v1',
      headers: { Authorization: 'Bearer k' },
      fetch,
      sleep: fakeSleep,
    });
    await expect(client.json('POST', '/x', { a: 1 })).resolves.toEqual({ ok: 1 });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      url: 'https://api.test/v1/x',
      method: 'POST',
      body: { a: 1 },
      headers: { Authorization: 'Bearer k', 'Content-Type': 'application/json' },
    });
  });

  it('json：无效 JSON → invalid-response；指定 NO_RETRY 时不重试', async () => {
    const { fetch, requests } = mockFetch(
      new Response('<html>', { status: 200 }),
      jsonResponse({}, 500)
    );
    const client = createHttpClient({ providerId: 'p', baseUrl: 'https://a', fetch });
    await expect(client.json('GET', '/x')).rejects.toMatchObject({
      kind: 'invalid-response',
      message: 'AI 服务返回了无效的响应 (HTTP 200)',
    });
    await expect(client.json('GET', '/x', undefined, { retry: NO_RETRY })).rejects.toMatchObject({
      kind: 'server',
    });
    expect(requests).toHaveLength(2);
  });

  it('json：超时转换为 timeout', async () => {
    const fetch = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        );
      });
    const client = createHttpClient({
      providerId: 'p',
      baseUrl: 'https://a',
      fetch,
      timeoutMs: 10,
      retry: NO_RETRY,
    });
    await expect(client.json('GET', '/x')).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('json：外部取消转换为 aborted', async () => {
    const controller = new AbortController();
    const fetch = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        );
      });
    const client = createHttpClient({ providerId: 'p', baseUrl: 'https://a', fetch });
    const pending = client.json('GET', '/x', undefined, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('stream：非 2xx 解析错误体', async () => {
    const { fetch } = mockFetch(jsonResponse({ error: { message: 'bad key' } }, 401));
    const client = createHttpClient({ providerId: 'p', baseUrl: 'https://a', fetch });
    await expect(client.stream('/s', {})).rejects.toMatchObject({
      kind: 'auth',
      message: 'bad key',
    });
  });
});
