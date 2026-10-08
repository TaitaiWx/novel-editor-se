/**
 * Provider 注册表：静态描述 + 工厂
 *
 * GUI 主进程与 CLI 各自创建注册表（createDefaultRegistry），按 id 取得 Provider 实例；
 * 密钥由调用方从安全存储（主进程 safeStorage）或环境变量（CLI）读取后传入。
 */
import { AIError } from './errors';
import { createGrokProvider, GROK_DEFAULTS } from './providers/grok';
import { createMinimaxVideoProvider, MINIMAX_VIDEO_DEFAULTS } from './providers/minimax-video';
import {
  createOpenAICompatibleProvider,
  OPENAI_COMPATIBLE_DEFAULTS,
} from './providers/openai-compatible';
import { createSeedanceVideoProvider, SEEDANCE_VIDEO_DEFAULTS } from './providers/seedance-video';
import {
  createGrokImageProvider,
  createMinimaxImageProvider,
  createSeedreamImageProvider,
  GROK_IMAGE_DEFAULTS,
  MINIMAX_IMAGE_DEFAULTS,
  SEEDREAM_IMAGE_DEFAULTS,
} from './providers/image';
import {
  createMinimaxSpeechProvider,
  createOpenAISpeechProvider,
  MINIMAX_SPEECH_DEFAULTS,
  OPENAI_SPEECH_DEFAULTS,
} from './providers/speech';
import type {
  ImageProvider,
  ProviderConfig,
  ProviderDescriptor,
  SpeechProvider,
  TextProvider,
  VideoProvider,
} from './types';

export type TextProviderFactory = (config: ProviderConfig) => TextProvider;
export type VideoProviderFactory = (config: ProviderConfig) => VideoProvider;
export type ImageProviderFactory = (config: ProviderConfig) => ImageProvider;
export type SpeechProviderFactory = (config: ProviderConfig) => SpeechProvider;

type Entry =
  | { descriptor: ProviderDescriptor & { kind: 'text' }; factory: TextProviderFactory }
  | { descriptor: ProviderDescriptor & { kind: 'video' }; factory: VideoProviderFactory }
  | { descriptor: ProviderDescriptor & { kind: 'image' }; factory: ImageProviderFactory }
  | { descriptor: ProviderDescriptor & { kind: 'speech' }; factory: SpeechProviderFactory };

/** CLI 环境变量名：NOVEL_EDITOR_<PROVIDER>_API_KEY（连字符转下划线、大写） */
export function providerEnvKey(providerId: string): string {
  return `NOVEL_EDITOR_${providerId.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}_API_KEY`;
}

export const BUILTIN_PROVIDERS: readonly ProviderDescriptor[] = [
  {
    id: 'openai-compatible',
    kind: 'text',
    label: 'OpenAI 兼容',
    description:
      'OpenAI、DeepSeek、OpenRouter 等兼容 /chat/completions 的服务（内置，地址与模型在设置中心填写）',
    defaultBaseUrl: OPENAI_COMPATIBLE_DEFAULTS.baseUrl,
    defaultModel: OPENAI_COMPATIBLE_DEFAULTS.model,
    models: [OPENAI_COMPATIBLE_DEFAULTS.model],
    envKey: providerEnvKey('openai-compatible'),
  },
  {
    id: 'grok',
    kind: 'text',
    label: 'xAI Grok',
    description: '续写与创作，OpenAI 兼容接口（https://api.x.ai/v1）',
    defaultBaseUrl: GROK_DEFAULTS.baseUrl,
    defaultModel: GROK_DEFAULTS.model,
    models: GROK_DEFAULTS.models,
    envKey: providerEnvKey('grok'),
    docsUrl: 'https://docs.x.ai/docs/api-reference',
  },
  {
    id: 'minimax-video',
    kind: 'video',
    label: 'MiniMax 海螺视频',
    description: '文生视频 / 图生视频（异步任务）',
    defaultBaseUrl: MINIMAX_VIDEO_DEFAULTS.baseUrl,
    defaultModel: MINIMAX_VIDEO_DEFAULTS.model,
    models: MINIMAX_VIDEO_DEFAULTS.models,
    envKey: providerEnvKey('minimax-video'),
    docsUrl: 'https://platform.minimax.cn/docs/api-reference/video-generation-t2v',
  },
  {
    id: 'seedance-video',
    kind: 'video',
    label: 'Seedance（火山方舟）',
    description: '字节跳动 Seedance 文生视频 / 图生视频（异步任务）',
    defaultBaseUrl: SEEDANCE_VIDEO_DEFAULTS.baseUrl,
    defaultModel: SEEDANCE_VIDEO_DEFAULTS.model,
    models: SEEDANCE_VIDEO_DEFAULTS.models,
    envKey: providerEnvKey('seedance-video'),
    docsUrl: 'https://www.volcengine.com/docs/82379/1520757',
    supportsAudio: true,
  },
  {
    id: 'seedream-image',
    kind: 'image',
    label: 'Seedream 图片（火山方舟）',
    description: '人物形象 / 三视图 / 服装 / 设定图，支持多张参考图（保持人物一致）',
    defaultBaseUrl: SEEDREAM_IMAGE_DEFAULTS.baseUrl,
    defaultModel: SEEDREAM_IMAGE_DEFAULTS.model,
    models: SEEDREAM_IMAGE_DEFAULTS.models,
    envKey: providerEnvKey('seedream-image'),
    docsUrl: 'https://www.volcengine.com/docs/82379/1541523',
  },
  {
    id: 'minimax-image',
    kind: 'image',
    label: 'MiniMax 图片',
    description: 'image-01 文生图，可用一张人物图作参考',
    defaultBaseUrl: MINIMAX_IMAGE_DEFAULTS.baseUrl,
    defaultModel: MINIMAX_IMAGE_DEFAULTS.model,
    models: MINIMAX_IMAGE_DEFAULTS.models,
    envKey: providerEnvKey('minimax-image'),
    docsUrl: 'https://platform.minimax.io/docs/guides/image-generation',
  },
  {
    id: 'grok-image',
    kind: 'image',
    label: 'xAI Grok 图片',
    description: 'Grok 文生图（不支持参考图）',
    defaultBaseUrl: GROK_IMAGE_DEFAULTS.baseUrl,
    defaultModel: GROK_IMAGE_DEFAULTS.model,
    models: GROK_IMAGE_DEFAULTS.models,
    envKey: providerEnvKey('grok-image'),
    docsUrl: 'https://docs.x.ai/docs/guides/image-generations',
  },
  {
    id: 'openai-speech',
    kind: 'speech',
    label: 'OpenAI 兼容配音',
    description: '场景视频的对白配音（/audio/speech，OpenAI 及兼容服务）',
    defaultBaseUrl: OPENAI_SPEECH_DEFAULTS.baseUrl,
    defaultModel: OPENAI_SPEECH_DEFAULTS.model,
    models: OPENAI_SPEECH_DEFAULTS.models,
    envKey: providerEnvKey('openai-speech'),
    docsUrl: 'https://platform.openai.com/docs/api-reference/audio/createSpeech',
  },
  {
    id: 'minimax-speech',
    kind: 'speech',
    label: 'MiniMax 语音合成',
    description: '场景视频的对白配音（T2A v2，多语种、多情绪）',
    defaultBaseUrl: MINIMAX_SPEECH_DEFAULTS.baseUrl,
    defaultModel: MINIMAX_SPEECH_DEFAULTS.model,
    models: MINIMAX_SPEECH_DEFAULTS.models,
    envKey: providerEnvKey('minimax-speech'),
    docsUrl: 'https://platform.minimaxi.com/document/T2A%20V2',
  },
];

export class ProviderRegistry {
  private readonly entries = new Map<string, Entry>();

  registerText(descriptor: ProviderDescriptor, factory: TextProviderFactory): this {
    if (descriptor.kind !== 'text') throw new Error(`${descriptor.id} 不是文本 Provider`);
    this.entries.set(descriptor.id, {
      descriptor: descriptor as ProviderDescriptor & { kind: 'text' },
      factory,
    });
    return this;
  }

  registerVideo(descriptor: ProviderDescriptor, factory: VideoProviderFactory): this {
    if (descriptor.kind !== 'video') throw new Error(`${descriptor.id} 不是视频 Provider`);
    this.entries.set(descriptor.id, {
      descriptor: descriptor as ProviderDescriptor & { kind: 'video' },
      factory,
    });
    return this;
  }

  registerImage(descriptor: ProviderDescriptor, factory: ImageProviderFactory): this {
    if (descriptor.kind !== 'image') throw new Error(`${descriptor.id} 不是图片 Provider`);
    this.entries.set(descriptor.id, {
      descriptor: descriptor as ProviderDescriptor & { kind: 'image' },
      factory,
    });
    return this;
  }

  registerSpeech(descriptor: ProviderDescriptor, factory: SpeechProviderFactory): this {
    if (descriptor.kind !== 'speech') throw new Error(`${descriptor.id} 不是配音 Provider`);
    this.entries.set(descriptor.id, {
      descriptor: descriptor as ProviderDescriptor & { kind: 'speech' },
      factory,
    });
    return this;
  }

  /**
   * 以已注册的厂商实现（baseId）登记一个新的 Provider：沿用它的工厂，只换描述（id / 名称等）。
   * 主进程的自定义视频 / 图片 / 语音服务（例如第二个 Seedance 账号）使用；kind 必须与厂商一致
   */
  registerVariant(baseId: string, descriptor: ProviderDescriptor): this {
    const base = this.entries.get(baseId);
    if (!base) throw unknownProvider(baseId);
    if (base.descriptor.kind !== descriptor.kind) {
      throw new Error(`${descriptor.id} 与 ${baseId} 的类型不一致`);
    }
    this.entries.set(descriptor.id, { ...base, descriptor } as Entry);
    return this;
  }

  /** 移除一个 Provider（主进程的自定义服务被删除时使用）；返回是否存在 */
  unregister(id: string): boolean {
    return this.entries.delete(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  get(id: string): ProviderDescriptor | undefined {
    return this.entries.get(id)?.descriptor;
  }

  list(kind?: ProviderDescriptor['kind']): ProviderDescriptor[] {
    return Array.from(this.entries.values())
      .map((entry) => entry.descriptor)
      .filter((descriptor) => !kind || descriptor.kind === kind);
  }

  createText(id: string, config: ProviderConfig): TextProvider {
    const entry = this.entries.get(id);
    if (!entry) throw unknownProvider(id);
    if (entry.descriptor.kind !== 'text') {
      throw new AIError({
        kind: 'bad-request',
        message: `${entry.descriptor.label} 不是文本服务`,
        providerId: id,
      });
    }
    return (entry.factory as TextProviderFactory)(config);
  }

  createVideo(id: string, config: ProviderConfig): VideoProvider {
    const entry = this.entries.get(id);
    if (!entry) throw unknownProvider(id);
    if (entry.descriptor.kind !== 'video') {
      throw new AIError({
        kind: 'bad-request',
        message: `${entry.descriptor.label} 不是视频服务`,
        providerId: id,
      });
    }
    return (entry.factory as VideoProviderFactory)(config);
  }

  createImage(id: string, config: ProviderConfig): ImageProvider {
    const entry = this.entries.get(id);
    if (!entry) throw unknownProvider(id);
    if (entry.descriptor.kind !== 'image') {
      throw new AIError({
        kind: 'bad-request',
        message: `${entry.descriptor.label} 不是图片服务`,
        providerId: id,
      });
    }
    return (entry.factory as ImageProviderFactory)(config);
  }

  createSpeech(id: string, config: ProviderConfig): SpeechProvider {
    const entry = this.entries.get(id);
    if (!entry) throw unknownProvider(id);
    if (entry.descriptor.kind !== 'speech') {
      throw new AIError({
        kind: 'bad-request',
        message: `${entry.descriptor.label} 不是配音服务`,
        providerId: id,
      });
    }
    return (entry.factory as SpeechProviderFactory)(config);
  }
}

function unknownProvider(id: string): AIError {
  return new AIError({ kind: 'bad-request', message: `未知的 AI 服务: ${id}`, providerId: id });
}

/** 内置 Provider（文本 / 视频 / 图片 / 配音）的注册表 */
export function createDefaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  const byId = (id: string) =>
    BUILTIN_PROVIDERS.find((item) => item.id === id) as ProviderDescriptor;
  registry.registerText(byId('openai-compatible'), (config) =>
    createOpenAICompatibleProvider(config)
  );
  registry.registerText(byId('grok'), createGrokProvider);
  registry.registerVideo(byId('minimax-video'), createMinimaxVideoProvider);
  registry.registerVideo(byId('seedance-video'), createSeedanceVideoProvider);
  registry.registerImage(byId('seedream-image'), createSeedreamImageProvider);
  registry.registerImage(byId('minimax-image'), createMinimaxImageProvider);
  registry.registerImage(byId('grok-image'), createGrokImageProvider);
  registry.registerSpeech(byId('openai-speech'), createOpenAISpeechProvider);
  registry.registerSpeech(byId('minimax-speech'), createMinimaxSpeechProvider);
  return registry;
}
