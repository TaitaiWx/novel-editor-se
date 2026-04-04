/**
 * Electron API 类型定义
 */

import type { FileInfo, FileInfoBatchEntry, OpenLocalResult, ShortcutInfo } from './File';

export type UpdateChannel = 'stable' | 'beta' | 'canary';

export interface UpdateStatus {
  channel: UpdateChannel;
  channelFile: string;
  currentVersion: string;
  checking: boolean;
  updateReady: boolean;
  availableVersion: string | null;
  downloadedVersion: string | null;
  downloadPercent: number | null;
  rollbackAvailable: boolean;
  rollbackVersion: string | null;
  /** 下载完成后正在预缓存当前版本安装包（用于回滚） */
  preCaching: boolean;
  lastError: string | null;
}

export interface PersistedOutlineRow {
  id: number;
  novel_id: number;
  scope_kind: PersistedOutlineScopeKind;
  scope_path: string;
  title: string;
  content: string;
  anchor_text: string;
  line_hint: number | null;
  parent_id: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface PersistedOutlineNodeInput {
  title: string;
  content?: string;
  anchorText?: string;
  lineHint?: number | null;
  sortOrder?: number;
  children?: PersistedOutlineNodeInput[];
}

export type OutlineVersionSource = 'import' | 'rebuild' | 'ai' | 'manual';
export type PersistedOutlineScopeKind = 'project' | 'volume' | 'chapter';
export interface PersistedOutlineScopeInput {
  kind: PersistedOutlineScopeKind;
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

export interface PersistedOutlineVersionRow {
  id: number;
  novel_id: number;
  scope_kind: PersistedOutlineScopeKind;
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

export interface ElectronAPI {
  getLastDroppedPaths(): string[];
  ipcRenderer: {
    invoke(channel: 'open-local-folder'): Promise<OpenLocalResult | null>;
    invoke(channel: 'read-file', filePath: string): Promise<string>;
    invoke(channel: 'read-file', filePath: string, encoding: string): Promise<string>;
    invoke(channel: 'write-file', filePath: string, content: string): Promise<{ success: boolean }>;
    invoke(channel: 'get-file-info', filePath: string): Promise<FileInfo>;
    invoke(channel: 'get-file-info-batch', filePaths: string[]): Promise<FileInfoBatchEntry[]>;
    invoke(channel: 'get-default-data-path'): Promise<string>;
    invoke(channel: 'get-recent-folders'): Promise<string[]>;
    invoke(channel: 'get-last-folder'): Promise<string | null>;
    invoke(channel: 'add-recent-folder', folderPath: string): Promise<void>;
    invoke(channel: 'open-sample-data'): Promise<string>;
    invoke(channel: 'get-changelog'): Promise<string>;
    invoke(
      channel: 'check-just-updated'
    ): Promise<{ updated: boolean; fromVersion: string | null; toVersion: string }>;
    invoke(
      channel: 'create-file',
      folderPath: string,
      fileName: string
    ): Promise<{ success: boolean; filePath: string }>;
    invoke(
      channel: 'create-directory',
      folderPath: string,
      dirName: string
    ): Promise<{ success: boolean; dirPath: string }>;
    invoke(channel: 'refresh-folder', folderPath: string): Promise<OpenLocalResult>;
    invoke(channel: 'window-minimize'): Promise<void>;
    invoke(channel: 'window-maximize'): Promise<void>;
    invoke(channel: 'window-close'): Promise<void>;
    invoke(channel: 'window-is-maximized'): Promise<boolean>;
    invoke(channel: 'app-renderer-ready'): Promise<{ success: boolean }>;
    invoke(channel: 'app-renderer-health-ready'): Promise<{ success: boolean }>;
    invoke(channel: 'app-quit'): Promise<void>;
    invoke(channel: 'dev-tools-toggle'): Promise<void>;
    invoke(channel: 'window-toggle-fullscreen'): Promise<void>;
    invoke(channel: 'get-shortcuts'): Promise<ShortcutInfo[]>;
    invoke(channel: 'get-app-version'): Promise<string>;
    invoke(channel: 'update-check'): Promise<void>;
    invoke(channel: 'update-status'): Promise<UpdateStatus>;
    invoke(channel: 'update-install'): Promise<void>;
    invoke(channel: 'update-set-channel', updateChannel: UpdateChannel): Promise<UpdateStatus>;
    invoke(channel: 'update-rollback'): Promise<{ version: string; installerPath: string }>;
    invoke(
      channel: 'db-outline-list-by-folder',
      folderPath: string,
      scope?: PersistedOutlineScopeInput
    ): Promise<PersistedOutlineRow[]>;
    invoke(
      channel: 'db-outline-replace-by-folder',
      folderPath: string,
      entries: PersistedOutlineNodeInput[],
      scope?: PersistedOutlineScopeInput
    ): Promise<{ changes: number }>;
    invoke(
      channel: 'db-outline-clear-by-folder',
      folderPath: string,
      scope?: PersistedOutlineScopeInput
    ): Promise<{ changes: number }>;
    invoke(
      channel: 'db-outline-reorder-by-folder',
      folderPath: string,
      ids: number[]
    ): Promise<{ changes: number }>;
    invoke(
      channel: 'db-outline-version-list-by-folder',
      folderPath: string,
      scope?: PersistedOutlineScopeInput
    ): Promise<PersistedOutlineVersionRow[]>;
    invoke(
      channel: 'db-outline-version-create-by-folder',
      folderPath: string,
      payload: {
        name: string;
        source: OutlineVersionSource;
        note?: string;
        storyIdeaCardId?: number | null;
        storyIdeaSnapshotJson?: string;
        entries: PersistedOutlineNodeInput[];
      },
      scope?: PersistedOutlineScopeInput
    ): Promise<{ changes: number }>;
    invoke(
      channel: 'db-outline-version-apply-by-folder',
      folderPath: string,
      versionId: number,
      scope?: PersistedOutlineScopeInput
    ): Promise<{ changes: number }>;
    invoke(
      channel: 'db-outline-version-update',
      versionId: number,
      fields: {
        name?: string;
        note?: string;
      }
    ): Promise<{ changes: number }>;
    invoke(channel: 'db-outline-version-delete', versionId: number): Promise<{ changes: number }>;
    invoke(
      channel: 'db-story-idea-card-list-by-folder',
      folderPath: string
    ): Promise<StoryIdeaCardRow[]>;
    invoke(
      channel: 'db-story-idea-card-create-by-folder',
      folderPath: string,
      payload: {
        title: string;
        premise?: string;
        tagsJson?: string;
        source?: StoryIdeaCardSource;
        status?: StoryIdeaCardStatus;
        themeSeed?: string;
        conflictSeed?: string;
        twistSeed?: string;
        protagonistWish?: string;
        coreObstacle?: string;
        ironyOrGap?: string;
        escalationPath?: string;
        payoffHint?: string;
        selectedLogline?: string;
        selectedDirection?: string;
        note?: string;
      }
    ): Promise<{ changes: number; lastInsertRowid?: number | bigint }>;
    invoke(
      channel: 'db-story-idea-card-update',
      cardId: number,
      fields: {
        title?: string;
        premise?: string;
        tags_json?: string;
        source?: StoryIdeaCardSource;
        status?: StoryIdeaCardStatus;
        theme_seed?: string;
        conflict_seed?: string;
        twist_seed?: string;
        protagonist_wish?: string;
        core_obstacle?: string;
        irony_or_gap?: string;
        escalation_path?: string;
        payoff_hint?: string;
        selected_logline?: string;
        selected_direction?: string;
        note?: string;
      }
    ): Promise<{ changes: number }>;
    invoke(channel: 'db-story-idea-card-delete', cardId: number): Promise<{ changes: number }>;
    invoke(channel: 'db-story-idea-output-list', cardId: number): Promise<StoryIdeaOutputRow[]>;
    invoke(
      channel: 'db-story-idea-output-replace-by-folder',
      folderPath: string,
      cardId: number,
      type: StoryIdeaOutputType,
      outputs: Array<{ content: string; metaJson?: string; isSelected?: boolean }>
    ): Promise<{ changes: number }>;
    invoke(
      channel: 'db-story-idea-output-update',
      outputId: number,
      fields: { content?: string; meta_json?: string; sort_order?: number; is_selected?: number }
    ): Promise<{ changes: number }>;
    invoke(channel: 'db-story-idea-output-select', outputId: number): Promise<{ changes: number }>;
    invoke(channel: 'db-story-idea-output-delete', outputId: number): Promise<{ changes: number }>;
    invoke(
      channel: 'db-world-setting-list-by-folder',
      folderPath: string
    ): Promise<
      Array<{
        id: number;
        category: string;
        title: string;
        content: string;
        tags: string;
        created_at: string;
        updated_at: string;
      }>
    >;
    invoke(
      channel: 'db-world-setting-create-by-folder',
      folderPath: string,
      category: string,
      title: string,
      content?: string,
      tags?: string
    ): Promise<unknown>;
    invoke(
      channel: 'db-world-setting-bulk-create-by-folder',
      folderPath: string,
      entries: Array<{ category: string; title: string; content?: string; tags?: string }>
    ): Promise<{ changes: number }>;
    invoke(
      channel: 'db-world-setting-update',
      id: number,
      fields: { category?: string; title?: string; content?: string; tags?: string }
    ): Promise<unknown>;
    invoke(channel: 'db-world-setting-delete', id: number): Promise<unknown>;
    invoke(channel: 'import-structured-file'): Promise<{
      previews: Array<{ fileName: string; content: string; sourcePath: string }>;
      errors: Array<{ filePath: string; error: string }>;
    } | null>;
    invoke(
      channel: 'paste-files',
      sourcePaths: string[],
      targetDir: string
    ): Promise<{ success: boolean; results: { source: string; dest: string }[] }>;
    invoke(channel: 'read-clipboard-file-paths'): Promise<string[]>;
    invoke(
      channel: 'export-to-word',
      content: string,
      options?: { title?: string; author?: string }
    ): Promise<{ success: boolean; filePath?: string; error?: string }>;
    invoke(
      channel: 'export-project-to-word',
      folderPath: string,
      options?: { title?: string; author?: string }
    ): Promise<{ success: boolean; filePath?: string; error?: string }>;
    invoke(
      channel: 'export-to-pptx',
      content: string,
      options?: { title?: string; author?: string }
    ): Promise<{ success: boolean; filePath?: string; error?: string }>;
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, listener: (...args: any[]) => void): (() => void) | void;
    removeListener(channel: string, listener: (...args: any[]) => void): void;
    removeAllListeners(channel: string): void;
  };
}
