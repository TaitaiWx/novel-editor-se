/**
 * 各厂商表单需要的字段（每家只显示自己用得到的）
 */
import type { AIProviderInfo } from '../../../types/ai-api';

export type VendorField =
  | 'label'
  | 'key'
  | 'baseUrl'
  | 'model'
  | 'price'
  | 'voice'
  | 'temperature'
  | 'contextTokens'
  | 'maxTokens';

export interface VendorSpec {
  fields: VendorField[];
  /** 表单底部的说明 */
  note?: string;
  /** 声音候选（配音服务） */
  voices?: readonly string[];
  /** API Key 行的说明 */
  keyHint?: string;
}

const KEY_FIRST: VendorField[] = ['key', 'baseUrl', 'model'];

const OPENAI_VOICES = [
  'alloy',
  'ash',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
] as const;

const SPECS: Record<string, VendorSpec> = {
  grok: { fields: ['baseUrl', 'model', 'key'] },
  'minimax-video': { fields: [...KEY_FIRST, 'price'] },
  'seedance-video': {
    fields: [...KEY_FIRST, 'price'],
    note: '支持「生成声音」：在场景视频的生成设置里打开后，成片带与画面同步的对白 / 音效（按厂商计费）。',
  },
  'seedream-image': {
    fields: KEY_FIRST,
    note: '支持多张参考图（人物形象、三视图），出图时保持人物一致。',
  },
  'minimax-image': { fields: KEY_FIRST, note: '可用一张人物图作参考。' },
  'grok-image': { fields: KEY_FIRST, note: '只支持文生图，不支持参考图。' },
  'openai-speech': {
    fields: ['baseUrl', 'model', 'voice', 'key'],
    voices: OPENAI_VOICES,
  },
  'minimax-speech': { fields: KEY_FIRST },
};

const CUSTOM_TEXT: VendorSpec = {
  fields: ['label', 'baseUrl', 'model', 'key', 'temperature', 'contextTokens', 'maxTokens'],
  keyHint: '本地 Ollama 等不校验 Key 的服务，随便填一个字符即可。',
};

export function vendorSpec(info: AIProviderInfo): VendorSpec {
  if (info.custom) return CUSTOM_TEXT;
  return SPECS[info.id] ?? { fields: KEY_FIRST };
}
