/**
 * 主进程 AI 服务：Provider 注册表 + 安全密钥 + 非密钥配置的组合
 *
 * - 内置默认文本服务（openai-compatible）的地址 / 模型 / 温度 / 启用状态来自设置中心 JSON，Key 来自 CredentialStore
 * - 其他 Provider（grok、minimax-video、seedance-video…）与自己添加的服务（custom-text-<n>、custom-video-<n>、
 *   custom-image-<n>、custom-speech-<n>）的配置来自 ProviderConfigStore
 * - 每个文本服务都有同一组生成参数（温度 / 上下文长度 / 单次回复长度）：请求没有指定温度时用服务的温度，
 *   单次回复长度同时是请求 max_tokens 的上限
 * - 默认写作 AI：作者在设置中心选定的文本服务（resolveDefaultTextProviderId，省略 providerId 的请求都走它）；
 *   未选择时为内置 openai-compatible，与旧版完全一致
 * - invokeConfiguredAI 保持旧版签名、默认值与错误文案（成长推演、大纲导入等调用方无需改动）
 */
import {
  AIError,
  createDefaultRegistry,
  toAIError,
  type ProviderRegistry,
  type StreamChunk,
  type TextProvider,
  type ImageProvider,
  type SpeechProvider,
  type VideoProvider,
} from '@novel-editor/ai';
import type {
  AICompletePayload,
  AICustomProviderInput,
  AIProviderInfo,
  AIProviderUpdate,
} from '../../shared/ai';
import { assertProviderId, type CredentialStore } from './credential-store';
import { addCustomProvider, removeCustomProvider } from './custom-actions';
import { customMediaVendorOf, syncCustomMediaProviders } from './custom-media';
import { isCustomTextId, syncCustomTextProviders } from './custom-text';
import {
  isCustomMediaId,
  isCustomProviderId,
  type ProviderConfigStore,
  type StoredProviderConfig,
} from './provider-config';
import {
  isRecord,
  parseDefaultTextSettings,
  requestedProviderId,
  toCompletionRequest,
  type DefaultTextSettings,
} from './request';
import { DEFAULT_TEXT_PROVIDER_ID, SETTINGS_CENTER_KEY } from './settings-secrets';

export {
  legacyPayloadToMessages,
  parseDefaultTextSettings,
  sanitizeMessages,
  toCompletionRequest,
} from './request';

const MEDIA_KIND_LABELS = { video: '视频', image: '图片', speech: '配音' } as const;

export interface AIRequestPayload {
  prompt: string;
  systemPrompt?: string;
  context?: string;
  maxTokens?: number;
  temperature?: number;
}

export type InvokeResult = { ok: true; text: string } | { ok: false; error: string };

export interface AIServiceDeps {
  credentials: CredentialStore;
  configs: ProviderConfigStore;
  /** 读取设置中心 JSON（数据库未初始化时返回 undefined） */
  readSettings: () => string | undefined;
  registry?: ProviderRegistry;
  clock?: () => Date;
}

/** 默认写作 AI 的摘要（注入设置中心 JSON，供渲染进程判断「AI 是否可用」） */
export interface DefaultTextSummary {
  id: string;
  label: string;
  /** 已保存 Key 且该服务未被关闭 */
  ready: boolean;
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

  /** 同步自己添加的服务到注册表 */
  private sync(): void {
    syncCustomTextProviders(this.registry, this.deps.configs);
    syncCustomMediaProviders(this.registry, this.deps.configs);
  }

  private descriptor(providerId: string) {
    const id = assertProviderId(providerId);
    this.sync();
    const descriptor = this.registry.get(id);
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
    this.sync();
    return this.registry.list().map((descriptor) => this.getProviderInfo(descriptor.id));
  }

  /** 默认写作 AI：作者选定且仍存在的文本服务，否则为内置 openai-compatible */
  resolveDefaultTextProviderId(): string {
    const chosen = this.deps.configs.getDefaultTextProviderId();
    if (!chosen || chosen === DEFAULT_TEXT_PROVIDER_ID) return DEFAULT_TEXT_PROVIDER_ID;
    this.sync();
    return this.registry.get(chosen)?.kind === 'text' ? chosen : DEFAULT_TEXT_PROVIDER_ID;
  }

  /** 选定默认写作 AI；null / 空 / 内置 id 恢复为内置默认 */
  setDefaultTextProvider(providerId: unknown): string {
    if (providerId === null || providerId === undefined || providerId === '') {
      this.deps.configs.setDefaultTextProviderId(undefined);
      return DEFAULT_TEXT_PROVIDER_ID;
    }
    const descriptor = this.descriptor(String(providerId));
    if (descriptor.kind !== 'text') {
      throw new AIError({ kind: 'bad-request', message: `${descriptor.label} 不是文本服务` });
    }
    this.deps.configs.setDefaultTextProviderId(
      descriptor.id === DEFAULT_TEXT_PROVIDER_ID ? undefined : descriptor.id
    );
    return descriptor.id;
  }

  /** 内置默认之外的默认写作 AI 摘要；未选择（或选的是内置默认）时返回 null */
  describeDefaultText(): DefaultTextSummary | null {
    const id = this.resolveDefaultTextProviderId();
    if (id === DEFAULT_TEXT_PROVIDER_ID) return null;
    const descriptor = this.descriptor(id);
    const stored = this.deps.configs.get(id);
    return {
      id,
      label: descriptor.label,
      ready: this.deps.credentials.has(id) && stored.enabled !== false,
    };
  }

  /** 添加自己的服务：文本为 OpenAI 兼容，视频 / 图片 / 语音沿用某个内置厂商实现 */
  addCustomProvider(input: AICustomProviderInput): AIProviderInfo {
    const id = addCustomProvider(this.deps, input);
    this.sync();
    return this.getProviderInfo(id);
  }

  /** 旧名称：添加 OpenAI 兼容文本 AI */
  addCustomTextProvider(input: AICustomProviderInput): AIProviderInfo {
    return this.addCustomProvider(isRecord(input) ? { ...input, kind: 'text' } : input);
  }

  /** 删除自己添加的服务：同时删除它的 Key 与配置；它是默认写作 AI 时恢复内置默认 */
  removeCustomProvider(providerId: unknown): boolean {
    const removed = removeCustomProvider(this.deps, providerId);
    this.sync();
    return removed;
  }

  /** 旧名称 */
  removeCustomTextProvider(providerId: unknown): boolean {
    return this.removeCustomProvider(providerId);
  }

  /** 文本服务的生成参数（内置默认来自设置中心 JSON） */
  private textParams(
    providerId: string
  ): Pick<StoredProviderConfig, 'temperature' | 'maxTokens' | 'contextTokens'> {
    const source =
      providerId === DEFAULT_TEXT_PROVIDER_ID
        ? this.defaultSettings()
        : this.deps.configs.get(providerId);
    return {
      temperature: source.temperature,
      maxTokens: source.maxTokens,
      contextTokens: source.contextTokens,
    };
  }

  getProviderInfo(providerId: string): AIProviderInfo {
    const descriptor = this.descriptor(providerId);
    const configured = this.deps.credentials.has(descriptor.id);
    const isDefault = descriptor.id === DEFAULT_TEXT_PROVIDER_ID;
    const stored = this.deps.configs.get(descriptor.id);
    const defaults = isDefault ? this.defaultSettings() : null;
    const defaultTextId = descriptor.kind === 'text' ? this.resolveDefaultTextProviderId() : '';
    const isText = descriptor.kind === 'text';
    return {
      id: descriptor.id,
      kind: descriptor.kind,
      label: descriptor.label,
      description: descriptor.description,
      defaultBaseUrl: descriptor.defaultBaseUrl,
      defaultModel: descriptor.defaultModel,
      models: descriptor.models,
      docsUrl: descriptor.docsUrl,
      ...(descriptor.supportsAudio ? { supportsAudio: true } : {}),
      configured,
      secureStorage: this.deps.credentials.isSecure(),
      enabled: defaults
        ? defaults.enabled && stored.enabled !== false
        : (stored.enabled ?? configured),
      baseUrl: (defaults ? defaults.baseUrl : stored.baseUrl) || descriptor.defaultBaseUrl,
      model: (defaults ? defaults.model : stored.model) || descriptor.defaultModel,
      ...(descriptor.kind === 'video'
        ? { pricePerSecond: stored.pricePerSecond, currency: stored.currency ?? 'CNY' }
        : {}),
      ...(isCustomProviderId(descriptor.id) ? { custom: true } : {}),
      ...(isCustomMediaId(descriptor.id)
        ? { vendor: customMediaVendorOf(this.deps.configs, descriptor.id) }
        : {}),
      ...(isText && defaultTextId === descriptor.id
        ? {
            isDefaultText: true,
            defaultTextChosen: Boolean(this.deps.configs.getDefaultTextProviderId()),
          }
        : {}),
      ...(isText ? this.textParams(descriptor.id) : {}),
      ...(descriptor.kind === 'speech' && stored.voice ? { voice: stored.voice } : {}),
    };
  }

  /**
   * 写入配置；apiKey 只写不读。内置 openai-compatible 的地址 / 模型仍由设置中心 AI 分区保存，
   * 这里只记它自己的启用开关；label（改名）只对自己添加的服务有效
   */
  updateProvider(providerId: string, update: AIProviderUpdate): AIProviderInfo {
    const descriptor = this.descriptor(providerId);
    if (!isRecord(update)) throw new AIError({ kind: 'bad-request', message: '无效的配置' });
    if (update.label !== undefined) {
      if (!isCustomProviderId(descriptor.id)) {
        throw new AIError({ kind: 'bad-request', message: '只能给自己添加的服务改名' });
      }
      try {
        if (isCustomTextId(descriptor.id)) {
          this.deps.configs.renameCustomText(descriptor.id, update.label);
        } else {
          this.deps.configs.renameCustomMedia(descriptor.id, update.label);
        }
      } catch (error) {
        throw new AIError({ kind: 'bad-request', message: toAIError(error).message });
      }
    }
    if (update.clearKey === true) this.deps.credentials.delete(descriptor.id);
    if (typeof update.apiKey === 'string' && update.apiKey.trim()) {
      this.deps.credentials.set(descriptor.id, update.apiKey);
    }
    if (descriptor.id !== DEFAULT_TEXT_PROVIDER_ID) {
      this.deps.configs.update(descriptor.id, update);
    } else if (typeof update.enabled === 'boolean') {
      this.deps.configs.update(descriptor.id, { enabled: update.enabled });
    }
    return this.getProviderInfo(descriptor.id);
  }

  /**
   * 取得可用的文本 Provider；未启用 / 未配置时抛出 not-configured（文案与旧版一致）。
   * 省略 providerId 时使用默认写作 AI；它不是内置默认时同样受「启用 AI 功能」总开关约束
   */
  getTextProvider(providerId?: string): TextProvider {
    const useDefault = providerId === undefined;
    const descriptor = this.descriptor(providerId ?? this.resolveDefaultTextProviderId());
    if (descriptor.kind !== 'text') {
      throw new AIError({
        kind: 'bad-request',
        message: `${descriptor.label} 不是文本服务`,
        providerId,
      });
    }
    providerId = descriptor.id;
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
      if (this.deps.configs.get(descriptor.id).enabled === false) {
        throw new AIError({
          kind: 'not-configured',
          message: `${descriptor.label} 未启用，请先在设置中心开启`,
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
    if (
      useDefault &&
      !parseDefaultTextSettings(this.deps.readSettings(), Boolean(apiKey)).enabled
    ) {
      throw new AIError({
        kind: 'not-configured',
        message: 'AI 功能未启用，请先在设置中心开启',
        providerId,
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
    if (isCustomTextId(descriptor.id) && !stored.baseUrl) {
      throw new AIError({
        kind: 'not-configured',
        message: `${descriptor.label} 没有填写接口地址`,
        providerId,
      });
    }
    return this.registry.createText(descriptor.id, {
      apiKey,
      baseUrl: stored.baseUrl,
      model: stored.model,
      temperature: stored.temperature,
      maxTokens: stored.maxTokens,
    });
  }

  /**
   * 媒体服务的可用配置：类型不符报 bad-request，未启用 / 没有 Key 报 not-configured。
   * 没有指定 providerId 时由调用方传入「第一个已配置的」
   */
  private mediaConfig(kind: 'video' | 'image' | 'speech', providerId: string) {
    const descriptor = this.descriptor(providerId);
    if (descriptor.kind !== kind) {
      throw new AIError({
        kind: 'bad-request',
        message: `${descriptor.label} 不是${MEDIA_KIND_LABELS[kind]}服务`,
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
    return { id: descriptor.id, stored, apiKey };
  }

  getVideoProvider(providerId: string): VideoProvider {
    const { id, stored, apiKey } = this.mediaConfig('video', providerId);
    return this.registry.createVideo(id, { apiKey, baseUrl: stored.baseUrl, model: stored.model });
  }

  /** 已配置且启用的某类服务（包括自己添加的） */
  private listReady(kind: 'image' | 'speech'): AIProviderInfo[] {
    this.sync();
    return this.registry
      .list(kind)
      .map((descriptor) => this.getProviderInfo(descriptor.id))
      .filter((info) => info.configured && info.enabled);
  }

  /** 已配置且启用的图片服务（Seedream / MiniMax / Grok 图片，以及自己添加的） */
  listReadyImageProviders(): AIProviderInfo[] {
    return this.listReady('image');
  }

  getImageProvider(providerId?: string): ImageProvider {
    const id = providerId ?? this.listReadyImageProviders()[0]?.id;
    if (!id) {
      throw new AIError({
        kind: 'not-configured',
        message:
          '还没有配置图片服务，请先在设置中心「AI → 图片」里填写 Seedream / MiniMax / Grok 图片的 Key',
      });
    }
    const config = this.mediaConfig('image', id);
    return this.registry.createImage(config.id, {
      apiKey: config.apiKey,
      baseUrl: config.stored.baseUrl,
      model: config.stored.model,
    });
  }

  /** 已配置且启用的配音服务（OpenAI 兼容配音 / MiniMax 语音合成，以及自己添加的） */
  listReadySpeechProviders(): AIProviderInfo[] {
    return this.listReady('speech');
  }

  getSpeechProvider(providerId?: string): SpeechProvider {
    const id = providerId ?? this.listReadySpeechProviders()[0]?.id;
    if (!id) {
      throw new AIError({
        kind: 'not-configured',
        message:
          '还没有配置配音服务，请先在设置中心「AI → 语音」里填写 OpenAI 兼容配音 / MiniMax 语音合成的 Key',
      });
    }
    const config = this.mediaConfig('speech', id);
    return this.registry.createSpeech(config.id, {
      apiKey: config.apiKey,
      baseUrl: config.stored.baseUrl,
      model: config.stored.model,
      voice: config.stored.voice,
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
    if (descriptor.kind === 'speech') {
      await this.registry.createSpeech(descriptor.id, config).testConnection({ signal });
      return;
    }
    await this.registry.createVideo(descriptor.id, config).testConnection({ signal });
  }

  /**
   * 请求参数 + 服务的生成参数：请求没有指定温度 / 回复长度时由 Provider 用服务的值；
   * 指定了回复长度时不超过服务的「单次回复长度」
   */
  private textRequest(payload: AICompletePayload) {
    const request = toCompletionRequest(payload);
    const id = requestedProviderId(payload) ?? this.resolveDefaultTextProviderId();
    const limit =
      this.registry.get(id)?.kind === 'text' ? this.textParams(id).maxTokens : undefined;
    if (typeof limit === 'number' && typeof request.maxTokens === 'number') {
      request.maxTokens = Math.min(request.maxTokens, limit);
    }
    return request;
  }

  async complete(payload: AICompletePayload, signal?: AbortSignal) {
    const provider = this.getTextProvider(requestedProviderId(payload));
    return provider.complete(this.textRequest(payload), { signal });
  }

  stream(payload: AICompletePayload, signal?: AbortSignal): AsyncIterable<StreamChunk> {
    const provider = this.getTextProvider(requestedProviderId(payload));
    return provider.stream(this.textRequest(payload), { signal });
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
