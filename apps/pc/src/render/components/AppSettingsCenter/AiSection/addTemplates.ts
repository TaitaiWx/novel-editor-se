/**
 * 「添加服务」表单的模板与草稿（纯函数）
 *
 * - 文本：常见 OpenAI 兼容服务模板（DeepSeek、通义千问、Kimi、智谱、本地 Ollama…）或自定义
 * - 视频 / 图片 / 语音：沿用某个内置厂商实现（候选来自服务列表里同类的内置服务）
 */
import type { AIProviderInfo } from '../../../types/ai-api';

export type ProviderKind = AIProviderInfo['kind'];

export interface TextTemplate {
  key: string;
  label: string;
  baseUrl: string;
  models: string[];
}

export const TEXT_TEMPLATES: readonly TextTemplate[] = [
  {
    key: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    key: 'qwen',
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
  },
  {
    key: 'kimi',
    label: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2-turbo-preview', 'moonshot-v1-32k'],
  },
  {
    key: 'glm',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4.6', 'glm-4-flash'],
  },
  {
    key: 'ollama',
    label: 'Ollama（本地）',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: ['qwen3', 'llama3.1'],
  },
  { key: 'custom', label: '其他兼容接口', baseUrl: '', models: [] },
];

/** 各类服务在界面上的称呼（按钮「添加文本 AI」「添加视频服务」…） */
export const KIND_NOUNS: Record<ProviderKind, string> = {
  text: '文本 AI',
  video: '视频服务',
  image: '图片服务',
  speech: '语音服务',
};

export interface AddDraft {
  /** 文本：模板 key；视频 / 图片 / 语音：沿用的厂商实现 id */
  template: string;
  label: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  pricePerSecond: number | null;
  voice: string;
}

const EMPTY_EXTRA = { apiKey: '', pricePerSecond: null, voice: '' };

export function textDraft(key: string): AddDraft {
  const template = TEXT_TEMPLATES.find((item) => item.key === key) ?? TEXT_TEMPLATES[0];
  return {
    template: template.key,
    label: template.key === 'custom' ? '' : template.label,
    baseUrl: template.baseUrl,
    model: template.models[0] ?? '',
    ...EMPTY_EXTRA,
  };
}

/**
 * 沿用某个厂商的草稿：名称默认为「厂商名 2」这样的序号（同名已存在时递增），
 * 地址 / 模型留空 = 使用厂商默认值
 */
export function vendorDraft(
  vendor: AIProviderInfo | undefined,
  existing: readonly AIProviderInfo[]
): AddDraft {
  if (!vendor) return { template: '', label: '', baseUrl: '', model: '', ...EMPTY_EXTRA };
  const names = new Set(existing.map((item) => item.label));
  let n = 2;
  while (names.has(`${vendor.label} ${n}`)) n += 1;
  return {
    template: vendor.id,
    label: `${vendor.label} ${n}`,
    baseUrl: '',
    model: '',
    ...EMPTY_EXTRA,
  };
}
