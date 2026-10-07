import type { TabType, LoreCategory, RelationTone, CharacterCamp } from './types';

export const OUTLINE_AI_DEBOUNCE_MS = 320;
export const OUTLINE_AI_BATCH_SIZE = 5;
export const OUTLINE_AI_MAX_CONCURRENCY = 3;
export const OUTLINE_AI_PREFETCH_SIZE = 12;
export const OUTLINE_SUMMARY_DEBOUNCE_MS = 400;
export const OUTLINE_SUMMARY_MAX_CONCURRENCY = 2;
export const OUTLINE_POPOVER_HIDE_DELAY = 280;

export const TAB_LABELS: Record<TabType, string> = {
  storyline: '故事线',
  characters: '角色',
  lore: '设定',
};

export const LORE_CATEGORY_LABELS: Record<LoreCategory, string> = {
  world: '世界观',
  faction: '势力',
  system: '体系',
  term: '术语',
};

export const SETTINGS_STORAGE_KEY = 'novel-editor:settings-center';

export const RELATION_TONE_LABELS: Record<RelationTone, string> = {
  ally: '盟友',
  rival: '对立',
  family: '亲缘',
  mentor: '师承',
  other: '其他',
};

export const CAMP_LABELS: Record<CharacterCamp, string> = {
  protagonist: '主角团',
  antagonist: '对立阵营',
  support: '关键支撑角色',
};

export const TAB_KEYS = Object.keys(TAB_LABELS) as TabType[];

export const ROLE_COLORS: Record<string, string> = {
  主角: '#4ec9b0',
  配角: '#d7ba7d',
  反派: '#f14c4c',
  导师: '#dcdcaa',
  盟友: '#c586c0',
};
