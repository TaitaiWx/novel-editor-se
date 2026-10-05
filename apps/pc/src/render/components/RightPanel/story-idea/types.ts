import type { StoryIdeaCardSource, StoryIdeaCardStatus } from '@/render/types/electron-api';

export interface StoryIdeaCardDraft {
  title: string;
  premise: string;
  tags: string[];
  source: StoryIdeaCardSource;
  status: StoryIdeaCardStatus;
  themeTerms: string[];
  conflictTerms: string[];
  twistTerms: string[];
  selectedLogline: string;
  selectedDirection: string;
  note: string;
}

export type StoryIdeaTermSection = 'theme' | 'conflict' | 'twist';

export type StoryIdeaTermPoolSource = 'history' | 'ai' | 'manual';

export interface StoryIdeaTermPoolEntry {
  term: string;
  sources: StoryIdeaTermPoolSource[];
}

export interface StoryIdeaTermPoolState {
  theme: StoryIdeaTermPoolEntry[];
  conflict: StoryIdeaTermPoolEntry[];
  twist: StoryIdeaTermPoolEntry[];
}

export interface StoryIdeaSnapshot {
  title: string;
  premise: string;
  tags: string[];
  themeTerms: string[];
  conflictTerms: string[];
  twistTerms: string[];
  selectedLogline: string;
  selectedDirection: string;
  createdFromOutputId?: number;
}

export type StoryIdeaGenerationScope = 'free' | 'hybrid' | 'anchored';

export interface StoryIdeaGenerationConfig {
  scope: StoryIdeaGenerationScope;
  guidance: string;
}

export const STORY_IDEA_STATUS_LABELS: Record<StoryIdeaCardStatus, string> = {
  draft: '草稿',
  exploring: '探索中',
  shortlisted: '已入围',
  promoted_to_board: '已送情节板',
  promoted_to_outline: '已转大纲',
  archived: '已归档',
};

export const STORY_IDEA_SOURCE_LABELS: Record<StoryIdeaCardSource, string> = {
  manual: '手填',
  ai: 'AI',
};

export const STORY_IDEA_OUTPUT_LABELS = {
  logline: '一句话卖点',
  scene_hook: '场景钩子',
  outline_direction: '大纲方向',
} as const;

export const STORY_IDEA_TERM_SECTION_LABELS = {
  theme: '题眼签',
  conflict: '冲突签',
  twist: '变形签',
} as const;

export const STORY_IDEA_TERM_POOL_SOURCE_LABELS: Record<StoryIdeaTermPoolSource, string> = {
  history: '历史',
  ai: 'AI',
  manual: '手动',
};

export const STORY_IDEA_GENERATION_SCOPE_LABELS: Record<StoryIdeaGenerationScope, string> = {
  free: '自由发散',
  hybrid: '贴近正文但允许跳脱',
  anchored: '尽量贴近当前正文',
};
