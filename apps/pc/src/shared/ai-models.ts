/**
 * AI 模型列表（设置中心「AI」的每个能力一张列表）：能力、服务商预设、校验常量
 *
 * - 一条「模型」= 一个可选用的配置：能力（文本 / 图片 / 视频 / 语音）+ 协议实现（vendor，注册表里的 Provider id）
 *   + 接口地址 + 模型 + 显示名称 + 参数；Key 在主进程 CredentialStore，按模型 id 保存
 * - 服务商预设只用于「添加模型」时预填协议、接口地址与推荐模型：Grok、DeepSeek、通义等都是 OpenAI 兼容协议的预设
 * - 主进程与渲染进程共用（纯数据，不依赖 Node / DOM）
 */

export type AICapability = 'text' | 'image' | 'video' | 'speech';

export const AI_CAPABILITIES: readonly AICapability[] = ['text', 'image', 'video', 'speech'];

/** 每个能力最多的模型数 */
export const MAX_MODELS_PER_CAPABILITY = 50;
/** 显示名称最长字符数 */
export const MODEL_LABEL_MAX = 80;
/** 模型名称最长字符数 */
export const MODEL_NAME_MAX = 200;
/** 模型 id：小写字母 / 数字 / 连字符（与 CredentialStore 的 id 规则一致） */
export const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** 预设 key */
export const PRESET_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function isAICapability(value: unknown): value is AICapability {
  return typeof value === 'string' && (AI_CAPABILITIES as readonly string[]).includes(value);
}

export interface AIModelPreset {
  key: string;
  capability: AICapability;
  /** 协议实现（注册表里的 Provider id） */
  vendor: string;
  /** 服务商名称（下拉选项） */
  label: string;
  /** 列表「服务商」列与默认显示名称用的简称（省略时同 label） */
  shortLabel?: string;
  /** 预填的接口地址（空 = 需要作者填写） */
  baseUrl: string;
  /** 推荐模型（第一个为默认） */
  models: readonly string[];
  /** 表单里的补充说明 */
  note?: string;
  /** API Key 的说明 */
  keyHint?: string;
  /** 语音：声音候选 */
  voices?: readonly string[];
}

const OPENAI_VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'];

export const AI_MODEL_PRESETS: readonly AIModelPreset[] = [
  // ─── 文本（除 Grok 外都走 OpenAI 兼容协议；Grok 用自己的实现，默认值不同） ───
  {
    key: 'openai',
    capability: 'text',
    vendor: 'openai-compatible',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-5.4-mini', 'gpt-5.4', 'gpt-5.4-nano'],
  },
  {
    key: 'deepseek',
    capability: 'text',
    vendor: 'openai-compatible',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    key: 'grok',
    capability: 'text',
    vendor: 'grok',
    label: 'xAI Grok',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-4', 'grok-4-fast', 'grok-3', 'grok-3-mini'],
  },
  {
    key: 'qwen',
    capability: 'text',
    vendor: 'openai-compatible',
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
  },
  {
    key: 'kimi',
    capability: 'text',
    vendor: 'openai-compatible',
    label: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2-turbo-preview', 'moonshot-v1-32k'],
  },
  {
    key: 'glm',
    capability: 'text',
    vendor: 'openai-compatible',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4.6', 'glm-4-flash'],
  },
  {
    key: 'ollama',
    capability: 'text',
    vendor: 'openai-compatible',
    label: 'Ollama（本地）',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: ['qwen3', 'llama3.1'],
    keyHint: '本地 Ollama 不校验 Key，随便填一个字符即可。',
  },
  {
    key: 'custom',
    capability: 'text',
    vendor: 'openai-compatible',
    label: '自定义（OpenAI 兼容）',
    shortLabel: 'OpenAI 兼容',
    baseUrl: '',
    models: [],
    note: '任何兼容 /chat/completions 的服务（OpenRouter、自建网关等）。',
  },
  // ─── 图片 ───
  {
    key: 'seedream',
    capability: 'image',
    vendor: 'seedream-image',
    label: 'Seedream（火山方舟）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['doubao-seedream-4-0-250828', 'doubao-seedream-4-5-251128'],
    note: '支持多张参考图（人物形象、三视图），出图时保持人物一致。',
  },
  {
    key: 'minimax-image',
    capability: 'image',
    vendor: 'minimax-image',
    label: 'MiniMax',
    baseUrl: 'https://api.minimax.cn',
    models: ['image-01'],
    note: '可用一张人物图作参考。',
  },
  {
    key: 'grok-image',
    capability: 'image',
    vendor: 'grok-image',
    label: 'xAI Grok',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-2-image'],
    note: '只支持文生图，不支持参考图。',
  },
  {
    key: 'openai-image',
    capability: 'image',
    vendor: 'grok-image',
    label: 'OpenAI 兼容图片',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-image-1', 'dall-e-3'],
    note: '兼容 /images/generations 的服务；只支持文生图。',
  },
  // ─── 视频 ───
  {
    key: 'minimax-video',
    capability: 'video',
    vendor: 'minimax-video',
    label: 'MiniMax 海螺',
    baseUrl: 'https://api.minimax.cn',
    models: ['MiniMax-Hailuo-02', 'MiniMax-Hailuo-2.3', 'T2V-01-Director', 'T2V-01'],
  },
  {
    key: 'seedance',
    capability: 'video',
    vendor: 'seedance-video',
    label: 'Seedance',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [
      'doubao-seedance-1-0-pro-250528',
      'doubao-seedance-1-0-lite-t2v-250428',
      'doubao-seedance-1-0-lite-i2v-250428',
      'doubao-seedance-2-0-fast-260128',
    ],
    note: '支持「生成声音」：在场景视频里打开后，成片带与画面同步的对白 / 音效（按厂商计费）。',
  },
  // ─── 语音 ───
  {
    key: 'openai-speech',
    capability: 'speech',
    vendor: 'openai-speech',
    label: 'OpenAI 兼容',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'],
    voices: OPENAI_VOICES,
  },
  {
    key: 'minimax-speech',
    capability: 'speech',
    vendor: 'minimax-speech',
    label: 'MiniMax',
    baseUrl: 'https://api.minimax.cn',
    models: ['speech-02-hd', 'speech-02-turbo'],
  },
];

/** 旧版内置服务（vendor id）→ 迁移后的预设 */
export const LEGACY_VENDOR_PRESETS: Readonly<Record<string, string>> = {
  'openai-compatible': 'custom',
  grok: 'grok',
  'seedream-image': 'seedream',
  'minimax-image': 'minimax-image',
  'grok-image': 'grok-image',
  'minimax-video': 'minimax-video',
  'seedance-video': 'seedance',
  'openai-speech': 'openai-speech',
  'minimax-speech': 'minimax-speech',
};

export function presetsFor(capability: AICapability): AIModelPreset[] {
  return AI_MODEL_PRESETS.filter((item) => item.capability === capability);
}

export function findPreset(key: string | undefined): AIModelPreset | undefined {
  return key ? AI_MODEL_PRESETS.find((item) => item.key === key) : undefined;
}

/** 某个协议实现的第一个预设（旧数据没有记录预设时用来显示服务商） */
export function presetForVendor(vendor: string): AIModelPreset | undefined {
  return findPreset(LEGACY_VENDOR_PRESETS[vendor]);
}

/** 服务商在列表与默认显示名称里的名字 */
export function presetProviderName(preset: AIModelPreset): string {
  return preset.shortLabel ?? preset.label;
}

/** 默认显示名称：「服务商 · 模型」（没有模型时只有服务商） */
export function defaultModelLabel(providerLabel: string, model: string): string {
  const name = model.trim();
  const text = name ? `${providerLabel} · ${name}` : providerLabel;
  return Array.from(text).slice(0, MODEL_LABEL_MAX).join('');
}
