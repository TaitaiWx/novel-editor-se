import type {
  StoryIdeaCardRow,
  StoryIdeaOutputRow,
  StoryIdeaOutputType,
} from '@/render/types/electron-api';
import type { StoryIdeaCardDraft, StoryIdeaTermSection } from '../story-idea';

// 三签创作法视图内部使用的常量、类型与纯函数

export const OPEN_STORY_IDEA_CARD_EVENT = 'open-story-idea-card';

export const STORY_IDEA_TERM_CARD_DESCRIPTIONS: Record<StoryIdeaTermSection, string> = {
  theme: '题眼签抓意象、关系和气质，它决定这个故事像什么。',
  conflict: '冲突签抓阻力、代价和对撞，它决定故事往哪儿拧。',
  twist: '变形签抓反转、错位和揭示，它决定故事怎么翻面。',
};

export const STORY_IDEA_TERM_ORDER: StoryIdeaTermSection[] = ['theme', 'conflict', 'twist'];

export type StoryIdeaOutputFilterState = {
  type: 'all' | StoryIdeaOutputType;
  selectedOnly: boolean;
};

export type StoryIdeaInteractionMode = 'guided' | 'advanced';

export function createPoolSourceFilterKey(folderPath: string | null): string | null {
  return folderPath ? `novel-editor:story-idea-pool-filter:${folderPath}` : null;
}

export function createOutputFilterKey(folderPath: string | null): string | null {
  return folderPath ? `novel-editor:story-idea-output-filter:${folderPath}` : null;
}

export function readOutputMeta(output: StoryIdeaOutputRow): Record<string, unknown> {
  try {
    return JSON.parse(output.meta_json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function getTermSummary(draft: StoryIdeaCardDraft): string {
  return [draft.themeTerms, draft.conflictTerms, draft.twistTerms].flat().slice(0, 6).join(' / ');
}

export function buildTransientStoryIdeaCard(
  cardId: number,
  draft: StoryIdeaCardDraft
): StoryIdeaCardRow {
  const now = new Date().toISOString();
  return {
    id: cardId,
    novel_id: 0,
    title: draft.title,
    premise: draft.premise,
    tags_json: JSON.stringify(draft.tags),
    source: draft.source,
    status: draft.status,
    theme_seed: draft.themeTerms.join(' / '),
    conflict_seed: draft.conflictTerms.join(' / '),
    twist_seed: draft.twistTerms.join(' / '),
    protagonist_wish: '',
    core_obstacle: '',
    irony_or_gap: '',
    escalation_path: '',
    payoff_hint: '',
    selected_logline: draft.selectedLogline,
    selected_direction: draft.selectedDirection,
    note: draft.note,
    created_at: now,
    updated_at: now,
  };
}

export function createGeneratedCardTitle() {
  const now = new Date();
  return `创意卡 ${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}
