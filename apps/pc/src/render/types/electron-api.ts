/**
 * Electron API 类型定义
 */

import type { FileInfo, FileInfoBatchEntry, OpenLocalResult, ShortcutInfo } from './File';
import type { GrowthInvokeOverloads } from './growth-api';
import type { AIInvokeOverloads } from './ai-api';
import type { GuiSessionSnapshot } from '@novel-editor/core/gui-session';
import type { AboutInfo } from '../../shared/about';
import type { LogUploadResult } from '../../shared/log-upload';
import type { MenuShortcutBindings } from '../../shared/app-menu';
import type { WorkspaceContentSearchResponse } from '../../shared/workspace-search';
import type { ProjectStructureResult } from '../../shared/project-structure';
import type { StructureConfig } from '@novel-editor/core/structure-rules';

export type { AboutInfo } from '../../shared/about';
export type { LogUploadResult } from '../../shared/log-upload';
export type { AppMenuEvent, MenuShortcutBindings } from '../../shared/app-menu';

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

export interface WebAuthnSupportInfo {
  platform: NodeJS.Platform;
  standardApiAvailable: boolean;
  roamingAuthenticatorSupported: boolean;
  touchIdConfigured: boolean;
  touchIdAvailable: boolean;
  keychainAccessGroup: string | null;
  configurationError: string | null;
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
  /** 开发者调试模式（环境变量 NOVEL_EDITOR_DEBUG=1）：才显示原始提示词 / JSON 等内部数据 */
  debug?: boolean;
  // 成长记录器通道的类型见 ./growth-api.ts
  ipcRenderer: GrowthInvokeOverloads &
    AIInvokeOverloads & {
      invoke(channel: 'open-local-folder'): Promise<OpenLocalResult | null>;
      invoke(channel: 'read-file', filePath: string): Promise<string>;
      invoke(channel: 'read-file', filePath: string, encoding: string): Promise<string>;
      invoke(
        channel: 'write-file',
        filePath: string,
        content: string
      ): Promise<{ success: boolean }>;
      /** 上报 GUI 会话（null 表示已关闭文件夹），主进程写入 <folder>/.novel-editor/session.json */
      invoke(
        channel: 'gui-session-publish',
        snapshot: GuiSessionSnapshot | null
      ): Promise<{ success: boolean }>;
      invoke(channel: 'get-file-info', filePath: string): Promise<FileInfo>;
      /** 在访达 / 资源管理器 / 文件管理器中显示（仅已存在的绝对路径） */
      invoke(channel: 'show-item-in-folder', targetPath: string): Promise<{ success: boolean }>;
      /** 用系统浏览器打开外部链接（仅 http(s) / mailto） */
      invoke(channel: 'open-external-url', url: string): Promise<{ success: boolean }>;
      invoke(channel: 'get-file-info-batch', filePaths: string[]): Promise<FileInfoBatchEntry[]>;
      /** 批量判断文件是否存在：true / false；不在工作区内的路径为 null（未检查） */
      invoke(channel: 'get-files-exist', filePaths: string[]): Promise<Array<boolean | null>>;
      invoke(channel: 'get-default-data-path'): Promise<string>;
      invoke(channel: 'get-recent-folders'): Promise<string[]>;
      invoke(channel: 'get-last-folder'): Promise<string | null>;
      invoke(channel: 'sample-data-take-upgrade-notice'): Promise<{ backupPath: string } | null>;
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
      /** 把设置中心自定义的快捷键同步到应用菜单（主进程校验后重建菜单） */
      invoke(
        channel: 'menu-sync-shortcuts',
        bindings: MenuShortcutBindings
      ): Promise<MenuShortcutBindings>;
      invoke(channel: 'get-app-version'): Promise<string>;
      invoke(channel: 'get-device-id'): Promise<string>;
      /** 关于小说编辑器：版本、通道、灰度分组、设备 ID、首次运行与本次启动时间 */
      invoke(channel: 'get-about-info'): Promise<AboutInfo>;
      invoke(channel: 'about-copy-text', text: string): Promise<{ success: boolean }>;
      /** 打包日志并上传；未配置上传地址或失败时保存到「下载」目录 */
      invoke(channel: 'log-upload-run'): Promise<LogUploadResult>;
      invoke(channel: 'get-webauthn-support'): Promise<WebAuthnSupportInfo>;
      invoke(channel: 'update-check'): Promise<void>;
      invoke(channel: 'update-status'): Promise<UpdateStatus>;
      invoke(channel: 'update-install'): Promise<void>;
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
      invoke(
        channel: 'db-story-idea-output-select',
        outputId: number
      ): Promise<{ changes: number }>;
      invoke(
        channel: 'db-story-idea-output-delete',
        outputId: number
      ): Promise<{ changes: number }>;
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
        fields: {
          category?: string;
          title?: string;
          content?: string;
          tags?: string;
          attributes?: string;
        }
      ): Promise<unknown>;
      invoke(channel: 'db-world-setting-delete', id: number): Promise<unknown>;
      /** 正文结构规则（设置 → 正文结构）：folderPath 必须是当前窗口打开的项目 */
      invoke(channel: 'project-structure-get', folderPath: string): Promise<ProjectStructureResult>;
      /** 保存正文结构规则；成功后主进程广播 project-structure-changed */
      invoke(
        channel: 'project-structure-set',
        folderPath: string,
        config: StructureConfig
      ): Promise<ProjectStructureResult>;
      /** 文件面板全文搜索：在 rootPath（工作区内的目录）下的 .md / .txt 中按字面量查找 */
      invoke(
        channel: 'workspace-search-content',
        rootPath: string,
        query: string
      ): Promise<WorkspaceContentSearchResponse>;
      /** 单个图片 / 视频导出：弹出另存为对话框；data 为渲染进程转换好的 PNG / JPEG / WebP */
      invoke(
        channel: 'media-export',
        request: { sourcePath: string; defaultName?: string; format?: string; data?: Uint8Array }
      ): Promise<{ saved: boolean; filePath?: string; error?: string }>;
      /** 播放器截图 / 录制结果另存为：PNG / JPEG / WebP / WebM / MP4，按文件头校验 */
      invoke(
        channel: 'media-save-generated',
        request: {
          defaultName?: string;
          format: 'png' | 'jpeg' | 'webp' | 'webm' | 'mp4';
          data: Uint8Array;
        }
      ): Promise<{ saved: boolean; filePath?: string; error?: string }>;
      /** 人物头像：保存到 <作品>/资料/人物头像/，返回相对作品目录的路径 */
      invoke(
        channel: 'character-avatar-save',
        workPath: string,
        characterName: string,
        data: Uint8Array
      ): Promise<
        | { ok: true; data: { relativePath: string; absolutePath: string } }
        | { ok: false; error: string }
      >;
      /** 人物 / 设定图集：保存到 <作品>/资料/图集/人物|设定/<名称>/，返回相对作品目录的路径 */
      invoke(
        channel: 'entity-image-save',
        workPath: string,
        payload: {
          entity: 'character' | 'lore';
          name: string;
          data: Uint8Array;
          prompt?: string;
          providerId?: string;
          model?: string;
        }
      ): Promise<{ ok: true; data: { relativePath: string } } | { ok: false; error: string }>;
      invoke(
        channel: 'entity-image-delete',
        workPath: string,
        relativePath: string
      ): Promise<{ ok: true; data: null } | { ok: false; error: string }>;
      /** AI 出图：返回 1–4 张候选图（data URL，不落盘） */
      invoke(
        channel: 'ai-image-generate',
        payload: {
          workPath?: string;
          providerId?: string;
          prompt: string;
          aspectRatio?: string;
          count?: number;
          references?: string[];
        }
      ): Promise<
        | {
            ok: true;
            data: {
              images: Array<{ dataUrl: string; mimeType: string }>;
              providerId: string;
              model: string;
            };
          }
        | { ok: false; error: { kind: string; message: string } }
      >;
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
      invoke(
        channel: 'db-export-knowledge-text',
        folderPath: string,
        options?: { includeCharacters?: boolean; includeLore?: boolean; includeMaterials?: boolean }
      ): Promise<string | null>;
      invoke(channel: string, ...args: unknown[]): Promise<unknown>;
      /** 主进程推送事件；应用菜单事件通道见 shared/app-menu.ts 的 APP_MENU_EVENTS（AppMenuEvent） */
      on<TArgs extends unknown[]>(
        channel: string,
        listener: (...args: TArgs) => void
      ): (() => void) | void;
      removeListener<TArgs extends unknown[]>(
        channel: string,
        listener: (...args: TArgs) => void
      ): void;
      removeAllListeners(channel: string): void;
    };
}
