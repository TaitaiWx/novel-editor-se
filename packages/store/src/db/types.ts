/** 存储层共享类型与枚举常量 */

/** 大纲树节点（用于整树替换与版本快照） */
export type OutlineTreeNode = {
  title: string;
  content?: string;
  anchorText?: string;
  lineHint?: number | null;
  sortOrder?: number;
  children?: OutlineTreeNode[];
};

export type OutlineVersionSource = 'import' | 'rebuild' | 'ai' | 'manual';
export type OutlineScopeKind = 'project' | 'volume' | 'chapter';

export interface OutlineScope {
  kind: OutlineScopeKind;
  path: string;
}

export type StoryIdeaCardSource = 'manual' | 'ai';
export type StoryIdeaCardStatus =
  | 'draft'
  | 'exploring'
  | 'shortlisted'
  | 'promoted_to_board'
  | 'promoted_to_outline'
  | 'archived';

export type StoryIdeaOutputType = 'logline' | 'scene_hook' | 'outline_direction';

export interface OutlineVersionRow {
  id: number;
  novel_id: number;
  scope_kind: OutlineScopeKind;
  scope_path: string;
  name: string;
  source: OutlineVersionSource;
  note: string;
  story_idea_card_id: number | null;
  story_idea_snapshot_json: string;
  tree_json: string;
  total_nodes: number;
  created_at: string;
}

export interface StoryIdeaCardRow {
  id: number;
  novel_id: number;
  title: string;
  premise: string;
  tags_json: string;
  source: StoryIdeaCardSource;
  status: StoryIdeaCardStatus;
  theme_seed: string;
  conflict_seed: string;
  twist_seed: string;
  protagonist_wish: string;
  core_obstacle: string;
  irony_or_gap: string;
  escalation_path: string;
  payoff_hint: string;
  selected_logline: string;
  selected_direction: string;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface StoryIdeaOutputRow {
  id: number;
  idea_card_id: number;
  novel_id: number;
  type: StoryIdeaOutputType;
  content: string;
  meta_json: string;
  sort_order: number;
  is_selected: number;
  created_at: string;
  updated_at: string;
}

export const OUTLINE_VERSION_SOURCES = ['import', 'rebuild', 'ai', 'manual'] as const;
export const STORY_IDEA_CARD_SOURCES = ['manual', 'ai'] as const;
export const STORY_IDEA_CARD_STATUSES = [
  'draft',
  'exploring',
  'shortlisted',
  'promoted_to_board',
  'promoted_to_outline',
  'archived',
] as const;
export const STORY_IDEA_OUTPUT_TYPES = ['logline', 'scene_hook', 'outline_direction'] as const;
