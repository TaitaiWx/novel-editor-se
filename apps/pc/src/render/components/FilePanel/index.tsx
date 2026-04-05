import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  AiOutlineReload,
  AiOutlinePlus,
  AiOutlineFolderOpen,
  AiOutlineSearch,
  AiOutlineUser,
  AiOutlineFolder,
  AiOutlineDelete,
  AiOutlineEdit,
} from 'react-icons/ai';
import LoadingSpinner from '../LoadingSpinner';
import EmptyState from '../EmptyState';
import FileTree from '../FileTree';
import Popover from '../Popover';
import Tooltip from '../Tooltip';
import type { ContextMenuEvent } from '../FileTree';
import { FileNode } from '../../types';
import type { Character, LoreEntry } from '../RightPanel/types';
import { formatShortcutLabel, matchShortcutEvent } from '../../utils/appSettings';
import { isImeComposing } from '../../utils/ime';
import {
  buildStoryDisplayNodes,
  createCharacterWorkspaceTab,
  createLoreWorkspaceTab,
  createVolumeWorkspaceTab,
  isChapterLikeStoryName,
  isDraftLikeStoryName,
  isVolumeLikeStoryName,
  parseVolumeWorkspaceTab,
  splitWorkspaceFiles,
  stripStoryFileExtension,
  type StoryOrderMap,
  WORKSPACE_TAB_CHARACTERS,
  WORKSPACE_TAB_LORE,
} from '../../utils/workspace';
import {
  formatAssistantGenerationMetrics,
  formatAssistantGenerationProgress,
  type AssistantArtifactGenerationStatus,
} from '../../utils/assistantGeneration';
import styles from './styles.module.scss';

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

interface FilePanelProps {
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
  isLoading: boolean;
  onFileSelect: (filePath: string) => void;
  onOpenCharacterNode: (characterId: number) => void;
  onOpenLoreNode: (entryId: number) => void;
  onDeleteCharacterNode: (characterId: number) => void;
  onDeleteLoreNode: (entryId: number) => void;
  onRenameCharacterNode: (characterId: number) => void;
  onRenameLoreNode: (entryId: number) => void;
  onRenameNode: (path: string) => void;
  onReorderStoryNode?: (
    sourcePath: string,
    targetPath: string,
    mode: 'before' | 'after' | 'inside'
  ) => void;
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

/** 根据路径在树中查找节点 */
function findNodeByPath(nodes: FileNode[], targetPath: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    if (node.children) {
      const found = findNodeByPath(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

/** 递归过滤文件树，保留匹配节点及其父目录路径 */
function filterTree(nodes: FileNode[], query: string): FileNode[] {
  const lowerQuery = query.toLowerCase();
  return nodes.reduce<FileNode[]>((acc, node) => {
    if (node.type === 'directory') {
      const filteredChildren = node.children ? filterTree(node.children, query) : [];
      const nameMatches = node.name.toLowerCase().includes(lowerQuery);
      if (nameMatches || filteredChildren.length > 0) {
        acc.push({
          ...node,
          children: filteredChildren.length > 0 ? filteredChildren : node.children,
        });
      }
    } else {
      if (node.name.toLowerCase().includes(lowerQuery)) {
        acc.push(node);
      }
    }
    return acc;
  }, []);
}

function countStoryStats(node: FileNode): { chapters: number; drafts: number } {
  if (node.type === 'file') {
    return isDraftLikeStoryName(node.name) && !isChapterLikeStoryName(node.name)
      ? { chapters: 0, drafts: 1 }
      : { chapters: 1, drafts: 0 };
  }

  return (node.children || []).reduce(
    (summary, child) => {
      const childStats = countStoryStats(child);
      return {
        chapters: summary.chapters + childStats.chapters,
        drafts: summary.drafts + childStats.drafts,
      };
    },
    { chapters: 0, drafts: 0 }
  );
}

function getStoryDirectoryMeta(name: string): { label: string; icon: React.ReactNode } {
  if (isDraftLikeStoryName(name)) {
    return {
      label: '稿夹',
      icon: (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2.5 5.1h3.6l1.2-1.6h2.6l1 1.2H13a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6.1a1 1 0 0 1 .5-1Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d="M8.6 8.8 11.8 5.6m-2.4 4 .8 1.2 1.2-.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.15"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    };
  }
  if (!isVolumeLikeStoryName(name) && name !== '未分卷') {
    return {
      label: '正文夹',
      icon: (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2.7 4.1h3.2l1.1-1.4h2.3l1 1.2H13a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5.1a1 1 0 0 1 .7-1Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d="M5.3 7.2h5.4M5.3 9.7h4.1"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.15"
            strokeLinecap="round"
          />
        </svg>
      ),
    };
  }
  return {
    label: '卷',
    icon: (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M4 2.6h6.7a1.3 1.3 0 0 1 1.3 1.3v8.8H5.2A1.2 1.2 0 0 0 4 13.9V2.6Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d="M6 4.7h3.8M6 7.2h3.8M6 9.7h2.6M4 13.1c.3-.4.7-.6 1.2-.6h6.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
    ),
  };
}

function getStoryFileMeta(name: string): { label: string; icon: React.ReactNode } {
  if (!isChapterLikeStoryName(name) && isDraftLikeStoryName(name)) {
    return {
      label: '稿',
      icon: (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M4 2.5h5.5L13 6v7.5H4z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d="M9.5 2.5V6H13M5.7 11.2l3.6-3.6 1.3 1.3L7 12.5H5.7z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      ),
    };
  }
  return {
    label: '章',
    icon: (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M4 2.5h5.5L13 6v7.5H4z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d="M9.5 2.5V6H13M5.5 8h5M5.5 10.5h4.5M5.5 13h3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
    ),
  };
}

function findAncestorPaths(
  nodes: FileNode[],
  targetPath: string,
  ancestors: string[] = []
): string[] {
  for (const node of nodes) {
    if (node.path === targetPath) {
      return ancestors;
    }
    if (node.type === 'directory' && node.children) {
      const next = findAncestorPaths(node.children, targetPath, [...ancestors, node.path]);
      if (next.length > 0) return next;
    }
  }
  return [];
}

function isExternalFileDrag(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer.types || []).includes('Files');
}

const FilePanel: React.FC<FilePanelProps> = React.memo(
  ({
    files,
    characters,
    characterGenerationStatus = null,
    loreEntries,
    materialUsageMap = {},
    projectName,
    selectedFile,
    activeWorkspaceTab,
    folderPath,
    storyOrderMap = {},
    showFileSizes = true,
    quickOpenShortcut = 'Mod+P',
    isLoading,
    onFileSelect,
    onOpenCharacterNode,
    onOpenLoreNode,
    onDeleteCharacterNode,
    onDeleteLoreNode,
    onRenameCharacterNode,
    onRenameLoreNode,
    onRenameNode,
    onReorderStoryNode,
    onCreateVolume,
    onCreateChapter,
    onCreateDraftFolder,
    onCreateDraft,
    onCreateCharacter,
    onCreateLoreEntry,
    onCreateMaterialDirectory,
    onRefresh,
    onOpenFolder,
    onRenameProject,
    onImportFile,
    onCollapse,
    onContextMenu,
    onObjectContextMenu,
    onBackgroundContextMenu,
    onCopyFile,
    onPasteFiles,
    onDropFiles,
    hasClipboard,
    creatingType,
    createTargetPath,
    onInlineCreate,
    onCancelCreate,
  }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [revealPath, setRevealPath] = useState<string | null>(null);
    const [collapsedSections, setCollapsedSections] = useState({
      story: false,
      characters: false,
      lore: false,
      materials: false,
    });
    const [expandedStoryDirs, setExpandedStoryDirs] = useState<Set<string>>(new Set());
    const [createMenuOpen, setCreateMenuOpen] = useState(false);
    const [storyDragState, setStoryDragState] = useState<{
      sourcePath: string;
      parentPath: string;
    } | null>(null);
    const [storyDropTarget, setStoryDropTarget] = useState<{
      path: string;
      mode: 'before' | 'after' | 'inside';
    } | null>(null);
    const activeVolumePath = useMemo(
      () => parseVolumeWorkspaceTab(activeWorkspaceTab ?? null),
      [activeWorkspaceTab]
    );
    const searchInputRef = useRef<HTMLInputElement>(null);
    const createMenuButtonRef = useRef<HTMLButtonElement>(null);
    const lastCharacterStatusSignatureRef = useRef<string | null>(null);
    const shouldShowLoadingState = isLoading && !folderPath && files.length === 0;
    const isWorkspaceBusy = isLoading && Boolean(folderPath);

    const emitObjectContextMenu = useCallback(
      (event: React.MouseEvent, target: ObjectContextMenuTarget) => {
        event.preventDefault();
        event.stopPropagation();
        onObjectContextMenu?.({
          x: event.clientX,
          y: event.clientY,
          target,
        });
      },
      [onObjectContextMenu]
    );

    // ─── 拖放导入（VS Code 风格: Finder/Explorer → 文件面板） ─────────────
    const [isDragOver, setIsDragOver] = useState(false);
    const dragCounterRef = useRef(0);

    const handleDragOver = useCallback((e: React.DragEvent) => {
      if (!isExternalFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }, []);

    const handleDragEnter = useCallback((e: React.DragEvent) => {
      if (!isExternalFileDrag(e)) return;
      e.preventDefault();
      dragCounterRef.current++;
      if (dragCounterRef.current === 1) setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback(() => {
      dragCounterRef.current--;
      if (dragCounterRef.current === 0) setIsDragOver(false);
    }, []);

    const handleDrop = useCallback(
      (e: React.DragEvent) => {
        if (!isExternalFileDrag(e)) return;
        e.preventDefault();
        dragCounterRef.current = 0;
        setIsDragOver(false);
        const droppedFiles = e.dataTransfer.files;
        if (droppedFiles.length === 0) return;
        // preload 在 capture 阶段已提取 File.path，直接取回
        const filePaths = window.electron?.getLastDroppedPaths() || [];
        if (filePaths.length > 0) onDropFiles?.(filePaths);
      },
      [onDropFiles]
    );

    const folderName = useMemo(
      () =>
        folderPath
          ? folderPath.split('/').pop() || folderPath.split('\\').pop() || folderPath
          : null,
      [folderPath]
    );
    const workspaceLabel = projectName?.trim() || folderName;

    const filteredFiles = useMemo(() => {
      if (!searchQuery.trim()) return files;
      return filterTree(files, searchQuery.trim());
    }, [files, searchQuery]);
    const { storyNodes, materialNodes } = useMemo(
      () => splitWorkspaceFiles(filteredFiles),
      [filteredFiles]
    );
    const storyDisplayNodes = useMemo(
      () => buildStoryDisplayNodes(storyNodes, folderPath, storyOrderMap),
      [folderPath, storyNodes, storyOrderMap]
    );
    const materialFileCount = useMemo(() => {
      const countFiles = (nodes: FileNode[]): number =>
        nodes.reduce((total, node) => {
          if (node.type === 'file') return total + 1;
          return total + countFiles(node.children || []);
        }, 0);
      return countFiles(materialNodes);
    }, [materialNodes]);
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const filteredCharacters = useMemo(
      () =>
        characters.filter((item) =>
          normalizedQuery
            ? `${item.name} ${item.role} ${item.description}`
                .toLowerCase()
                .includes(normalizedQuery)
            : true
        ),
      [characters, normalizedQuery]
    );
    const filteredLoreEntries = useMemo(
      () =>
        loreEntries.filter((item) =>
          normalizedQuery
            ? `${item.title} ${item.summary}`.toLowerCase().includes(normalizedQuery)
            : true
        ),
      [loreEntries, normalizedQuery]
    );
    const showCharactersSection =
      normalizedQuery.length === 0 ||
      filteredCharacters.length > 0 ||
      '人物 角色 关系'.includes(normalizedQuery) ||
      normalizedQuery.includes('人') ||
      normalizedQuery.includes('角');
    const showLoreSection =
      normalizedQuery.length === 0 ||
      filteredLoreEntries.length > 0 ||
      '设定 世界观 规则 资料'.includes(normalizedQuery) ||
      normalizedQuery.includes('设') ||
      normalizedQuery.includes('定');
    const characterGenerationProgress = useMemo(
      () => formatAssistantGenerationProgress(characterGenerationStatus),
      [characterGenerationStatus]
    );
    const characterGenerationMetrics = useMemo(
      () => formatAssistantGenerationMetrics(characterGenerationStatus),
      [characterGenerationStatus]
    );

    useEffect(() => {
      if (!selectedFile) return;
      setExpandedStoryDirs((prev) => {
        const next = new Set(prev);
        findAncestorPaths(storyDisplayNodes, selectedFile).forEach((path) => next.add(path));
        return next;
      });
    }, [selectedFile, storyDisplayNodes]);

    useEffect(() => {
      if (!activeVolumePath) return;
      setExpandedStoryDirs((prev) => {
        const next = new Set(prev);
        findAncestorPaths(storyDisplayNodes, activeVolumePath).forEach((path) => next.add(path));
        next.add(activeVolumePath);
        return next;
      });
    }, [activeVolumePath, storyDisplayNodes]);

    useEffect(() => {
      if (!characterGenerationStatus) return;
      const signature = [
        characterGenerationStatus.scopePath,
        characterGenerationStatus.state,
        characterGenerationStatus.startedAt,
        characterGenerationStatus.finishedAt || '',
      ].join(':');
      const previousSignature = lastCharacterStatusSignatureRef.current;
      lastCharacterStatusSignatureRef.current = signature;

      const shouldReveal =
        characterGenerationStatus.state === 'running' ||
        (previousSignature !== null && previousSignature !== signature);
      if (!shouldReveal) return;

      setCollapsedSections((prev) =>
        prev.characters ? { ...prev, characters: false } : prev
      );
    }, [
      characterGenerationStatus?.scopePath,
      characterGenerationStatus?.startedAt,
      characterGenerationStatus?.finishedAt,
      characterGenerationStatus?.state,
    ]);

    const toggleSection = useCallback((section: 'story' | 'characters' | 'lore' | 'materials') => {
      setCollapsedSections((prev) => ({ ...prev, [section]: !prev[section] }));
    }, []);

    const toggleStoryDirectory = useCallback((path: string) => {
      setExpandedStoryDirs((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
    }, []);

    const handleToggleSearch = useCallback(() => {
      setShowSearch((prev) => {
        if (!prev) {
          setTimeout(() => searchInputRef.current?.focus(), 50);
        } else {
          setSearchQuery('');
        }
        return !prev;
      });
    }, []);

    // 搜索结果中选择文件时：关闭搜索、展开目录、选中文件
    const handleFileSelectFromSearch = useCallback(
      (filePath: string) => {
        if (searchQuery.trim()) {
          setSearchQuery('');
          setShowSearch(false);
          setRevealPath(filePath);
          // revealPath 用完后清除，避免影响后续手动折叠
          setTimeout(() => setRevealPath(null), 300);
        }
        onFileSelect(filePath);
      },
      [searchQuery, onFileSelect]
    );

    // Cmd+P 快捷键打开搜索
    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => {
        if (matchShortcutEvent(e, quickOpenShortcut)) {
          e.preventDefault();
          setShowSearch(true);
          setTimeout(() => searchInputRef.current?.focus(), 50);
        }
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }, [quickOpenShortcut]);

    const handlePanelKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (isImeComposing(e)) return;
        const mod = e.ctrlKey || e.metaKey;
        if (!mod || !selectedFile) return;
        if (e.key === 'c') {
          e.preventDefault();
          e.stopPropagation();
          onCopyFile?.(selectedFile);
        } else if (e.key === 'v') {
          e.preventDefault();
          e.stopPropagation();
          // Paste into parent dir for files, into dir itself for directories
          const node = findNodeByPath(files, selectedFile);
          const targetDir =
            node?.type === 'directory'
              ? selectedFile
              : selectedFile.substring(0, selectedFile.lastIndexOf('/'));
          if (targetDir) onPasteFiles?.(targetDir);
        }
      },
      [selectedFile, files, onCopyFile, onPasteFiles, hasClipboard]
    );

    const renderIconButton = (
      tooltip: string,
      onClick: (() => void) | undefined,
      icon: React.ReactNode,
      disabled = false,
      className?: string
    ) => (
      <Tooltip content={tooltip} position="bottom">
        <button
          className={className || styles.workspaceAction}
          onClick={onClick}
          title={tooltip}
          aria-label={tooltip}
          disabled={disabled}
          type="button"
        >
          {icon}
        </button>
      </Tooltip>
    );

    const createMenuItems = [
      { label: '新建卷', action: onCreateVolume, disabled: false },
      { label: '新建章', action: onCreateChapter, disabled: false },
      { label: '新建稿夹', action: onCreateDraftFolder, disabled: false },
      { label: '新建稿', action: onCreateDraft, disabled: false },
      { label: 'divider', action: undefined, disabled: false },
      { label: '新建人物', action: onCreateCharacter, disabled: false },
      { label: '新建设定', action: onCreateLoreEntry, disabled: false },
      { label: 'divider', action: undefined, disabled: false },
      { label: '新建资料目录', action: onCreateMaterialDirectory, disabled: false },
      { label: '导入 Word / Excel 文稿', action: onImportFile, disabled: !onImportFile },
    ] as const;

    const groupRowClassName = `${styles.storyNodeButton} ${styles.storyNodeButtonGroup}`;
    const itemRowClassName = `${styles.storyNodeButton} ${styles.storyNodeButtonLeaf}`;
    // 统一处理行级可点击节点的键盘交互，避免用 button 包 button 触发 DOM 嵌套告警。
    const handleRowKeyDown = useCallback((event: React.KeyboardEvent, onActivate: () => void) => {
      if (isImeComposing(event)) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onActivate();
      }
    }, []);

    const handleStoryDragStart = useCallback(
      (event: React.DragEvent, sourcePath: string, parentPath: string) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', sourcePath);
        // 中文说明：拖拽期间只在面板内保留瞬时反馈，真实顺序仍以上层持久化映射为准。
        setStoryDragState({ sourcePath, parentPath });
        setStoryDropTarget(null);
      },
      []
    );

    const resolveStoryDropMode = useCallback(
      (event: React.DragEvent, allowsInside: boolean): 'before' | 'after' | 'inside' => {
        if (!allowsInside) {
          const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
          const ratio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5;
          return ratio >= 0.5 ? 'after' : 'before';
        }
        return 'inside';
      },
      []
    );

    const handleStoryDragOver = useCallback(
      (event: React.DragEvent, targetPath: string, parentPath: string, allowsInside: boolean) => {
        if (
          !storyDragState ||
          storyDragState.sourcePath === targetPath ||
          (!allowsInside && storyDragState.parentPath !== parentPath)
        ) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const nextMode = resolveStoryDropMode(event, allowsInside);
        if (
          !storyDropTarget ||
          storyDropTarget.path !== targetPath ||
          storyDropTarget.mode !== nextMode
        ) {
          setStoryDropTarget({ path: targetPath, mode: nextMode });
        }
      },
      [resolveStoryDropMode, storyDragState, storyDropTarget]
    );

    const handleStoryDrop = useCallback(
      (
        event: React.DragEvent,
        targetPath: string,
        parentPath: string,
        mode: 'before' | 'after' | 'inside'
      ) => {
        if (
          !storyDragState ||
          storyDragState.sourcePath === targetPath ||
          (mode !== 'inside' && storyDragState.parentPath !== parentPath)
        ) {
          return;
        }
        event.preventDefault();
        onReorderStoryNode?.(storyDragState.sourcePath, targetPath, mode);
        setStoryDragState(null);
        setStoryDropTarget(null);
      },
      [onReorderStoryNode, storyDragState]
    );

    const handleStoryDragEnd = useCallback(() => {
      setStoryDragState(null);
      setStoryDropTarget(null);
    }, []);

    const renderStoryNode = (
      node: FileNode,
      level = 0,
      parentPath: string | null = null
    ): React.ReactNode => {
      if (node.type === 'directory') {
        const expanded = expandedStoryDirs.has(node.path);
        const directoryMeta = getStoryDirectoryMeta(node.name);
        const directoryTypeClass =
          directoryMeta.label === '卷'
            ? styles.storyNodeTypeVolume
            : directoryMeta.label === '稿夹'
              ? styles.storyNodeTypeDraftFolder
              : styles.storyNodeTypeGroup;
        const volumeTabPath = createVolumeWorkspaceTab(node.path);
        const isVolumeNode = directoryMeta.label === '卷';
        const isSyntheticVolume =
          isVolumeNode && folderPath === node.path && node.name === '未分卷';
        const isActiveVolume = isVolumeNode && activeWorkspaceTab === volumeTabPath;
        const storyStats = isVolumeNode ? countStoryStats(node) : null;
        const isReorderableDirectory =
          Boolean(parentPath) && !isVolumeNode && !isSyntheticVolume && Boolean(onReorderStoryNode);
        const currentDropMode = storyDropTarget?.path === node.path ? storyDropTarget.mode : null;
        return (
          <div key={node.path} className={styles.storyNode}>
            <div className={styles.storyNodeRow} style={{ paddingLeft: `${14 + level * 16}px` }}>
              <div
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                draggable={isReorderableDirectory}
                className={`${groupRowClassName} ${
                  isActiveVolume ? styles.storyNodeButtonActive : ''
                } ${
                  currentDropMode === 'inside'
                    ? styles.storyNodeDropTargetInside
                    : currentDropMode === 'before'
                      ? styles.storyNodeDropTargetBefore
                      : currentDropMode === 'after'
                        ? styles.storyNodeDropTargetAfter
                        : ''
                }`}
                onClick={() => toggleStoryDirectory(node.path)}
                onKeyDown={(event) =>
                  handleRowKeyDown(event, () => toggleStoryDirectory(node.path))
                }
                onDragStart={(event) =>
                  parentPath ? handleStoryDragStart(event, node.path, parentPath) : undefined
                }
                onDragOver={(event) =>
                  parentPath ? handleStoryDragOver(event, node.path, parentPath, true) : undefined
                }
                onDrop={(event) =>
                  parentPath && currentDropMode
                    ? handleStoryDrop(event, node.path, parentPath, currentDropMode)
                    : undefined
                }
                onDragEnd={handleStoryDragEnd}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (isVolumeNode) {
                    emitObjectContextMenu(event, {
                      kind: 'volume-item',
                      volumePath: node.path,
                      isSynthetic: isSyntheticVolume,
                    });
                    return;
                  }
                  if (isSyntheticVolume) return;
                  onContextMenu?.({ x: event.clientX, y: event.clientY, node });
                }}
              >
                <span className={styles.storyNodeIcon}>{directoryMeta.icon}</span>
                <span className={`${styles.storyNodeType} ${directoryTypeClass}`}>
                  {directoryMeta.label}
                </span>
                <span className={styles.storyNodePrimary}>
                  <span className={styles.storyNodeTitle}>{node.name}</span>
                  {!isSyntheticVolume && (
                    <button
                      type="button"
                      className={styles.storyNodeAction}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRenameNode(node.path);
                      }}
                      aria-label={`修改 ${node.name}`}
                      title={`修改 ${node.name}`}
                    >
                      <AiOutlineEdit />
                    </button>
                  )}
                </span>
                {storyStats && (
                  <span className={styles.storyNodeStats}>
                    <span className={styles.storyNodeStatBadge}>{storyStats.chapters}章</span>
                    {storyStats.drafts > 0 && (
                      <span
                        className={`${styles.storyNodeStatBadge} ${styles.storyNodeStatBadgeMuted}`}
                      >
                        {storyStats.drafts}稿
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>
            {expanded &&
              node.children?.map((child) => renderStoryNode(child, level + 1, node.path))}
          </div>
        );
      }

      const isSelectedChapter = selectedFile === node.path;
      const fileMeta = getStoryFileMeta(node.name);
      const fileTypeClass =
        fileMeta.label === '章' ? styles.storyNodeTypeChapter : styles.storyNodeTypeDraft;
      const currentDropMode = storyDropTarget?.path === node.path ? storyDropTarget.mode : null;
      return (
        <div key={node.path} className={styles.storyNode}>
          <div
            role="button"
            tabIndex={0}
            draggable={Boolean(parentPath && onReorderStoryNode)}
            className={`${itemRowClassName} ${
              isSelectedChapter ? styles.storyNodeButtonActive : ''
            } ${
              currentDropMode === 'before'
                ? styles.storyNodeDropTargetBefore
                : currentDropMode === 'after'
                  ? styles.storyNodeDropTargetAfter
                  : ''
            }`}
            style={{ marginLeft: `${22 + level * 16}px`, marginRight: '12px' }}
            onClick={() => handleFileSelectFromSearch(node.path)}
            onKeyDown={(event) =>
              handleRowKeyDown(event, () => handleFileSelectFromSearch(node.path))
            }
            onDragStart={(event) =>
              parentPath ? handleStoryDragStart(event, node.path, parentPath) : undefined
            }
            onDragOver={(event) =>
              parentPath ? handleStoryDragOver(event, node.path, parentPath, false) : undefined
            }
            onDrop={(event) =>
              parentPath && currentDropMode
                ? handleStoryDrop(event, node.path, parentPath, currentDropMode)
                : undefined
            }
            onDragEnd={handleStoryDragEnd}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onContextMenu?.({ x: event.clientX, y: event.clientY, node });
            }}
          >
            <span className={styles.storyNodeIcon}>{fileMeta.icon}</span>
            <span className={`${styles.storyNodeType} ${fileTypeClass}`}>{fileMeta.label}</span>
            <span className={styles.storyNodePrimary}>
              <span className={styles.storyNodeTitle}>{stripStoryFileExtension(node.name)}</span>
              <button
                type="button"
                className={styles.storyNodeAction}
                onClick={(event) => {
                  event.stopPropagation();
                  onRenameNode(node.path);
                }}
                aria-label={`修改 ${stripStoryFileExtension(node.name)}`}
                title={`修改 ${stripStoryFileExtension(node.name)}`}
              >
                <AiOutlineEdit />
              </button>
            </span>
          </div>
        </div>
      );
    };

    return (
      <div className={styles.filePanel} tabIndex={-1} onKeyDown={handlePanelKeyDown}>
        <div
          className={`${styles.filePanelContent}${isDragOver ? ` ${styles.dropTarget}` : ''}`}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onContextMenu={(e) => {
            e.preventDefault();
            onBackgroundContextMenu?.({ x: e.clientX, y: e.clientY });
          }}
        >
          {shouldShowLoadingState ? (
            <LoadingSpinner message="正在加载..." />
          ) : folderPath ? (
            <>
              {showSearch && (
                <div className={styles.searchBar}>
                  <AiOutlineSearch className={styles.searchIcon} />
                  <input
                    ref={searchInputRef}
                    className={styles.searchInput}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (isImeComposing(e)) return;
                      if (e.key === 'Escape') {
                        setSearchQuery('');
                        setShowSearch(false);
                      }
                    }}
                    placeholder="搜索作品内容..."
                  />
                  {searchQuery && (
                    <button className={styles.searchClear} onClick={() => setSearchQuery('')}>
                      ×
                    </button>
                  )}
                </div>
              )}
              <div className={styles.workspaceSection}>
                <div
                  className={styles.workspaceHeader}
                  onContextMenu={(event) => emitObjectContextMenu(event, { kind: 'project-root' })}
                >
                  <div className={styles.workspaceIdentity}>
                    <span className={styles.workspaceName}>{workspaceLabel}</span>
                    {isWorkspaceBusy && (
                      <span className={styles.workspaceStatus} aria-live="polite">
                        正在切换作品…
                      </span>
                    )}
                    {onRenameProject && (
                      <Tooltip content="修改作品名" position="bottom">
                        <button
                          type="button"
                          className={styles.workspaceNameAction}
                          onClick={onRenameProject}
                          title="修改作品名"
                          aria-label="修改作品名"
                          disabled={isWorkspaceBusy}
                        >
                          <AiOutlineEdit />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                  <div className={styles.workspaceActions}>
                    {renderIconButton(
                      folderPath ? '更换文件夹' : '打开文件夹',
                      onOpenFolder,
                      <AiOutlineFolderOpen />,
                      isLoading
                    )}
                    <Tooltip
                      content={`搜索文件 (${formatShortcutLabel(quickOpenShortcut)})`}
                      position="bottom"
                    >
                      <button
                        className={`${styles.workspaceAction} ${showSearch ? styles.workspaceActionActive : ''}`}
                        onClick={handleToggleSearch}
                        title={`搜索文件 (${formatShortcutLabel(quickOpenShortcut)})`}
                        aria-label={`搜索文件 (${formatShortcutLabel(quickOpenShortcut)})`}
                        type="button"
                      >
                        <AiOutlineSearch />
                      </button>
                    </Tooltip>
                    {onCollapse && (
                      <Tooltip content="折叠侧边栏" position="bottom">
                        <button
                          className={styles.workspaceAction}
                          onClick={onCollapse}
                          title="折叠侧边栏"
                          aria-label="折叠侧边栏"
                          type="button"
                        >
                          ◀
                        </button>
                      </Tooltip>
                    )}
                    <Tooltip content="新建" position="bottom">
                      <button
                        ref={createMenuButtonRef}
                        className={`${styles.workspaceAction} ${createMenuOpen ? styles.workspaceActionActive : ''}`}
                        onClick={() => setCreateMenuOpen((current) => !current)}
                        title="新建"
                        aria-label="新建"
                        disabled={isLoading}
                        type="button"
                      >
                        <AiOutlinePlus />
                      </button>
                    </Tooltip>
                    {renderIconButton(
                      '重新扫描作品目录',
                      onRefresh,
                      <AiOutlineReload />,
                      isLoading
                    )}
                  </div>
                  <Popover
                    open={createMenuOpen}
                    anchorRef={createMenuButtonRef}
                    placement="bottom"
                    align="end"
                    offset={6}
                    className={styles.createMenuPopover}
                    role="menu"
                    onClose={() => setCreateMenuOpen(false)}
                    closeOnOutsideClick
                    closeOnEscape
                  >
                    <div className={styles.createMenu}>
                      {createMenuItems.map((item, index) =>
                        item.label === 'divider' ? (
                          <div key={`divider-${index}`} className={styles.createMenuDivider} />
                        ) : (
                          <button
                            key={item.label}
                            type="button"
                            className={styles.createMenuItem}
                            disabled={item.disabled}
                            onClick={() => {
                              if (item.disabled) return;
                              setCreateMenuOpen(false);
                              item.action?.();
                            }}
                            role="menuitem"
                          >
                            {item.label}
                          </button>
                        )
                      )}
                    </div>
                  </Popover>
                </div>
                <div className={styles.workspaceTree}>
                  <section className={styles.objectSection}>
                    <div
                      className={styles.objectSectionRow}
                      style={{ paddingLeft: '14px' }}
                      onContextMenu={(event) =>
                        emitObjectContextMenu(event, { kind: 'story-root' })
                      }
                    >
                      <button
                        type="button"
                        className={groupRowClassName}
                        onClick={(event) => {
                          if (event.detail !== 1) return;
                          toggleSection('story');
                        }}
                      >
                        <span className={styles.storyNodeTitle}>正文</span>
                      </button>
                    </div>
                    {!collapsedSections.story &&
                      (storyDisplayNodes.length > 0 ? (
                        <div className={styles.storyTree}>
                          {storyDisplayNodes.map((node) =>
                            renderStoryNode(node, 0, folderPath || null)
                          )}
                        </div>
                      ) : (
                        <div className={styles.objectEmpty}>还没有正文文件</div>
                      ))}
                  </section>

                  {showCharactersSection && (
                    <section className={styles.objectSection}>
                      <div
                        className={styles.objectSectionRow}
                        style={{ paddingLeft: '14px' }}
                        onContextMenu={(event) =>
                          emitObjectContextMenu(event, { kind: 'characters-root' })
                        }
                      >
                        <button
                          type="button"
                          className={`${groupRowClassName} ${
                            activeWorkspaceTab === WORKSPACE_TAB_CHARACTERS
                              ? styles.storyNodeButtonActive
                              : ''
                          }`}
                          onClick={(event) => {
                            if (event.detail !== 1) return;
                            toggleSection('characters');
                          }}
                        >
                          <span className={styles.storyNodeIcon}>
                            <AiOutlineUser />
                          </span>
                          <span className={styles.storyNodeTitle}>角色</span>
                          <span className={styles.supportNodeCount}>
                            {filteredCharacters.length}
                          </span>
                        </button>
                      </div>
                      {characterGenerationStatus && (
                        <div
                          className={`${styles.sectionStatusHint} ${
                            characterGenerationStatus.state === 'running'
                              ? styles.sectionStatusRunning
                              : characterGenerationStatus.state === 'error'
                                ? styles.sectionStatusError
                                : characterGenerationStatus.state === 'empty'
                                  ? styles.sectionStatusEmpty
                                  : styles.sectionStatusSuccess
                          }`}
                        >
                          <div className={styles.sectionStatusText}>
                            {characterGenerationStatus.message}
                          </div>
                          {(characterGenerationProgress || characterGenerationMetrics) && (
                            <div className={styles.sectionStatusMeta}>
                              {[characterGenerationProgress, characterGenerationMetrics]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          )}
                        </div>
                      )}
                      {!collapsedSections.characters && (
                        <div className={styles.supportNodeChildren}>
                          {filteredCharacters.map((item) => {
                            const tabPath = createCharacterWorkspaceTab(item);
                            return (
                              <div
                                key={item.id}
                                className={`${styles.objectNodeShell} ${
                                  activeWorkspaceTab === tabPath ? styles.objectNodeShellActive : ''
                                }`}
                                style={{ marginLeft: '28px', marginRight: '12px' }}
                                onContextMenu={(event) =>
                                  emitObjectContextMenu(event, {
                                    kind: 'character-item',
                                    characterId: item.id,
                                  })
                                }
                              >
                                <div
                                  role="button"
                                  tabIndex={0}
                                  className={styles.objectNode}
                                  onClick={() => onOpenCharacterNode(item.id)}
                                  onKeyDown={(event) =>
                                    handleRowKeyDown(event, () => onOpenCharacterNode(item.id))
                                  }
                                >
                                  <span className={styles.objectNodeMarker}>
                                    <AiOutlineUser />
                                  </span>
                                  <span className={styles.objectNodePrimary}>
                                    <span className={styles.objectNodeTitle}>{item.name}</span>
                                    <Tooltip content="修改人物" position="top">
                                      <button
                                        type="button"
                                        className={styles.objectNodeAction}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          onRenameCharacterNode(item.id);
                                        }}
                                        aria-label={`修改人物 ${item.name}`}
                                        title={`修改人物 ${item.name}`}
                                      >
                                        <AiOutlineEdit />
                                      </button>
                                    </Tooltip>
                                  </span>
                                  <span className={styles.objectNodeMetaInline}>
                                    {item.role || '未填写角色定位'}
                                  </span>
                                </div>
                                <Tooltip content="删除人物" position="top">
                                  <button
                                    type="button"
                                    className={styles.objectNodeAction}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      onDeleteCharacterNode(item.id);
                                    }}
                                    aria-label={`删除人物 ${item.name}`}
                                    title={`删除人物 ${item.name}`}
                                  >
                                    <AiOutlineDelete />
                                  </button>
                                </Tooltip>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  )}

                  {showLoreSection && (
                    <section className={styles.objectSection}>
                      <div
                        className={styles.objectSectionRow}
                        style={{ paddingLeft: '14px' }}
                        onContextMenu={(event) =>
                          emitObjectContextMenu(event, { kind: 'lore-root' })
                        }
                      >
                        <button
                          type="button"
                          className={`${groupRowClassName} ${
                            activeWorkspaceTab === WORKSPACE_TAB_LORE
                              ? styles.storyNodeButtonActive
                              : ''
                          }`}
                          onClick={(event) => {
                            if (event.detail !== 1) return;
                            toggleSection('lore');
                          }}
                        >
                          <span className={styles.storyNodeIcon}>
                            <AiOutlineFolder />
                          </span>
                          <span className={styles.storyNodeTitle}>设定</span>
                          <span className={styles.supportNodeCount}>
                            {filteredLoreEntries.length}
                          </span>
                        </button>
                      </div>
                      {!collapsedSections.lore && (
                        <div className={styles.supportNodeChildren}>
                          {filteredLoreEntries.map((item) => {
                            const tabPath = createLoreWorkspaceTab(item);
                            return (
                              <div
                                key={item.id}
                                className={`${styles.objectNodeShell} ${
                                  activeWorkspaceTab === tabPath ? styles.objectNodeShellActive : ''
                                }`}
                                style={{ marginLeft: '28px', marginRight: '12px' }}
                                onContextMenu={(event) =>
                                  emitObjectContextMenu(event, {
                                    kind: 'lore-item',
                                    entryId: item.id,
                                  })
                                }
                              >
                                <div
                                  role="button"
                                  tabIndex={0}
                                  className={styles.objectNode}
                                  onClick={() => onOpenLoreNode(item.id)}
                                  onKeyDown={(event) =>
                                    handleRowKeyDown(event, () => onOpenLoreNode(item.id))
                                  }
                                >
                                  <span className={styles.objectNodeMarker}>
                                    <AiOutlineFolder />
                                  </span>
                                  <span className={styles.objectNodePrimary}>
                                    <span className={styles.objectNodeTitle}>{item.title}</span>
                                    <Tooltip content="修改设定" position="top">
                                      <button
                                        type="button"
                                        className={styles.objectNodeAction}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          onRenameLoreNode(item.id);
                                        }}
                                        aria-label={`修改设定 ${item.title}`}
                                        title={`修改设定 ${item.title}`}
                                      >
                                        <AiOutlineEdit />
                                      </button>
                                    </Tooltip>
                                  </span>
                                  <span className={styles.objectNodeMetaInline}>
                                    {item.summary || '暂无说明'}
                                  </span>
                                </div>
                                <Tooltip content="删除设定" position="top">
                                  <button
                                    type="button"
                                    className={styles.objectNodeAction}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      onDeleteLoreNode(item.id);
                                    }}
                                    aria-label={`删除设定 ${item.title}`}
                                    title={`删除设定 ${item.title}`}
                                  >
                                    <AiOutlineDelete />
                                  </button>
                                </Tooltip>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  )}

                  <section className={styles.objectSection}>
                    <div
                      className={styles.objectSectionRow}
                      style={{ paddingLeft: '14px' }}
                      onContextMenu={(event) =>
                        emitObjectContextMenu(event, { kind: 'materials-root' })
                      }
                    >
                      <button
                        type="button"
                        className={groupRowClassName}
                        onClick={() => toggleSection('materials')}
                      >
                        <span className={styles.storyNodeIcon}>
                          <AiOutlineFolderOpen />
                        </span>
                        <span className={styles.storyNodeTitle}>资料</span>
                        <span className={styles.supportNodeCount}>{materialFileCount}</span>
                      </button>
                    </div>
                    {!collapsedSections.materials &&
                      (materialNodes.length > 0 ? (
                        <div className={styles.supportMaterialsTree}>
                          <FileTree
                            files={materialNodes}
                            fill={false}
                            showFileSizes={showFileSizes}
                            showExpandIcon={false}
                            baseIndent={8}
                            itemMetaMap={materialUsageMap}
                            onFileSelect={handleFileSelectFromSearch}
                            selectedFile={selectedFile}
                            onContextMenu={onContextMenu}
                            onBackgroundContextMenu={onBackgroundContextMenu}
                            creatingType={creatingType}
                            createTargetPath={createTargetPath}
                            onInlineCreate={onInlineCreate}
                            onCancelCreate={onCancelCreate}
                            revealPath={revealPath}
                            onRenameNode={onRenameNode}
                          />
                        </div>
                      ) : (
                        <div className={styles.objectEmpty}>
                          导入的图片、文档和其他素材会出现在这里
                        </div>
                      ))}
                  </section>
                </div>
              </div>
            </>
          ) : (
            <EmptyState variant="folder" />
          )}
        </div>
      </div>
    );
  }
);

export default FilePanel;
