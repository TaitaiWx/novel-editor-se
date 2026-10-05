import type { ContextMenuEvent } from '../FileTree';
import type { FileNode } from '../../types';
import type { Character, LoreEntry } from '../RightPanel/types';
import type { StoryOrderMap } from '../../utils/workspace';
import type { AssistantArtifactGenerationStatus } from '../../utils/assistantGeneration';

export type ObjectContextMenuTarget =
  | { kind: 'project-root' }
  | { kind: 'story-root' }
  | { kind: 'volume-item'; volumePath: string; isSynthetic: boolean }
  | { kind: 'characters-root' }
  | { kind: 'lore-root' }
  | { kind: 'materials-root' }
  | { kind: 'character-item'; characterId: number }
  | { kind: 'lore-item'; entryId: number };

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
export type FilePanelSection = 'story' | 'characters' | 'lore' | 'materials';

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
  onRenameCharacterNode: (characterId: number) => void;
  onRenameLoreNode: (entryId: number) => void;
  onRenameNode: (path: string) => void;
  onReorderStoryNode?: (sourcePath: string, targetPath: string, mode: StoryDropMode) => void;
  onCreateVolume: () => void;
  onCreateChapter: () => void;
  onCreateDraftFolder: () => void;
  onCreateDraft: () => void;
  onCreateCharacter: () => void;
  onCreateLoreEntry: () => void;
  onCreateMaterialDirectory: () => void;
  onRefresh: () => void;
  onOpenFolder: () => void;
  onRenameProject?: () => void;
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
