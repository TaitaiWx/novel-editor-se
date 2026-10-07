import type { AIPresetKey, AIProvider } from '../../utils/appSettings';

export type SettingsTab = 'general' | 'structure' | 'ai' | 'data' | 'shortcuts' | 'about';
export type ClearDataScope = 'document' | 'ai' | 'all';

export interface SystemProfileInfo {
  isLowSpec: boolean;
  totalMemoryGB: number;
  cpuCount: number;
  cpuSpeedMHz: number;
  reasons: string[];
}

export const VALID_TABS: SettingsTab[] = [
  'general',
  'structure',
  'ai',
  'data',
  'shortcuts',
  'about',
];

/** AI 服务预设 */
export interface AIPresetOption {
  key: AIPresetKey;
  label: string;
  provider: AIProvider;
  baseUrl: string;
  models: string[];
  defaultTemperature: number;
  defaultContextTokens: number;
}

export const AI_PRESET_OPTIONS: AIPresetOption[] = [
  {
    key: 'openai-official',
    label: 'OpenAI 官方',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.4'],
    defaultTemperature: 1.3,
    defaultContextTokens: 128000,
  },
  {
    key: 'deepseek-official',
    label: 'DeepSeek 官方',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultTemperature: 1.3,
    defaultContextTokens: 128000,
  },
  {
    key: 'openrouter',
    label: 'OpenRouter',
    provider: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['openai/gpt-5.4-mini', 'deepseek/deepseek-chat-v3-0324'],
    defaultTemperature: 1.3,
    defaultContextTokens: 128000,
  },
  {
    key: 'copilot',
    label: 'Copilot / GitHub Models',
    provider: 'openai-compatible',
    baseUrl: 'https://models.inference.ai.azure.com',
    models: ['gpt-4.1', 'gpt-4o-mini', 'DeepSeek-R1'],
    defaultTemperature: 1.3,
    defaultContextTokens: 128000,
  },
  {
    key: 'custom',
    label: '自定义兼容接口',
    provider: 'openai-compatible',
    baseUrl: '',
    models: [],
    defaultTemperature: 1.3,
    defaultContextTokens: 128000,
  },
];

export const TAB_LABELS: Record<SettingsTab, string> = {
  general: '通用',
  structure: '正文结构',
  ai: 'AI',
  data: '数据与缓存',
  shortcuts: '快捷键',
  about: '关于',
};
