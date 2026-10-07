/**
 * AI 错误规范化
 *
 * 各厂商的错误格式五花八门（HTTP 状态码、`error.code`、MiniMax 的 `base_resp.status_code`…），
 * 统一映射为少数几类，GUI / CLI 据此给出一致的提示与重试策略：
 * - auth：Key 无效或无权限（不重试，提示去设置中心）
 * - quota：余额 / 额度不足（不重试）
 * - rate-limit：限流（可重试）
 * - content-safety：内容安全拦截（不重试，提示改写）
 * - network / timeout / server：网络、超时、5xx（可重试）
 * - bad-request / invalid-response / not-configured / aborted / unknown
 */

export const AI_ERROR_KINDS = [
  'auth',
  'quota',
  'rate-limit',
  'content-safety',
  'network',
  'timeout',
  'server',
  'bad-request',
  'invalid-response',
  'not-configured',
  'aborted',
  'unknown',
] as const;
export type AIErrorKind = (typeof AI_ERROR_KINDS)[number];

const RETRYABLE_KINDS: ReadonlySet<AIErrorKind> = new Set([
  'rate-limit',
  'network',
  'timeout',
  'server',
]);

export interface AIErrorInit {
  kind: AIErrorKind;
  message: string;
  providerId?: string;
  status?: number;
  /** 厂商原始错误码 */
  code?: string;
  retryable?: boolean;
  cause?: unknown;
}

export class AIError extends Error {
  readonly kind: AIErrorKind;
  readonly providerId?: string;
  readonly status?: number;
  readonly code?: string;
  readonly retryable: boolean;

  constructor(init: AIErrorInit) {
    super(init.message);
    this.name = 'AIError';
    this.kind = init.kind;
    this.providerId = init.providerId;
    this.status = init.status;
    this.code = init.code;
    this.retryable = init.retryable ?? RETRYABLE_KINDS.has(init.kind);
    if (init.cause !== undefined) {
      (this as { cause?: unknown }).cause = init.cause;
    }
  }

  /** 可结构化克隆 / JSON 序列化的形式（IPC、CLI --json、任务表使用） */
  toJSON(): SerializedAIError {
    return {
      kind: this.kind,
      message: this.message,
      retryable: this.retryable,
      ...(this.providerId ? { providerId: this.providerId } : {}),
      ...(this.status !== undefined ? { status: this.status } : {}),
      ...(this.code ? { code: this.code } : {}),
    };
  }
}

export interface SerializedAIError {
  kind: AIErrorKind;
  message: string;
  retryable: boolean;
  providerId?: string;
  status?: number;
  code?: string;
}

export function isAIError(value: unknown): value is AIError {
  return value instanceof AIError;
}

/** 各类错误的中文提示（附加在厂商原始信息之后，帮助作者判断下一步） */
export const AI_ERROR_HINTS: Record<AIErrorKind, string> = {
  auth: '请检查设置中心里的 API Key 是否正确、是否有该模型的权限',
  quota: '账户余额或额度不足，请到服务商控制台充值或更换模型',
  'rate-limit': '请求过于频繁，请稍后再试',
  'content-safety': '内容被服务商的安全策略拦截，请调整描述后重试',
  network: '无法连接服务，请检查网络或接口地址',
  timeout: '请求超时，请稍后重试',
  server: '服务暂时不可用，请稍后重试',
  'bad-request': '请求参数不被接受，请检查模型名称与参数',
  'invalid-response': '服务返回了无法解析的内容',
  'not-configured': '请先在设置中心配置该服务',
  aborted: '已取消',
  unknown: '未知错误',
};

const CONTENT_SAFETY_PATTERN =
  /(sensitive|content[_\s-]?(policy|filter|safety|moderation)|moderat|safety|unsafe|违规|敏感|审核|安全策略)/i;
const QUOTA_PATTERN =
  /(insufficient[_\s-]?(balance|quota|credit)|quota|overdue|balance|billing|exceeded your current|欠费|余额|额度)/i;
const AUTH_PATTERN = /(api[_\s-]?key|unauthori[sz]ed|authenticat|invalid[_\s-]?token|鉴权|密钥)/i;

/** 按 HTTP 状态码 + 错误文本 / 错误码推断错误类别 */
export function classifyHttpError(status: number, text: string, code?: string): AIErrorKind {
  const haystack = `${code ?? ''} ${text}`;
  if (CONTENT_SAFETY_PATTERN.test(haystack)) return 'content-safety';
  if (status === 402) return 'quota';
  // 欠费 / 额度不足有的厂商用 403 或 429 返回，先于鉴权与限流判断
  if (status >= 400 && status < 500 && QUOTA_PATTERN.test(haystack)) return 'quota';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate-limit';
  if (status === 408) return 'timeout';
  if (status >= 500) return 'server';
  if (QUOTA_PATTERN.test(haystack)) return 'quota';
  if (AUTH_PATTERN.test(haystack) && status >= 400 && status < 500) return 'auth';
  if (status >= 400) return 'bad-request';
  return 'unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 从常见的错误响应体中提取信息：
 * - OpenAI 兼容 / xAI / 火山方舟：`{ error: { message, code, type } }` 或 `{ error: "..." }`
 * - 其他：`{ message }` / `{ msg }` / `{ detail }`
 */
export function extractErrorInfo(body: unknown): { message?: string; code?: string } {
  if (!isRecord(body)) return typeof body === 'string' && body ? { message: body } : {};
  const error = body.error;
  if (typeof error === 'string') return { message: error };
  if (isRecord(error)) {
    const message = typeof error.message === 'string' ? error.message : undefined;
    const rawCode = error.code ?? error.type;
    const code =
      typeof rawCode === 'string' || typeof rawCode === 'number' ? String(rawCode) : undefined;
    return { message, code };
  }
  for (const key of ['message', 'msg', 'detail']) {
    const value = body[key];
    if (typeof value === 'string' && value) return { message: value };
  }
  return {};
}

/** 把 HTTP 错误响应转换为 AIError */
export function errorFromHttpResponse(
  status: number,
  body: unknown,
  options: { providerId?: string; fallbackMessage?: string } = {}
): AIError {
  const info = extractErrorInfo(body);
  const message = info.message || options.fallbackMessage || `AI 请求失败 (HTTP ${status})`;
  return new AIError({
    kind: classifyHttpError(status, message, info.code),
    message,
    status,
    code: info.code,
    providerId: options.providerId,
  });
}

/** fetch 抛出的异常（网络、超时、取消）转换为 AIError */
export function errorFromFetchFailure(
  error: unknown,
  options: { providerId?: string; endpoint?: string; timedOut?: boolean } = {}
): AIError {
  if (error instanceof AIError) return error;
  const name = error instanceof Error ? error.name : '';
  const raw = error instanceof Error ? error.message : String(error);
  if (options.timedOut || name === 'TimeoutError') {
    return new AIError({
      kind: 'timeout',
      message: `AI 服务响应超时${options.endpoint ? ` (${options.endpoint})` : ''}`,
      providerId: options.providerId,
      cause: error,
    });
  }
  if (name === 'AbortError') {
    return new AIError({
      kind: 'aborted',
      message: '请求已取消',
      providerId: options.providerId,
      cause: error,
    });
  }
  return new AIError({
    kind: 'network',
    message: `无法连接 AI 服务${options.endpoint ? ` (${options.endpoint})` : ''}: ${raw}`,
    providerId: options.providerId,
    cause: error,
  });
}

/** 任意异常转换为 AIError（未知异常归为 unknown） */
export function toAIError(error: unknown, providerId?: string): AIError {
  if (error instanceof AIError) return error;
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return errorFromFetchFailure(error, { providerId });
  }
  return new AIError({
    kind: 'unknown',
    message: error instanceof Error ? error.message : String(error),
    providerId,
    cause: error,
  });
}

/** 面向作者的完整提示：厂商原始信息 + 下一步建议 */
export function describeAIError(error: Pick<AIError, 'kind' | 'message'>): string {
  const hint = AI_ERROR_HINTS[error.kind];
  if (!hint || error.kind === 'unknown' || error.message.includes(hint)) return error.message;
  return `${error.message}（${hint}）`;
}
