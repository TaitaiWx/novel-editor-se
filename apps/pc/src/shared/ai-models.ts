/**
 * AI 模型列表（设置中心「AI」的每个能力一张列表）：能力、服务商预设、校验常量
 *
 * - 一条「模型」= 一个可选用的配置：能力（文本 / 图片 / 视频 / 语音）+ 协议实现（vendor，注册表里的 Provider id）
 *   + 接口地址 + 模型 + 显示名称 + 参数；Key 在主进程 CredentialStore，按模型 id 保存
 * - 服务商预设只用于「添加模型」时预填协议、接口地址与推荐模型：Grok、DeepSeek、通义等都是 OpenAI 兼容协议的预设
 * - 主进程与渲染进程共用（纯数据，不依赖 Node / DOM）
 * - 预设只影响「新添加的模型」与模型建议列表：已保存的模型条目保留自己的接口地址与模型名，不会被改写
 * - 每个预设上方注明核对的官方文档地址与日期；文档无法访问时保留原值并标注「未能核对（日期）」
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
  /** 与 baseUrl 等价的旧地址（旧版预设填过、厂商文档写明仍可用）：沿用 Key 时视为同一地址 */
  baseUrlAliases?: readonly string[];
  /** 推荐模型（第一个为默认） */
  models: readonly string[];
  /** 表单里的补充说明 */
  note?: string;
  /** API Key 的说明 */
  keyHint?: string;
  /** 语音：声音候选 */
  voices?: readonly string[];
  /** 境外服务（国内通常直连不了）：「添加模型」默认勾选「通过代理访问」 */
  suggestProxy?: boolean;
}

// OpenAI 内置音色（2026-10-08 核对 https://developers.openai.com/api/docs/guides/text-to-speech；
// 文档推荐 marin / cedar，ballad / verse / marin / cedar 只有 gpt-4o-mini-tts 支持）
const OPENAI_VOICES = [
  'marin',
  'cedar',
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
];

export const AI_MODEL_PRESETS: readonly AIModelPreset[] = [
  // ─── 文本（除 Grok 外都走 OpenAI 兼容协议；Grok 用自己的实现，默认值不同） ───
  // 2026-10-08 核对 https://developers.openai.com/api/docs/models（gpt-6-luna 支持 /chat/completions；
  // gpt-5.4-nano 已标记弃用，不再推荐）
  {
    key: 'openai',
    suggestProxy: true,
    capability: 'text',
    vendor: 'openai-compatible',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-5.4-mini'],
  },
  // 2026-10-08 核对 https://api-docs.deepseek.com/：OpenAI 格式 base_url 为 https://api.deepseek.com
  // （不带 /v1，客户端拼成 /chat/completions；带 /v1 的旧地址 DeepSeek 同样接受），
  // Anthropic 格式为 https://api.deepseek.com/anthropic（本应用不用）。推荐 deepseek-flash；
  // 旧名 deepseek-v4-flash / deepseek-v4-flash-vision-exp 仍可调用，由 DeepSeek-V4.1-Flash 提供服务
  {
    key: 'deepseek',
    capability: 'text',
    vendor: 'openai-compatible',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    baseUrlAliases: ['https://api.deepseek.com/v1'],
    models: ['deepseek-flash', 'deepseek-v4-pro'],
  },
  // 2026-10-08 核对 https://docs.x.ai/docs/models（grok-4.7 为旗舰）与 https://docs.x.ai/docs/api-reference
  // （base https://api.x.ai/v1；xAI 推荐 Responses API，/chat/completions 标为 deprecated 但未给下线日期）
  {
    key: 'grok',
    suggestProxy: true,
    capability: 'text',
    vendor: 'grok',
    label: 'xAI Grok',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-4.7', 'grok-4.6', 'grok-4.3', 'grok-4.20-0309-non-reasoning'],
  },
  // 2026-10-08 核对 https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope
  // （推荐业务空间专属域名 https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1，
  // 文档写明原 dashscope.aliyuncs.com 域名仍可正常使用，预设沿用它以免作者填写 WorkspaceId）
  // 与 https://help.aliyun.com/zh/model-studio/models（qwen3.8-max / qwen3.7-plus / qwen3.8-flash）
  {
    key: 'qwen',
    capability: 'text',
    vendor: 'openai-compatible',
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3.7-plus', 'qwen3.8-max', 'qwen3.8-flash', 'qwen-plus'],
  },
  // 2026-10-08 核对 https://platform.kimi.com/docs/intro（原 platform.moonshot.cn，base 仍为 api.moonshot.cn/v1）
  {
    key: 'kimi',
    capability: 'text',
    vendor: 'openai-compatible',
    label: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k3', 'kimi-k2.6'],
  },
  // 2026-10-08 核对 https://docs.bigmodel.cn/cn/guide/develop/openai/introduction
  // 与 https://docs.bigmodel.cn/cn/guide/start/model-overview（glm-4.7-flash 为免费模型）
  {
    key: 'glm',
    capability: 'text',
    vendor: 'openai-compatible',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-5.3', 'glm-5.3-flash', 'glm-4.7-flash'],
  },
  // 2026-10-08 核对 https://docs.ollama.com/api/openai-compatibility（本地 http://localhost:11434/v1，
  // 示例模型 llama3.2 / qwen3:8b，需先 ollama pull）
  {
    key: 'ollama',
    capability: 'text',
    vendor: 'openai-compatible',
    label: 'Ollama（本地）',
    baseUrl: 'http://localhost:11434/v1',
    baseUrlAliases: ['http://127.0.0.1:11434/v1'],
    models: ['qwen3:8b', 'llama3.2'],
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
  // 2026-10-08 核对 https://www.volcengine.com/docs/82379/1330310（模型列表；4.0 / 4.5 标「即将下线」，
  // 5.0 系列中只有 doubao-seedream-5-0-260128 支持组图）与 https://www.volcengine.com/docs/82379/1541523
  {
    key: 'seedream',
    capability: 'image',
    vendor: 'seedream-image',
    label: 'Seedream（火山方舟）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [
      'doubao-seedream-5-0-260128',
      'doubao-seedream-5-0-pro-260628',
      'doubao-seedream-5-0-flash-260915',
    ],
    note: '支持多张参考图（人物形象、三视图），出图时保持人物一致。',
  },
  // 2026-10-08 核对 https://platform.minimax.cn/docs/api-reference/image-generation-t2i
  // （国内站 https://api.minimax.cn；国际站为 https://api.minimax.io）
  {
    key: 'minimax-image',
    capability: 'image',
    vendor: 'minimax-image',
    label: 'MiniMax',
    baseUrl: 'https://api.minimax.cn',
    models: ['image-01', 'image-01-live'],
    note: '可用一张人物图作参考。',
  },
  // 2026-10-08 核对 https://docs.x.ai/docs/guides/image-generations（grok-2-image 已不在模型列表）
  {
    key: 'grok-image',
    suggestProxy: true,
    capability: 'image',
    vendor: 'grok-image',
    label: 'xAI Grok',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-imagine-image', 'grok-imagine-image-2.0', 'grok-imagine-image-quality'],
    note: '这里只用文生图，不使用参考图。',
  },
  // 2026-10-08 核对 https://developers.openai.com/api/docs/guides/image-generation
  // （gpt-image-1 已标记弃用，dall-e-3 不在模型列表）
  {
    key: 'openai-image',
    suggestProxy: true,
    capability: 'image',
    vendor: 'grok-image',
    label: 'OpenAI 兼容图片',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2'],
    note: '兼容 /images/generations 的服务；只支持文生图。',
  },
  // ─── 视频 ───
  // 2026-10-08 核对 https://platform.minimax.cn/docs/api-reference/video-generation-t2v
  // （国内站 https://api.minimax.cn；国际站 https://api.minimax.io）
  {
    key: 'minimax-video',
    capability: 'video',
    vendor: 'minimax-video',
    label: 'MiniMax 海螺',
    baseUrl: 'https://api.minimax.cn',
    models: ['MiniMax-Hailuo-02', 'MiniMax-Hailuo-2.3', 'T2V-01-Director', 'T2V-01'],
  },
  // 2026-10-08 核对 https://www.volcengine.com/docs/82379/1330310（1.0 pro 系列标「即将下线」，1.0 lite 已不在列表）
  // 与 https://www.volcengine.com/docs/82379/1520757（POST {base}/contents/generations/tasks）
  {
    key: 'seedance',
    capability: 'video',
    vendor: 'seedance-video',
    label: 'Seedance',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [
      'doubao-seedance-2-0-260128',
      'doubao-seedance-2-0-fast-260128',
      'doubao-seedance-2-5-260628',
      'doubao-seedance-2-0-mini-260615',
    ],
    note: '支持「生成声音」：在场景视频里打开后，成片带与画面同步的对白 / 音效（按厂商计费）。',
  },
  // ─── 语音 ───
  // 2026-10-08 核对 https://developers.openai.com/api/docs/guides/text-to-speech 与模型列表
  // （tts-1 / tts-1-hd 已标记弃用，不再推荐）
  {
    key: 'openai-speech',
    suggestProxy: true,
    capability: 'speech',
    vendor: 'openai-speech',
    label: 'OpenAI 兼容',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini-tts'],
    voices: OPENAI_VOICES,
  },
  // 2026-10-08 核对 https://platform.minimax.cn/docs/api-reference/speech-t2a-http（国内站 api.minimax.cn）
  {
    key: 'minimax-speech',
    capability: 'speech',
    vendor: 'minimax-speech',
    label: 'MiniMax',
    baseUrl: 'https://api.minimax.cn',
    models: ['speech-2.8-hd', 'speech-2.8-turbo', 'speech-2.6-hd', 'speech-02-hd'],
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

const trimBaseUrl = (value: string): string => value.trim().replace(/\/+$/, '');

/**
 * 两个接口地址是否指向同一服务（沿用 Key 用）：去掉末尾斜杠后相同，
 * 或同属某个预设的「当前地址 + 等价旧地址」（例如 DeepSeek 带 / 不带 /v1）
 */
export function sameServiceBaseUrl(a: string, b: string): boolean {
  const left = trimBaseUrl(a);
  const right = trimBaseUrl(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return AI_MODEL_PRESETS.some((preset) => {
    const group = [preset.baseUrl, ...(preset.baseUrlAliases ?? [])].map(trimBaseUrl);
    return group.includes(left) && group.includes(right);
  });
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
