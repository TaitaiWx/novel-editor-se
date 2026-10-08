/**
 * HTTP 基础设施：超时 + 取消合并、指数退避重试、JSON 请求、流式响应
 *
 * 只依赖 WHATWG fetch / AbortController（Node 20+、Electron 主进程、浏览器都可用），
 * fetch 可注入，测试时用 mock 替代。
 */
import { AIError, errorFromFetchFailure, errorFromHttpResponse } from './errors';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RetryPolicy {
  /** 失败后最多再试几次（0 = 不重试） */
  retries: number;
  baseDelayMs: number;
  factor: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  retries: 2,
  baseDelayMs: 800,
  factor: 2,
  maxDelayMs: 8000,
};

export const NO_RETRY: RetryPolicy = { ...DEFAULT_RETRY_POLICY, retries: 0 };

/** 第 attempt 次重试前的等待时间（attempt 从 1 开始，确定性，无随机抖动） */
export function retryDelayMs(attempt: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): number {
  const exp = policy.baseDelayMs * Math.pow(policy.factor, Math.max(0, attempt - 1));
  return Math.min(policy.maxDelayMs, Math.round(exp));
}

function abortReason(signal: AbortSignal): AIError {
  const reason: unknown = signal.reason;
  if (reason instanceof AIError) return reason;
  return new AIError({ kind: 'aborted', message: '请求已取消', cause: reason });
}

/** 可取消的等待 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal as AbortSignal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface RetryOptions {
  policy?: RetryPolicy;
  signal?: AbortSignal;
  /** 测试注入 */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onRetry?: (info: { attempt: number; delayMs: number; error: AIError }) => void;
}

/**
 * 对可重试错误（限流、网络、超时、5xx）做指数退避重试；
 * 鉴权、额度、内容安全、参数错误与取消立即失败
 */
export async function withRetry<T>(
  task: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const policy = options.policy ?? DEFAULT_RETRY_POLICY;
  const wait = options.sleep ?? sleep;
  for (let attempt = 0; ; attempt += 1) {
    if (options.signal?.aborted) throw abortReason(options.signal);
    try {
      return await task(attempt);
    } catch (raw) {
      const error = raw instanceof AIError ? raw : errorFromFetchFailure(raw);
      if (options.signal?.aborted) throw abortReason(options.signal);
      if (!error.retryable || attempt >= policy.retries) throw error;
      const delayMs = retryDelayMs(attempt + 1, policy);
      options.onRetry?.({ attempt: attempt + 1, delayMs, error });
      await wait(delayMs, options.signal);
    }
  }
}

/**
 * 合并外部取消信号与超时：返回的 signal 在任一触发时中止。
 * timedOut() 用于区分「超时」与「作者主动取消」。
 */
export function createRequestSignal(
  external: AbortSignal | undefined,
  timeoutMs: number | undefined
): { signal: AbortSignal; timedOut: () => boolean; clearTimeout: () => void; dispose: () => void } {
  const controller = new AbortController();
  let didTimeout = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) controller.abort(external.reason);
    else external.addEventListener('abort', onAbort, { once: true });
  }
  if (timeoutMs && timeoutMs > 0) {
    timer = setTimeout(() => {
      didTimeout = true;
      controller.abort(new AIError({ kind: 'timeout', message: 'AI 服务响应超时' }));
    }, timeoutMs);
  }
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    clearTimeout: clear,
    dispose: () => {
      clear();
      external?.removeEventListener('abort', onAbort);
    },
  };
}

export interface HttpClientOptions {
  providerId: string;
  baseUrl: string;
  /** 鉴权头，例如 { Authorization: 'Bearer xxx' } */
  headers?: Record<string, string>;
  fetch?: FetchLike;
  /** 单次请求超时（流式请求只计算到响应头返回） */
  timeoutMs?: number;
  retry?: RetryPolicy;
  /** 测试注入 */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** 覆盖客户端的重试策略（例如提交视频任务不重试，避免重复扣费） */
  retry?: RetryPolicy;
  query?: Record<string, string | number | undefined>;
  /** 本次请求额外的请求头（与客户端的鉴权头合并，同名时以这里为准） */
  headers?: Record<string, string>;
}

/** 拼接 baseUrl 与路径：去掉多余斜杠；path 为完整 URL 时直接使用 */
export function joinUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | undefined>
): string {
  const url = /^https?:\/\//i.test(path)
    ? path
    : `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  const params = Object.entries(query ?? {}).filter(
    (entry): entry is [string, string | number] => entry[1] !== undefined
  );
  if (params.length === 0) return url;
  const search = params
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return `${url}${url.includes('?') ? '&' : '?'}${search}`;
}

async function readBody(response: Response): Promise<{ json?: unknown; text: string }> {
  const text = await response.text();
  if (!text) return { text };
  try {
    return { json: JSON.parse(text) as unknown, text };
  } catch {
    return { text };
  }
}

export interface HttpClient {
  readonly providerId: string;
  readonly baseUrl: string;
  /** 发送 JSON 请求并解析 JSON 响应；非 2xx 抛出规范化的 AIError */
  json<T>(method: string, path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  /** 发送请求并返回 2xx 的原始响应（流式读取用），不重试已开始的流 */
  stream(path: string, body: unknown, options?: RequestOptions): Promise<Response>;
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const policy = options.retry ?? DEFAULT_RETRY_POLICY;

  const send = async (
    method: string,
    path: string,
    body: unknown,
    request: RequestOptions,
    keepTimeoutAfterHeaders: boolean
  ): Promise<{ response: Response; endpoint: string; dispose: () => void }> => {
    const endpoint = joinUrl(options.baseUrl, path, request.query);
    const ctl = createRequestSignal(request.signal, options.timeoutMs);
    let response: Response;
    try {
      response = await doFetch(endpoint, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          Accept: 'application/json, text/event-stream',
          ...options.headers,
          ...request.headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });
    } catch (error) {
      const timedOut = ctl.timedOut();
      ctl.dispose();
      if (request.signal?.aborted) throw abortReason(request.signal);
      throw errorFromFetchFailure(error, { providerId: options.providerId, endpoint, timedOut });
    }
    if (!keepTimeoutAfterHeaders) ctl.clearTimeout();
    return { response, endpoint, dispose: ctl.dispose };
  };

  const parseFailure = async (response: Response): Promise<AIError> => {
    const { json, text } = await readBody(response).catch(() => ({ json: undefined, text: '' }));
    return errorFromHttpResponse(response.status, json ?? text.slice(0, 500), {
      providerId: options.providerId,
    });
  };

  return {
    providerId: options.providerId,
    baseUrl: options.baseUrl,
    json<T>(method: string, path: string, body?: unknown, request: RequestOptions = {}) {
      return withRetry(
        async () => {
          const { response, endpoint, dispose } = await send(method, path, body, request, true);
          try {
            if (!response.ok) throw await parseFailure(response);
            let parsed: { json?: unknown; text: string };
            try {
              parsed = await readBody(response);
            } catch (error) {
              if (request.signal?.aborted) throw abortReason(request.signal);
              throw errorFromFetchFailure(error, { providerId: options.providerId, endpoint });
            }
            if (parsed.json === undefined) {
              throw new AIError({
                kind: 'invalid-response',
                message: `AI 服务返回了无效的响应 (HTTP ${response.status})`,
                status: response.status,
                providerId: options.providerId,
              });
            }
            return parsed.json as T;
          } finally {
            dispose();
          }
        },
        { policy: request.retry ?? policy, signal: request.signal, sleep: options.sleep }
      );
    },
    stream(path: string, body: unknown, request: RequestOptions = {}) {
      return withRetry(
        async () => {
          const { response, dispose } = await send('POST', path, body, request, false);
          if (!response.ok) {
            try {
              throw await parseFailure(response);
            } finally {
              dispose();
            }
          }
          // 流读取期间仍需响应外部取消；读完或取消后由调用方的 reader 结束，这里只解除监听
          request.signal?.addEventListener('abort', dispose, { once: true });
          return response;
        },
        { policy: request.retry ?? policy, signal: request.signal, sleep: options.sleep }
      );
    },
  };
}
