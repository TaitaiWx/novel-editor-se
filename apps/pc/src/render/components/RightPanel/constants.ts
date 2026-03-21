import type {
  TabType,
  LoreCategory,
  RelationTone,
  CharacterCamp,
  PlotSceneBoard,
  StorylineLayoutMode,
} from './types';

export const OUTLINE_AI_DEBOUNCE_MS = 320;
export const OUTLINE_AI_BATCH_SIZE = 5;
export const OUTLINE_AI_MAX_CONCURRENCY = 3;
export const OUTLINE_AI_PREFETCH_SIZE = 12;
export const OUTLINE_SUMMARY_DEBOUNCE_MS = 400;
export const OUTLINE_SUMMARY_MAX_CONCURRENCY = 2;
export const OUTLINE_POPOVER_WIDTH = 300;
export const OUTLINE_POPOVER_ESTIMATED_HEIGHT = 280;
export const OUTLINE_POPOVER_HIDE_DELAY = 280;

export const TAB_LABELS: Record<TabType, string> = {
  storyline: '故事线',
  characters: '人物',
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

export const PLOT_STATUS_LABELS: Record<PlotSceneBoard['status'], string> = {
  draft: '草稿',
  ready: '成型',
  done: '完成',
};

export const CAMP_LABELS: Record<CharacterCamp, string> = {
  protagonist: '主角团',
  antagonist: '对立阵营',
  support: '关键支撑角色',
};

export const STRUCTURE_NODE_PRESETS = [
  '引子',
  '诱发事件',
  '第一次转折',
  '中点',
  '至暗时刻',
  '高潮',
  '结局',
];

export const TAB_KEYS = Object.keys(TAB_LABELS) as TabType[];

export const ROLE_COLORS: Record<string, string> = {
  主角: '#4ec9b0',
  配角: '#9cdcfe',
  反派: '#f14c4c',
  导师: '#dcdcaa',
  盟友: '#c586c0',
};

export const ACT_COLORS = ['#007acc', '#4ec9b0', '#c586c0', '#dcdcaa', '#9cdcfe', '#f14c4c'];

export const LAYOUT_MODE_LABELS: Record<StorylineLayoutMode, string> = {
  board: '故事板',
  timeline: '泳道线',
  causal: '因果链',
};

export const LAYOUT_MODE_KEYS = Object.keys(LAYOUT_MODE_LABELS) as StorylineLayoutMode[];

/** Intensity heat-map gradient stops (1–5) */
export const INTENSITY_COLORS = [
  'rgba(86, 156, 214, 0.25)', // 1 - calm
  'rgba(78, 201, 176, 0.35)', // 2 - building
  'rgba(220, 220, 170, 0.4)', // 3 - tension
  'rgba(241, 148, 76, 0.5)', // 4 - high
  'rgba(241, 76, 76, 0.55)', // 5 - climax
];

export const INTENSITY_LABELS = ['平静', '铺垫', '紧张', '激烈', '高潮'];
