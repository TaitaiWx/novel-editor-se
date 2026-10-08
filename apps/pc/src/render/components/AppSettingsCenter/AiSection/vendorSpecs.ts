/**
 * 各厂商表单需要的字段（每家只显示自己用得到的）。
 * 文本服务的「生成参数」（温度 / 上下文长度 / 单次回复长度）不在这里：每个文本服务都显示同一组（GenerationParams）。
 * 自己添加的视频 / 图片 / 语音服务按沿用的厂商实现（info.vendor）取字段，并在最前面加「名称」。
 */
import type { AIProviderInfo } from '../../../types/ai-api';

export type VendorField = 'label' | 'key' | 'baseUrl' | 'model' | 'price' | 'voice';

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
  fields: ['label', 'baseUrl', 'model', 'key'],
  keyHint: '本地 Ollama 等不校验 Key 的服务，随便填一个字符即可。',
};

/** 厂商实现自己的字段（内置服务按 id，自己添加的媒体服务按沿用的厂商） */
export function vendorSpecById(vendorId: string): VendorSpec {
  return SPECS[vendorId] ?? { fields: KEY_FIRST };
}

export function vendorSpec(info: AIProviderInfo): VendorSpec {
  if (info.custom && info.kind === 'text') return CUSTOM_TEXT;
  if (info.custom) {
    const base = vendorSpecById(info.vendor ?? '');
    return { ...base, fields: ['label', ...base.fields.filter((field) => field !== 'label')] };
  }
  return vendorSpecById(info.id);
}

/** 语音服务的声音候选（按厂商） */
export function voiceSuggestions(vendorId: string): readonly string[] {
  return SPECS[vendorId]?.voices ?? [];
}
