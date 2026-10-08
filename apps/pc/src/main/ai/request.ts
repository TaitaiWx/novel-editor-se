/**
 * AI 请求的纯函数：设置中心 JSON 中默认 AI 的解析、渲染进程消息白名单、旧版 ai-request 兼容
 */
import { AIError, type ChatMessage, type CompletionRequest } from '@novel-editor/ai';
import type { AICompletePayload } from '../../shared/ai';

export interface DefaultTextSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

const MAX_MESSAGES = 64;
const MAX_MESSAGE_CHARS = 400_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 解析设置中心 JSON 中的默认 AI 配置（兼容旧版顶层字段，与旧 normalizePersistedAISettings 一致） */
export function parseDefaultTextSettings(
  raw: string | undefined,
  hasKey: boolean
): DefaultTextSettings {
  let parsed: Record<string, unknown> = {};
  try {
    const value = raw ? (JSON.parse(raw) as unknown) : {};
    if (isRecord(value)) parsed = value;
  } catch {
    parsed = {};
  }
  const nested = isRecord(parsed.ai) ? parsed.ai : {};
  const pick = (key: string): unknown => parsed[key] ?? nested[key];
  const explicit =
    typeof parsed.enabledExplicitlySet === 'boolean'
      ? parsed.enabledExplicitlySet
      : nested.enabledExplicitlySet === true;
  const enabledRaw = typeof parsed.enabled === 'boolean' ? parsed.enabled : nested.enabled;
  const legacyKey =
    (typeof parsed.apiKey === 'string' && parsed.apiKey.trim()) ||
    (typeof nested.apiKey === 'string' && nested.apiKey.trim());
  const credential = hasKey || Boolean(legacyKey);
  const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const num = (value: unknown) => (typeof value === 'number' ? value : undefined);
  return {
    enabled: explicit ? Boolean(enabledRaw) : Boolean(enabledRaw) || credential,
    baseUrl: str(pick('baseUrl')),
    model: str(pick('model')),
    temperature: num(pick('temperature')),
    maxTokens: num(pick('maxTokens')),
  };
}

/** 渲染进程传入的消息只保留白名单字段并限制体量 */
export function sanitizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) {
    throw new AIError({ kind: 'bad-request', message: '无效的对话消息' });
  }
  let total = 0;
  return raw.map((item) => {
    if (!isRecord(item)) throw new AIError({ kind: 'bad-request', message: '无效的对话消息' });
    const role = item.role;
    const content = item.content;
    if (
      (role !== 'system' && role !== 'user' && role !== 'assistant') ||
      typeof content !== 'string'
    ) {
      throw new AIError({ kind: 'bad-request', message: '无效的对话消息' });
    }
    total += content.length;
    if (total > MAX_MESSAGE_CHARS) {
      throw new AIError({ kind: 'bad-request', message: '请求内容过长，请缩减上下文' });
    }
    return { role, content };
  });
}

/** 旧版 ai-request 的 prompt / systemPrompt / context 组装为消息（文案与旧实现一致） */
export function legacyPayloadToMessages(payload: {
  prompt?: unknown;
  systemPrompt?: unknown;
  context?: unknown;
}): ChatMessage[] {
  const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
  const systemPrompt = typeof payload.systemPrompt === 'string' ? payload.systemPrompt : '';
  const context = typeof payload.context === 'string' ? payload.context : '';
  return [
    ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
    {
      role: 'user' as const,
      content: context ? `项目上下文:\n${context}\n\n用户请求:\n${prompt}` : prompt,
    },
  ];
}

function optionalNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined;
}

/** AICompletePayload → CompletionRequest（白名单 + 范围校验） */
export function toCompletionRequest(payload: AICompletePayload): CompletionRequest {
  if (!isRecord(payload)) throw new AIError({ kind: 'bad-request', message: '无效的 AI 请求' });
  const messages =
    payload.messages !== undefined
      ? sanitizeMessages(payload.messages)
      : sanitizeMessages(legacyPayloadToMessages(payload));
  const model =
    typeof payload.model === 'string' && payload.model.trim()
      ? payload.model.trim().slice(0, 200)
      : undefined;
  return {
    messages,
    model,
    temperature: optionalNumber(payload.temperature, 0, 2),
    maxTokens: optionalNumber(payload.maxTokens, 1, 1_000_000),
  };
}

/** 请求里指定的服务；没有指定（或不是字符串）时返回 undefined = 默认写作 AI */
export function requestedProviderId(payload: AICompletePayload | undefined): string | undefined {
  const id = isRecord(payload) ? payload.providerId : undefined;
  return typeof id === 'string' && id ? id : undefined;
}
