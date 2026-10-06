import type { ContextMenuEvent } from '../FileTree';
import type { FileNode, WorkspaceProjectLayout } from '../../types';
import type { Character, LoreEntry } from '../RightPanel/types';
import type { StoryOrderMap } from '../../utils/workspace';
import type { AssistantArtifactGenerationStatus } from '../../utils/assistantGeneration';
import type { GrowthIndex } from '../../utils/growthIndex';
import type { WorkScopeOption } from '../../utils/workScope';

export type ObjectContextMenuTarget =
  | { kind: 'project-root' }
  | { kind: 'story-root' }
  | { kind: 'volume-item'; volumePath: string; isSynthetic: boolean; isWork?: boolean }
  | { kind: 'characters-root' }
  | { kind: 'lore-root' }
  | { kind: 'materials-root' }
  | { kind: 'character-item'; characterId: number }
  | { kind: 'lore-item'; entryId: number }
  | { kind: 'growth-root' }
  | { kind: 'growth-item'; characterName: string };

export interface ObjectContextMenuEvent {
  x: number;
  y: number;
  target: ObjectContextMenuTarget;
}

/** 正文节点拖拽落点模式 */
export type StoryDropMode = 'before' | 'after' | 'inside';

export interface StoryDragState {
  sourcePath: string;
  parentPath: string;
}

export interface StoryDropTarget {
  path: string;
  mode: StoryDropMode;
}

/** 可折叠的对象分区 */
export type FilePanelSection = 'story' | 'characters' | 'lore' | 'growth' | 'materials';

export type CollapsedSections = Record<FilePanelSection, boolean>;

export interface FilePanelProps {
  files: FileNode[];
  characters: Character[];
  characterGenerationStatus?: AssistantArtifactGenerationStatus | null;
  loreEntries: LoreEntry[];
  materialUsageMap?: Record<string, string>;
  projectName?: string | null;
  selectedFile: string | null;
  activeWorkspaceTab?: string | null;
  folderPath: string | null;
  /** `ne init` 项目结构；普通文件夹为 null（正文按名称推断卷 / 章） */
  projectLayout?: WorkspaceProjectLayout | null;
  /**
   * 当前作品（角色 / 设定 / 成长档案 / 资料跟随作品）与可切换的作品；
   * 未提供时按项目结构取第一部作品（普通文件夹为文件夹本身）
   */
  workScope?: WorkScopeOption | null;
  workScopeOptions?: WorkScopeOption[];
  onSelectWork?: (workPath: string) => void;
  onCreateWork?: () => void;
  storyOrderMap?: StoryOrderMap;
  showFileSizes?: boolean;
  quickOpenShortcut?: string;
  revealFileRequest?: { path: string; id: string } | null;
  isLoading: boolean;
  onFileSelect: (filePath: string) => void;
  onOpenCharacterNode: (characterId: number) => void;
  onOpenLoreNode: (entryId: number) => void;
  onDeleteCharacterNode: (characterId: number) => void;
  onDeleteLoreNode: (entryId: number) => void;
  /** 行内重命名（双击名称 / F2）：传入新名称；右键菜单「重命名」仍走对话框 */
  onRenameCharacterNode: (characterId: number, nextName: string) => void;
  onRenameLoreNode: (entryId: number, nextName: string) => void;
  onRenameNode: (path: string, nextName: string) => void;
  onReorderStoryNode?: (sourcePath: string, targetPath: string, mode: StoryDropMode) => void;
  onCreateVolume: () => void;
  onCreateChapter: () => void;
  onCreateDraftFolder: () => void;
  onCreateDraft: () => void;
  onCreateCharacter: () => void;
  onCreateLoreEntry: () => void;
  onCreateMaterialDirectory: () => void;
  /** 成长档案索引（资料/记忆/）；null 表示尚未读取或读取失败 */
  growthIndex?: GrowthIndex | null;
  /** 打开成长档案标签（传角色名打开该角色，否则打开总览）；未提供时不显示「成长档案」分区 */
  onOpenGrowth?: (characterName?: string | null) => void;
  onCreateGrowthSheet?: () => void;
  onRefresh: () => void;
  onOpenFolder: () => void;
  /** 双击项目名行内重命名后提交新名称 */
  onRenameProject?: (nextName: string) => void;
  onImportFile?: () => void;
  onCollapse?: () => void;
  onContextMenu?: (event: ContextMenuEvent) => void;
  onObjectContextMenu?: (event: ObjectContextMenuEvent) => void;
  onBackgroundContextMenu?: (pos: { x: number; y: number }) => void;
  onCopyFile?: (path: string) => void;
  onPasteFiles?: (targetDir: string) => void;
  /** 外部文件拖放到面板时触发（VS Code 风格拖放导入） */
  onDropFiles?: (filePaths: string[]) => void;
  hasClipboard?: boolean;
  creatingType?: 'file' | 'directory' | null;
  createTargetPath?: string | null;
  onInlineCreate?: (type: 'file' | 'directory', name: string) => void;
  onCancelCreate?: () => void;
}
