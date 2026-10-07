import {
  isDesignEmpty,
  parseCharacterDesign,
  parseMediaItems,
  type CharacterDesign,
  type MediaItem,
} from '@novel-editor/core/entity-media';
import { parseCharacterVoice, type CharacterVoice } from '@novel-editor/video';
import type { Character, CharacterCategory, CharacterCurrentStateItem } from '../types';
import { fnv1a32 } from './hash';

export interface CharacterAttributesPayload {
  /** 形象图（封面）：图集里选中的图片，或旧版单张头像（资料/人物头像/ 或 data URL） */
  avatar?: string;
  /** 人物设计：外貌、服装、性格、背景、说话方式（AI 出图 / 续写 / 场景视频读取） */
  design?: CharacterDesign;
  /** 图集：形象图、三视图、服装、表情、背景 */
  media?: MediaItem[];
  /** 声音（对白配音）：厂商音色 id、性别、年龄、音色描述，可选 */
  voice?: CharacterVoice;
  aliases?: string[];
  category?: CharacterCategory;
  highlightColor?: string;
  highlightFirstMentionOnly?: boolean;
  currentState?: CharacterCurrentStateItem[];
}

export const DEFAULT_CHARACTER_HIGHLIGHT_COLOR = '#9cdcfe';
export const DEFAULT_CHARACTER_HIGHLIGHT_FIRST_MENTION_ONLY = true;
export const CHARACTER_CATEGORY_LABELS: Record<CharacterCategory, string> = {
  major: '主要角色',
  secondary: '次要角色',
};

export function inferCharacterCategoryFromRole(role: string): CharacterCategory {
  const normalizedRole = role.trim();
  return /\u4e3b\u89d2|\u4e3b\u4eba\u516c|\u7537\u4e3b|\u5973\u4e3b|\u6838\u5fc3|\u4e3b\u7ebf/.test(
    normalizedRole
  )
    ? 'major'
    : 'secondary';
}

export function normalizeCharacterCategory(value: unknown, role = ''): CharacterCategory {
  if (typeof value === 'string') {
    const normalizedValue = value.trim().toLowerCase();
    if (
      normalizedValue === 'major' ||
      normalizedValue === '主要角色' ||
      normalizedValue === '主要' ||
      normalizedValue === '主角色'
    ) {
      return 'major';
    }
    if (
      normalizedValue === 'secondary' ||
      normalizedValue === '次要角色' ||
      normalizedValue === '次要' ||
      normalizedValue === '配角'
    ) {
      return 'secondary';
    }
  }
  return inferCharacterCategoryFromRole(role);
}

function normalizeCharacterAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function normalizeCharacterCurrentStateItems(value: unknown): CharacterCurrentStateItem[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const candidate = item as Record<string, unknown>;
      const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
      const currentValue = typeof candidate.value === 'string' ? candidate.value.trim() : '';
      if (!label || !currentValue) return null;
      const rawId = typeof candidate.id === 'string' ? candidate.id.trim() : '';
      return {
        id: rawId || fnv1a32(`${label}:${currentValue}:${index}`),
        label,
        value: currentValue,
      } satisfies CharacterCurrentStateItem;
    })
    .filter((item): item is CharacterCurrentStateItem => Boolean(item));
}

function normalizeCharacterHighlightColor(value: unknown): string {
  if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim())) {
    return value.trim().toLowerCase();
  }
  return DEFAULT_CHARACTER_HIGHLIGHT_COLOR;
}

export function parseCharacterAttributes(
  attributes: string,
  role: string = ''
): {
  avatar?: string;
  design: CharacterDesign;
  media: MediaItem[];
  voice?: CharacterVoice;
  aliases: string[];
  category: CharacterCategory;
  highlightColor: string;
  highlightFirstMentionOnly: boolean;
  currentState: CharacterCurrentStateItem[];
} {
  try {
    const parsed = JSON.parse(attributes || '{}') as CharacterAttributesPayload;
    return {
      avatar: typeof parsed?.avatar === 'string' ? parsed.avatar : undefined,
      design: parseCharacterDesign(parsed?.design),
      media: parseMediaItems(parsed?.media),
      voice: parseCharacterVoice(parsed?.voice),
      aliases: normalizeCharacterAliases(parsed?.aliases),
      category: normalizeCharacterCategory(parsed?.category, role),
      highlightColor: normalizeCharacterHighlightColor(parsed?.highlightColor),
      highlightFirstMentionOnly:
        typeof parsed?.highlightFirstMentionOnly === 'boolean'
          ? parsed.highlightFirstMentionOnly
          : DEFAULT_CHARACTER_HIGHLIGHT_FIRST_MENTION_ONLY,
      currentState: normalizeCharacterCurrentStateItems(parsed?.currentState),
    };
  } catch {
    return {
      design: parseCharacterDesign(null),
      media: [],
      aliases: [],
      category: inferCharacterCategoryFromRole(role),
      highlightColor: DEFAULT_CHARACTER_HIGHLIGHT_COLOR,
      highlightFirstMentionOnly: DEFAULT_CHARACTER_HIGHLIGHT_FIRST_MENTION_ONLY,
      currentState: [],
    };
  }
}

export function stringifyCharacterAttributes(
  attributes: CharacterAttributesPayload,
  role: string = ''
): string {
  const design = parseCharacterDesign(attributes.design);
  const media = parseMediaItems(attributes.media);
  const voice = parseCharacterVoice(attributes.voice);
  return JSON.stringify({
    ...(attributes.avatar ? { avatar: attributes.avatar } : {}),
    ...(isDesignEmpty(design) ? {} : { design }),
    ...(media.length ? { media } : {}),
    ...(voice ? { voice } : {}),
    aliases: normalizeCharacterAliases(attributes.aliases),
    category: normalizeCharacterCategory(attributes.category, role),
    highlightColor: normalizeCharacterHighlightColor(attributes.highlightColor),
    highlightFirstMentionOnly:
      typeof attributes.highlightFirstMentionOnly === 'boolean'
        ? attributes.highlightFirstMentionOnly
        : DEFAULT_CHARACTER_HIGHLIGHT_FIRST_MENTION_ONLY,
    currentState: normalizeCharacterCurrentStateItems(attributes.currentState),
  });
}

export function mapCharacterRows(
  rows: Array<{
    id: number;
    name: string;
    role: string;
    description: string;
    attributes: string;
  }>
): Character[] {
  return rows.map((row) => {
    const attrs = parseCharacterAttributes(row.attributes, row.role || '');
    return {
      id: row.id,
      name: row.name,
      role: row.role || '',
      category: attrs.category,
      description: row.description || '',
      currentState: attrs.currentState,
      avatar: attrs.avatar || undefined,
      design: attrs.design,
      media: attrs.media,
      ...(attrs.voice ? { voice: attrs.voice } : {}),
      aliases: attrs.aliases,
      highlightColor: attrs.highlightColor,
      highlightFirstMentionOnly: attrs.highlightFirstMentionOnly,
    };
  });
}
