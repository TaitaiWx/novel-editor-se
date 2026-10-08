/**
 * 主进程 AI 服务：模型列表（ProviderConfigStore）+ 安全密钥（CredentialStore）+ 协议实现注册表
 *
 * - 每个能力（文本 / 图片 / 视频 / 语音）一张模型列表；每条模型按自己的协议实现（vendor）实例化，
 *   用自己的接口地址、模型、参数与 Key（Key 按模型 id 保存）
 * - 每个能力一个默认模型（resolveDefaultId）：作者选定的 > 第一个可用的（已保存 Key 且启用）> 第一个；
 *   省略模型的请求（ai-request、续写自动、配音、图片）都走它
 * - 「启用 AI 功能」总开关（设置中心 JSON）约束默认文本模型的请求，与旧版一致
 * - 旧版内置 openai-compatible 的设置在数据库打开后导入为条目（legacy-settings.ts）
 * - invokeConfiguredAI 保持旧版签名与「不抛异常」语义
 */
import {
  AIError,
  createDefaultRegistry,
  toAIError,
  type ImageProvider,
  type ProviderConfig,
  type ProviderDescriptor,
  type ProviderRegistry,
  type SpeechProvider,
  type StreamChunk,
  type TextProvider,
  type VideoProvider,
} from '@novel-editor/ai';
import type {
  AICompletePayload,
  AIModelInput,
  AIProviderInfo,
  AIProviderUpdate,
} from '../../shared/ai';
import {
  isAICapability,
  presetForVendor,
  findPreset,
  type AICapability,
} from '../../shared/ai-models';
import type { CredentialStore } from './credential-store';
import { reconcileLegacySettings } from './legacy-settings';
import {
  addModel,
  badRequest,
  effectiveBaseUrl,
  ensureLegacyEntry,
  providerLabelOf,
  removeModel,
  updateModel,
  type ModelActionDeps,
} from './model-actions';
import { isModelId, type ModelEntry, type ProviderConfigStore } from './provider-config';
import { parseDefaultTextSettings, requestedProviderId, toCompletionRequest } from './request';
import { SETTINGS_CENTER_KEY } from './settings-secrets';

export {
  legacyPayloadToMessages,
  parseDefaultTextSettings,
  sanitizeMessages,
  toCompletionRequest,
} from './request';

const CAPABILITY_NOUNS: Record<AICapability, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  speech: '配音',
};

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
}

/** 默认文本模型的摘要（注入设置中心 JSON，供渲染进程判断「AI 是否可用」） */
export interface DefaultTextSummary {
  id: string;
  label: string;
  /** 已保存 Key、已启用且接口地址完整 */
  ready: boolean;
  /** 已保存 Key */
  hasKey: boolean;
  contextTokens?: number;
}

export class AIService {
  readonly registry: ProviderRegistry;

  constructor(private readonly deps: AIServiceDeps) {
    this.registry = deps.registry ?? createDefaultRegistry();
  }

  private get actionDeps(): ModelActionDeps {
    return {
      credentials: this.deps.credentials,
      configs: this.deps.configs,
      registry: this.registry,
    };
  }

  /** 数据库打开后导入旧版内置文本 AI 的设置（失败不影响其他功能） */
  private reconcile(): void {
    try {
      reconcileLegacySettings(this.deps.readSettings(), this.deps.configs, this.deps.credentials);
    } catch (error) {
      console.warn('[ai] 导入旧版 AI 设置失败:', error);
    }
  }

  private entries(capability?: AICapability): ModelEntry[] {
    this.reconcile();
    return this.deps.configs.list(capability);
  }

  /**
   * 按 id 取模型；不存在时 bad-request。
   * 旧版内置服务 id（grok、minimax-video…）还没有模型时：安全存储里有它的 Key 就以这个 id 补建
   * （兜底：迁移时钥匙串暂不可读等情况），没有 Key 则报 not-configured（与旧版提示一致）
   */
  private entry(id: unknown): ModelEntry {
    const entry = isModelId(id) ? this.deps.configs.getEntry(id) : undefined;
    if (entry) return entry;
    const builtin = isModelId(id) ? this.registry.get(id) : undefined;
    if (builtin && isModelId(id)) {
      if (this.deps.credentials.has(id)) {
        ensureLegacyEntry(this.actionDeps, id, { model: '' });
        const adopted = this.deps.configs.getEntry(id);
        if (adopted) return adopted;
      }
      throw new AIError({
        kind: 'not-configured',
        message: `未配置 ${builtin.label} 的 API Key，请先在设置中心填写`,
        providerId: id,
      });
    }
    throw new AIError({
      kind: 'bad-request',
      message: `未知的 AI 模型: ${String(id)}`,
      providerId: typeof id === 'string' ? id : undefined,
    });
  }

  private descriptorOf(entry: ModelEntry): ProviderDescriptor | undefined {
    return this.registry.get(entry.vendor);
  }

  /** 实际使用的接口地址 / 模型（没有填写时为协议默认） */
  private effective(entry: ModelEntry): { baseUrl: string; model: string } {
    const descriptor = this.descriptorOf(entry);
    return {
      baseUrl: effectiveBaseUrl(entry, descriptor),
      model: entry.model || descriptor?.defaultModel || '',
    };
  }

  private isReady(entry: ModelEntry): boolean {
    return entry.enabled && this.deps.credentials.has(entry.id);
  }

  /** 某个能力的默认模型：选定的 > 第一个可用的 > 第一个；没有模型时 undefined */
  resolveDefaultId(capability: AICapability): string | undefined {
    const list = this.entries(capability);
    if (list.length === 0) return undefined;
    const chosen = this.deps.configs.getDefaultId(capability);
    if (chosen && list.some((item) => item.id === chosen)) return chosen;
    return (list.find((item) => this.isReady(item)) ?? list[0]).id;
  }

  /** 默认文本模型（旧名称） */
  resolveDefaultTextProviderId(): string | undefined {
    return this.resolveDefaultId('text');
  }

  private toInfo(entry: ModelEntry, defaultId: string | undefined): AIProviderInfo {
    const descriptor = this.descriptorOf(entry);
    const capability = entry.capability;
    const isDefault = entry.id === defaultId;
    const preset = findPreset(entry.preset) ?? presetForVendor(entry.vendor);
    const suggestions =
      preset && preset.capability === capability && preset.models.length > 0
        ? preset.models
        : (descriptor?.models ?? []);
    const { baseUrl, model } = this.effective(entry);
    return {
      id: entry.id,
      kind: capability,
      capability,
      vendor: entry.vendor,
      label: entry.label,
      ...(entry.preset ? { preset: entry.preset } : {}),
      providerLabel: providerLabelOf(entry, descriptor),
      description: descriptor?.description ?? '',
      defaultBaseUrl: descriptor?.defaultBaseUrl ?? '',
      defaultModel: descriptor?.defaultModel ?? '',
      models: suggestions,
      ...(descriptor?.docsUrl ? { docsUrl: descriptor.docsUrl } : {}),
      ...(descriptor?.supportsAudio ? { supportsAudio: true } : {}),
      configured: this.deps.credentials.has(entry.id),
      secureStorage: this.deps.credentials.isSecure(),
      enabled: entry.enabled,
      baseUrl,
      model,
      isDefault,
      ...(capability === 'text'
        ? {
            isDefaultText: isDefault,
            temperature: entry.temperature,
            maxTokens: entry.maxTokens,
            contextTokens: entry.contextTokens,
          }
        : {}),
      ...(capability === 'video'
        ? { pricePerSecond: entry.pricePerSecond, currency: entry.currency ?? 'CNY' }
        : {}),
      ...(capability === 'speech' && entry.voice ? { voice: entry.voice } : {}),
    };
  }

  /** 设置中心与各功能的模型列表：不含任何密钥 */
  listProviders(): AIProviderInfo[] {
    const list = this.entries();
    const defaults = new Map<AICapability, string | undefined>();
    for (const entry of list) {
      if (!defaults.has(entry.capability)) {
        defaults.set(entry.capability, this.resolveDefaultId(entry.capability));
      }
    }
    return list.map((entry) => this.toInfo(entry, defaults.get(entry.capability)));
  }

  getProviderInfo(id: unknown): AIProviderInfo {
    this.reconcile();
    const entry = this.entry(id);
    return this.toInfo(entry, this.resolveDefaultId(entry.capability));
  }

  /** 默认文本模型的摘要；没有文本模型时返回 null */
  describeDefaultText(): DefaultTextSummary | null {
    const id = this.resolveDefaultId('text');
    if (!id) return null;
    const entry = this.entry(id);
    const hasKey = this.deps.credentials.has(id);
    return {
      id,
      label: entry.label,
      hasKey,
      ready: hasKey && entry.enabled && Boolean(this.effective(entry).baseUrl),
      ...(typeof entry.contextTokens === 'number' ? { contextTokens: entry.contextTokens } : {}),
    };
  }

  // ─── 模型增删改 ─────────────────────────────────────────────────────

  addModel(input: AIModelInput): AIProviderInfo {
    this.reconcile();
    const entry = addModel(this.actionDeps, input);
    return this.getProviderInfo(entry.id);
  }

  updateModel(id: unknown, update: AIProviderUpdate): AIProviderInfo {
    this.reconcile();
    const entry = updateModel(this.actionDeps, id, update);
    return this.getProviderInfo(entry.id);
  }

  /** 旧版 ai-providers-set：内置服务 id 还没有模型时以这个 id 新建 */
  updateProvider(id: unknown, update: AIProviderUpdate): AIProviderInfo {
    this.reconcile();
    if (!isModelId(id)) throw badRequest('无效的模型 id');
    if (!this.deps.configs.getEntry(id)) {
      if (this.deps.credentials.has(id) && this.registry.get(id)) this.entry(id);
      else if (update && typeof update === 'object') {
        ensureLegacyEntry(this.actionDeps, id, update);
      }
    }
    return this.updateModel(id, update);
  }

  removeModel(id: unknown): boolean {
    return removeModel(this.actionDeps, id);
  }

  /** 设置某个能力的默认模型；null 清除（之后按第一个可用的） */
  setDefaultModel(capability: unknown, id: unknown): AIProviderInfo[] {
    if (!isAICapability(capability)) throw badRequest('无效的模型类型');
    if (id === null || id === undefined || id === '') {
      this.deps.configs.setDefaultId(capability, undefined);
    } else {
      const entry = this.entry(id);
      if (entry.capability !== capability) {
        throw badRequest(`${entry.label} 不是${CAPABILITY_NOUNS[capability]}模型`);
      }
      this.deps.configs.setDefaultId(capability, entry.id);
    }
    return this.listProviders();
  }

  // ─── 取得可用的 Provider ────────────────────────────────────────────

  /** 总开关（设置中心 JSON）；没有显式开关时按默认文本模型是否保存了 Key 推断 */
  private masterEnabled(defaultId: string | undefined): boolean {
    const hasKey = defaultId ? this.deps.credentials.has(defaultId) : false;
    return parseDefaultTextSettings(this.deps.readSettings(), hasKey).enabled;
  }

  /** 某个能力的可用模型配置：类型不符 bad-request，未启用 / 没有 Key not-configured */
  private ready(
    capability: AICapability,
    id: string
  ): { entry: ModelEntry; config: ProviderConfig } {
    const entry = this.entry(id);
    if (entry.capability !== capability) {
      throw new AIError({
        kind: 'bad-request',
        message: `${entry.label} 不是${CAPABILITY_NOUNS[capability]}服务`,
        providerId: id,
      });
    }
    if (!entry.enabled) {
      throw new AIError({
        kind: 'not-configured',
        message: `${entry.label} 未启用，请先在设置中心开启`,
        providerId: id,
      });
    }
    const apiKey = this.deps.credentials.get(entry.id);
    if (!apiKey) {
      throw new AIError({
        kind: 'not-configured',
        message: `未配置 ${entry.label} 的 API Key，请先在设置中心填写`,
        providerId: id,
      });
    }
    const { baseUrl, model } = this.effective(entry);
    return { entry, config: { apiKey, baseUrl, model } };
  }

  /**
   * 文本 Provider；省略 id 时用默认文本模型。默认文本模型受「启用 AI 功能」总开关约束；
   * 请求没有指定温度 / 回复长度时用模型自己的参数
   */
  getTextProvider(providerId?: string): TextProvider {
    this.reconcile();
    const defaultId = this.resolveDefaultId('text');
    const id = providerId ?? defaultId;
    if ((providerId === undefined || providerId === defaultId) && !this.masterEnabled(defaultId)) {
      throw new AIError({
        kind: 'not-configured',
        message: 'AI 功能未启用，请先在设置中心开启',
        providerId: id,
      });
    }
    if (!id) {
      throw new AIError({
        kind: 'not-configured',
        message: '未配置 AI Key，请先在设置中心填写 API Key',
      });
    }
    const { entry, config } = this.ready('text', id);
    if (!config.baseUrl) {
      throw new AIError({
        kind: 'not-configured',
        message: `${entry.label} 没有填写接口地址`,
        providerId: id,
      });
    }
    return this.registry.createText(entry.vendor, {
      ...config,
      temperature: entry.temperature,
      maxTokens: entry.maxTokens,
    });
  }

  getVideoProvider(providerId: string): VideoProvider {
    const { entry, config } = this.ready('video', providerId);
    return this.registry.createVideo(entry.vendor, config);
  }

  getImageProvider(providerId?: string): ImageProvider {
    const id = providerId ?? this.resolveDefaultId('image');
    if (!id) {
      throw new AIError({
        kind: 'not-configured',
        message: '还没有图片模型，请先在设置中心「AI → 图片」里添加模型',
      });
    }
    const { entry, config } = this.ready('image', id);
    return this.registry.createImage(entry.vendor, config);
  }

  getSpeechProvider(providerId?: string): SpeechProvider {
    const id = providerId ?? this.resolveDefaultId('speech');
    if (!id) {
      throw new AIError({
        kind: 'not-configured',
        message: '还没有配音模型，请先在设置中心「AI → 语音」里添加模型',
      });
    }
    const { entry, config } = this.ready('speech', id);
    return this.registry.createSpeech(entry.vendor, { ...config, voice: entry.voice });
  }

  /** 测试连接：使用已保存的 Key；未启用的模型也允许测试 */
  async testProvider(providerId: unknown, signal?: AbortSignal): Promise<void> {
    this.reconcile();
    const entry = this.entry(providerId);
    const apiKey = this.deps.credentials.get(entry.id);
    if (!apiKey) {
      throw new AIError({
        kind: 'not-configured',
        message: '请先填写并保存 API Key',
        providerId: entry.id,
      });
    }
    const config = { apiKey, ...this.effective(entry) };
    const call = { signal };
    switch (entry.capability) {
      case 'text':
        await this.registry.createText(entry.vendor, config).testConnection(call);
        return;
      case 'image':
        await this.registry.createImage(entry.vendor, config).testConnection(call);
        return;
      case 'speech':
        await this.registry.createSpeech(entry.vendor, config).testConnection(call);
        return;
      default:
        await this.registry.createVideo(entry.vendor, config).testConnection(call);
    }
  }

  /** 请求参数：指定了回复长度时不超过模型的「单次回复长度」 */
  private textRequest(payload: AICompletePayload) {
    const request = toCompletionRequest(payload);
    const id = requestedProviderId(payload) ?? this.resolveDefaultId('text');
    const entry = id ? this.deps.configs.getEntry(id) : undefined;
    const limit = entry?.capability === 'text' ? entry.maxTokens : undefined;
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
      // 保持旧版文案：直接返回厂商 / 网络的原始信息
      return { ok: false, error: toAIError(error).message };
    }
  }
}

export { SETTINGS_CENTER_KEY };
