/**
 * 主进程 AI 服务：Provider 注册表 + 安全密钥 + 非密钥配置的组合
 *
 * - 默认文本服务（openai-compatible）的地址 / 模型 / 温度 / 启用状态来自设置中心 JSON，Key 来自 CredentialStore
 * - 其他 Provider（grok、minimax-video、seedance-video）的配置来自 ProviderConfigStore
 * - invokeConfiguredAI 保持旧版签名、默认值与错误文案（成长推演、大纲导入等调用方无需改动）
 */
import {
  AIError,
  createDefaultRegistry,
  toAIError,
  type ChatMessage,
  type CompletionRequest,
  type ProviderRegistry,
  type StreamChunk,
  type TextProvider,
  type ImageProvider,
  type VideoProvider,
} from '@novel-editor/ai';
import type { AICompletePayload, AIProviderInfo, AIProviderUpdate } from '../../shared/ai';
import { assertProviderId, type CredentialStore } from './credential-store';
import type { ProviderConfigStore } from './provider-config';
import { DEFAULT_TEXT_PROVIDER_ID, SETTINGS_CENTER_KEY } from './settings-secrets';

export interface AIRequestPayload {
  prompt: string;
  systemPrompt?: string;
  context?: string;
  maxTokens?: number;
  temperature?: number;
}

export type InvokeResult = { ok: true; text: string } | { ok: false; error: string };

interface DefaultTextSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AIServiceDeps {
  credentials: CredentialStore;
  configs: ProviderConfigStore;
  /** 读取设置中心 JSON（数据库未初始化时返回 undefined） */
  readSettings: () => string | undefined;
  registry?: ProviderRegistry;
}

const MAX_MESSAGES = 64;
const MAX_MESSAGE_CHARS = 400_000;

function isRecord(value: unknown): value is Record<string, unknown> {
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

export class AIService {
  readonly registry: ProviderRegistry;

  constructor(private readonly deps: AIServiceDeps) {
    this.registry = deps.registry ?? createDefaultRegistry();
  }

  private defaultSettings(): DefaultTextSettings {
    return parseDefaultTextSettings(
      this.deps.readSettings(),
      this.deps.credentials.has(DEFAULT_TEXT_PROVIDER_ID)
    );
  }

  private descriptor(providerId: string) {
    const descriptor = this.registry.get(assertProviderId(providerId));
    if (!descriptor) {
      throw new AIError({
        kind: 'bad-request',
        message: `未知的 AI 服务: ${providerId}`,
        providerId,
      });
    }
    return descriptor;
  }

  /** 设置中心列表：不含任何密钥 */
  listProviders(): AIProviderInfo[] {
    return this.registry.list().map((descriptor) => this.getProviderInfo(descriptor.id));
  }

  getProviderInfo(providerId: string): AIProviderInfo {
    const descriptor = this.descriptor(providerId);
    const configured = this.deps.credentials.has(descriptor.id);
    const isDefault = descriptor.id === DEFAULT_TEXT_PROVIDER_ID;
    const stored = this.deps.configs.get(descriptor.id);
    const defaults = isDefault ? this.defaultSettings() : null;
    return {
      id: descriptor.id,
      kind: descriptor.kind,
      label: descriptor.label,
      description: descriptor.description,
      defaultBaseUrl: descriptor.defaultBaseUrl,
      defaultModel: descriptor.defaultModel,
      models: descriptor.models,
      docsUrl: descriptor.docsUrl,
      configured,
      secureStorage: this.deps.credentials.isSecure(),
      enabled: defaults ? defaults.enabled : (stored.enabled ?? configured),
      baseUrl: (defaults ? defaults.baseUrl : stored.baseUrl) || descriptor.defaultBaseUrl,
      model: (defaults ? defaults.model : stored.model) || descriptor.defaultModel,
      ...(descriptor.kind === 'video'
        ? { pricePerSecond: stored.pricePerSecond, currency: stored.currency ?? 'CNY' }
        : {}),
    };
  }

  /** 写入配置；apiKey 只写不读。openai-compatible 的地址 / 模型仍由设置中心 AI 分区保存 */
  updateProvider(providerId: string, update: AIProviderUpdate): AIProviderInfo {
    const descriptor = this.descriptor(providerId);
    if (!isRecord(update)) throw new AIError({ kind: 'bad-request', message: '无效的配置' });
    if (update.clearKey === true) this.deps.credentials.delete(descriptor.id);
    if (typeof update.apiKey === 'string' && update.apiKey.trim()) {
      this.deps.credentials.set(descriptor.id, update.apiKey);
    }
    if (descriptor.id !== DEFAULT_TEXT_PROVIDER_ID) this.deps.configs.update(descriptor.id, update);
    return this.getProviderInfo(descriptor.id);
  }

  /** 取得可用的文本 Provider；未启用 / 未配置时抛出 not-configured（文案与旧版一致） */
  getTextProvider(providerId: string = DEFAULT_TEXT_PROVIDER_ID): TextProvider {
    const descriptor = this.descriptor(providerId);
    if (descriptor.kind !== 'text') {
      throw new AIError({
        kind: 'bad-request',
        message: `${descriptor.label} 不是文本服务`,
        providerId,
      });
    }
    const apiKey = this.deps.credentials.get(descriptor.id) ?? '';
    if (descriptor.id === DEFAULT_TEXT_PROVIDER_ID) {
      const settings = this.defaultSettings();
      if (!settings.enabled) {
        throw new AIError({
          kind: 'not-configured',
          message: 'AI 功能未启用，请先在设置中心开启',
          providerId,
        });
      }
      if (!apiKey) {
        throw new AIError({
          kind: 'not-configured',
          message: '未配置 AI Key，请先在设置中心填写 API Key',
          providerId,
        });
      }
      if (!settings.baseUrl || !settings.model) {
        throw new AIError({
          kind: 'not-configured',
          message: 'AI Base URL 或模型未配置完整',
          providerId,
        });
      }
      return this.registry.createText(descriptor.id, {
        apiKey,
        baseUrl: settings.baseUrl,
        model: settings.model,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
      });
    }
    const stored = this.deps.configs.get(descriptor.id);
    if (stored.enabled === false) {
      throw new AIError({
        kind: 'not-configured',
        message: `${descriptor.label} 未启用，请先在设置中心开启`,
        providerId,
      });
    }
    if (!apiKey) {
      throw new AIError({
        kind: 'not-configured',
        message: `未配置 ${descriptor.label} 的 API Key，请先在设置中心填写`,
        providerId,
      });
    }
    return this.registry.createText(descriptor.id, {
      apiKey,
      baseUrl: stored.baseUrl,
      model: stored.model,
    });
  }

  getVideoProvider(providerId: string): VideoProvider {
    const descriptor = this.descriptor(providerId);
    if (descriptor.kind !== 'video') {
      throw new AIError({
        kind: 'bad-request',
        message: `${descriptor.label} 不是视频服务`,
        providerId,
      });
    }
    const stored = this.deps.configs.get(descriptor.id);
    const apiKey = this.deps.credentials.get(descriptor.id);
    if (stored.enabled === false) {
      throw new AIError({
        kind: 'not-configured',
        message: `${descriptor.label} 未启用`,
        providerId,
      });
    }
    if (!apiKey) {
      throw new AIError({
        kind: 'not-configured',
        message: `未配置 ${descriptor.label} 的 API Key，请先在设置中心填写`,
        providerId,
      });
    }
    return this.registry.createVideo(descriptor.id, {
      apiKey,
      baseUrl: stored.baseUrl,
      model: stored.model,
    });
  }

  /** 已配置且启用的图片服务（设置中心「更多 AI 服务」里的 Seedream / MiniMax / Grok 图片） */
  listReadyImageProviders(): AIProviderInfo[] {
    return this.registry
      .list('image')
      .map((descriptor) => this.getProviderInfo(descriptor.id))
      .filter((info) => info.configured && info.enabled);
  }

  getImageProvider(providerId?: string): ImageProvider {
    const id = providerId ?? this.listReadyImageProviders()[0]?.id;
    if (!id) {
      throw new AIError({
        kind: 'not-configured',
        message:
          '还没有配置图片服务，请先在设置中心「AI → 更多 AI 服务」里填写 Seedream / MiniMax / Grok 图片的 Key',
      });
    }
    const descriptor = this.descriptor(id);
    if (descriptor.kind !== 'image') {
      throw new AIError({
        kind: 'bad-request',
        message: `${descriptor.label} 不是图片服务`,
        providerId: id,
      });
    }
    const stored = this.deps.configs.get(descriptor.id);
    const apiKey = this.deps.credentials.get(descriptor.id);
    if (stored.enabled === false) {
      throw new AIError({
        kind: 'not-configured',
        message: `${descriptor.label} 未启用`,
        providerId: id,
      });
    }
    if (!apiKey) {
      throw new AIError({
        kind: 'not-configured',
        message: `未配置 ${descriptor.label} 的 API Key，请先在设置中心填写`,
        providerId: id,
      });
    }
    return this.registry.createImage(descriptor.id, {
      apiKey,
      baseUrl: stored.baseUrl,
      model: stored.model,
    });
  }

  /** 测试连接：使用已保存的 Key；未启用的服务也允许测试 */
  async testProvider(providerId: string, signal?: AbortSignal): Promise<void> {
    const descriptor = this.descriptor(providerId);
    const apiKey = this.deps.credentials.get(descriptor.id);
    if (!apiKey) {
      throw new AIError({ kind: 'not-configured', message: '请先填写并保存 API Key', providerId });
    }
    if (descriptor.kind === 'text') {
      const settings = descriptor.id === DEFAULT_TEXT_PROVIDER_ID ? this.defaultSettings() : null;
      const stored = this.deps.configs.get(descriptor.id);
      const provider = this.registry.createText(descriptor.id, {
        apiKey,
        baseUrl: settings?.baseUrl || stored.baseUrl,
        model: settings?.model || stored.model,
      });
      await provider.testConnection({ signal });
      return;
    }
    const stored = this.deps.configs.get(descriptor.id);
    const config = { apiKey, baseUrl: stored.baseUrl, model: stored.model };
    if (descriptor.kind === 'image') {
      await this.registry.createImage(descriptor.id, config).testConnection({ signal });
      return;
    }
    await this.registry.createVideo(descriptor.id, config).testConnection({ signal });
  }

  async complete(payload: AICompletePayload, signal?: AbortSignal) {
    const provider = this.getTextProvider(payload?.providerId ?? DEFAULT_TEXT_PROVIDER_ID);
    return provider.complete(toCompletionRequest(payload), { signal });
  }

  stream(payload: AICompletePayload, signal?: AbortSignal): AsyncIterable<StreamChunk> {
    const provider = this.getTextProvider(payload?.providerId ?? DEFAULT_TEXT_PROVIDER_ID);
    return provider.stream(toCompletionRequest(payload), { signal });
  }

  /** 旧版 ai-request 语义：不抛异常，返回 { ok, text | error } */
  async invokeConfiguredAI(payload: AIRequestPayload): Promise<InvokeResult> {
    try {
      const result = await this.complete({
        prompt: payload?.prompt,
        systemPrompt: payload?.systemPrompt,
        context: payload?.context,
        temperature: payload?.temperature,
        maxTokens: payload?.maxTokens,
      });
      return { ok: true, text: result.text };
    } catch (error) {
      // 保持旧版文案：直接返回厂商 / 网络的原始信息（describeAIError 的建议留给新界面使用）
      return { ok: false, error: toAIError(error).message };
    }
  }
}

export { SETTINGS_CENTER_KEY };
