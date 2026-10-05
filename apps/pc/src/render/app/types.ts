/**
 * 应用根组件共享的类型与常量
 */
import type { AssistantScopeKind } from '@/render/utils/workspace';
import type { EditorViewportSnapshot } from '@/render/components/TextEditor';
import type { FileNode } from '@/render/types';
import type { LoreEntry } from '@/render/components/RightPanel/types';
import type { ObjectContextMenuTarget } from '@/render/components/FilePanel';

export type CreatingType = 'file' | 'directory' | null;
export type StoryCreateKind = 'volume' | 'chapter' | 'draft-folder' | 'draft';
export type AIGenerationScope = 'current-content' | 'current-chapter' | 'whole-project';

export interface AssistantScopeTarget {
  kind: AssistantScopeKind;
  path: string;
  label: string;
}

export interface AssistantScopedCharacter {
  name: string;
  role: string;
  description: string;
}

export interface GeneratedLoreDraft {
  category: LoreEntry['category'];
  title: string;
  summary: string;
  tags: string[];
}

export interface AssistantScopedLore {
  category: LoreEntry['category'];
  title: string;
  summary: string;
}

export interface GeneratedMaterialDraft {
  title: string;
  summary: string;
  kind: 'reference' | 'scene' | 'character' | 'setting' | 'research';
  relatedChapter?: string;
  keywords: string[];
}

export interface AssistantScopedMaterial {
  title: string;
  summary: string;
  kind: GeneratedMaterialDraft['kind'];
  relatedChapter?: string;
}

export interface KnowledgeExportOptions {
  includeCharacters: boolean;
  includeLore: boolean;
  includeMaterials: boolean;
}

export interface CursorPosition {
  line: number;
  column: number;
}

export type ContextMenuTargetState =
  | { kind: 'background' }
  | { kind: 'file'; node: FileNode }
  | { kind: 'object'; target: ObjectContextMenuTarget };

export interface ContextMenuState {
  x: number;
  y: number;
  target: ContextMenuTargetState;
}

export interface PersistedEditorSession {
  openTabs: string[];
  activeTab: string | null;
  viewportSnapshots: Record<string, EditorViewportSnapshot>;
}

export const CHAPTER_MATERIALS_STORAGE_PREFIX = 'novel-editor:chapter-materials:';
