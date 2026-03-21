import React, { Suspense, lazy, useState, useCallback, useRef, useMemo, useReducer } from 'react';
import { EditorView } from '@codemirror/view';
import type { FileNode } from './types';
import TitleBar from './components/TitleBar';
import FilePanel from './components/FilePanel';
import ContentPanel from './components/ContentPanel';
import RightPanel from './components/RightPanel';
import { PanelResizer } from './components/PanelResizer';
import { AIAssistantDialog } from './components/RightPanel/AIAssistantDialog';
import { AiConfigProvider } from './components/RightPanel/useAiConfig';
import StatusBar from './components/StatusBar';
import ContextMenu from './components/ContextMenu';
import ShortcutsHelp from './components/ShortcutsHelp';
import AppSettingsCenter from './components/AppSettingsCenter';
import type { SettingsTab, SettingsDraft } from './components/AppSettingsCenter';
import { useToast } from './components/Toast';
import { useDialog } from './components/Dialog';
import type { ContextMenuEvent } from './components/FileTree';
import styles from './App.module.scss';
import { initKeyboardShortcuts } from './components/ShortcutsHelp/shortcuts/initKeyboardShortcuts';
import { cleanupKeyboardShortcuts } from './components/ShortcutsHelp/shortcuts/cleanupKeyboardShortcuts';
import {
  preciseReplaceWithReport,
  formatPreciseReplaceReport,
  normalizedSearch as normalizedSearchInDoc,
} from './utils/preciseReplace';
import { createAISessionChannel } from './utils/aiSessionChannel';
import { setInlineDiffEffect } from './components/TextEditor/inline-diff';
import { fnv1a32 } from './components/RightPanel/utils';
import {
  buildAISessionStorageKey,
  parseAISessionSnapshot,
  type AISessionSnapshot,
} from './state/aiSessionSnapshot';
import {
  reduceFixSession,
  initialFixSessionState,
  fixSessionSelectors,
  type FixDiffState,
} from './state/fixSessionState';

const VersionTimeline = lazy(() => import('./components/VersionTimeline'));
const DiffEditor = lazy(() => import('./components/DiffEditor'));

type CreatingType = 'file' | 'directory' | null;

function findNodeInTree(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const found = findNodeInTree(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

interface CursorPosition {
  line: number;
  column: number;
}

interface ContextMenuState {
  x: number;
  y: number;
  /** null 表示点击了空白区域（背景右键菜单） */
  node: FileNode | null;
}

const App: React.FC = () => {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Tab management
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [editorContent, setEditorContent] = useState('');
  const [cursorPosition, setCursorPosition] = useState<CursorPosition>({ line: 1, column: 1 });
  const [encoding, setEncoding] = useState('UTF-8');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [creatingType, setCreatingType] = useState<CreatingType>(null);
  const [clipboard, setClipboard] = useState<string[]>([]);
  const [scrollToLine, setScrollToLine] = useState<{ line: number; id: string } | null>(null);
  const [replaceLineRequest, setReplaceLineRequest] = useState<{
    line: number;
    text: string;
    id: number;
  } | null>(null);
  const [transientHighlightLine, setTransientHighlightLine] = useState<{
    line: number;
    id: string;
  } | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showSettingsCenter, setShowSettingsCenter] = useState(false);
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [settingsCenterTab, setSettingsCenterTab] = useState<SettingsTab>('general');
  const [userInitials, setUserInitials] = useState('U');
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [editorReloadToken, setEditorReloadToken] = useState(0);
  const [fixState, dispatchFixCommand] = useReducer(reduceFixSession, initialFixSessionState);
  const [dbReady, setDbReady] = useState(false);

  // 修复流程状态（selector 只读）
  const inlineDiff = fixSessionSelectors.inlineDiff(fixState);
  const diffState = fixSessionSelectors.diffState(fixState);
  const pendingApplyQueue = fixSessionSelectors.pendingApplyQueue(fixState);
  // 编辑器 EditorView ref（用于精确事务替换）
  const editorViewRef = useRef<EditorView | null>(null);
  const aiSessionChannelRef = useRef<ReturnType<typeof createAISessionChannel> | null>(null);
  const aiSessionRef = useRef<AISessionSnapshot | null>(null);
  const aiSessionKey = useMemo(() => buildAISessionStorageKey(folderPath), [folderPath]);

  // Panel resize widths (VSCode-style draggable 3-pane layout)
  // Left/right panels have NO minimum — they auto-collapse when dragged below threshold (VSCode behavior)
  const LEFT_COLLAPSED_WIDTH = 36;
  const RIGHT_COLLAPSED_WIDTH = 32;
  const LEFT_COLLAPSE_THRESHOLD = 100;
  const RIGHT_COLLAPSE_THRESHOLD = 120;
  const LEFT_MAX = 480;
  const RIGHT_MAX = 520;
  const CENTER_MIN = 320;
  const [leftPanelWidth, setLeftPanelWidth] = useState(260);
  const [rightPanelWidth, setRightPanelWidth] = useState(300);

  // Untitled tab counter
  const untitledCounterRef = useRef(0);

  // Store pre-focus-mode state to restore when exiting
  const preFocusStateRef = useRef({ sidebarCollapsed: false, rightPanelCollapsed: false });

  const toast = useToast();
  const dialog = useDialog();

  const folderPathRef = useRef(folderPath);
  folderPathRef.current = folderPath;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;
  const filesRef = useRef(files);
  filesRef.current = files;
  const editorContentRef = useRef(editorContent);
  editorContentRef.current = editorContent;

  React.useEffect(() => {
    const ch = createAISessionChannel();
    aiSessionChannelRef.current = ch;
    ch.onMessage((incoming, incomingSessionKey) => {
      if (incomingSessionKey && incomingSessionKey !== aiSessionKey) return;
      aiSessionRef.current = incoming;
      dispatchFixCommand({
        type: 'FIX_SESSION_HYDRATED',
        inlineDiff: incoming.inlineDiff || null,
        pendingApplyQueue: incoming.pendingApplyQueue || [],
      });

      // 单向同步时补齐滚动联动：当收到预览 diff，自动滚动到对应行
      if (incoming.inlineDiff && editorViewRef.current) {
        const line = editorViewRef.current.state.doc.lineAt(
          Math.min(incoming.inlineDiff.from, editorViewRef.current.state.doc.length)
        );
        setScrollToLine({
          line: line.number,
          id: fnv1a32(`diff:${incoming.inlineDiff.from}:${incoming.inlineDiff.to}`),
        });
      }
    });
    return () => ch.close();
  }, [aiSessionKey]);

  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    let cancelled = false;
    const restoreSession = async () => {
      try {
        const raw = (await ipc.invoke('db-settings-get', aiSessionKey)) as string | null;
        const parsed = parseAISessionSnapshot(raw);
        if (!parsed || cancelled) return;
        aiSessionRef.current = parsed;
        dispatchFixCommand({
          type: 'FIX_SESSION_HYDRATED',
          inlineDiff: parsed.inlineDiff || null,
          pendingApplyQueue: parsed.pendingApplyQueue || [],
        });
      } catch {
        // ignore
      }
    };
    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, [aiSessionKey]);

  const persistSessionTimerRef = useRef<number | null>(null);
  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const base = aiSessionRef.current || {
      workflow: 'consistency',
      result: '',
      snapshotFilePath: null,
      prompt: '',
      fixResults: {},
      activeFilePath: activeTabRef.current,
    };
    const nextSnapshot: AISessionSnapshot = {
      ...base,
      activeFilePath: activeTabRef.current,
      inlineDiff,
      pendingApplyQueue,
    };
    aiSessionRef.current = nextSnapshot;

    if (persistSessionTimerRef.current) {
      window.clearTimeout(persistSessionTimerRef.current);
    }
    persistSessionTimerRef.current = window.setTimeout(() => {
      ipc.invoke('db-settings-set', aiSessionKey, JSON.stringify(nextSnapshot)).catch(() => {});
    }, 180);

    return () => {
      if (persistSessionTimerRef.current) {
        window.clearTimeout(persistSessionTimerRef.current);
        persistSessionTimerRef.current = null;
      }
    };
  }, [inlineDiff, pendingApplyQueue, aiSessionKey]);

  React.useEffect(() => {
    const loadUserSettings = async () => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return;
      try {
        const raw = await ipc.invoke('db-settings-get', 'novel-editor:settings-center');
        if (!raw || typeof raw !== 'string') return;
        const parsed = JSON.parse(raw) as { account?: { displayName?: string } };
        const name = parsed.account?.displayName?.trim();
        if (!name) return;
        const initials = name.slice(0, 2);
        setUserInitials(initials);
      } catch {
        // ignore
      }
    };

    loadUserSettings();
  }, []);

  // 侧边栏焦点跟踪（VS Code 风格：mousedown 判断是否在侧边栏区域内）
  const sidebarRef = useRef<HTMLDivElement>(null);
  const appMainRef = useRef<HTMLDivElement>(null);
  const sidebarFocusedRef = useRef(false);
  const sidebarCollapsedRef = useRef(sidebarCollapsed);
  sidebarCollapsedRef.current = sidebarCollapsed;
  const rightPanelCollapsedRef = useRef(rightPanelCollapsed);
  rightPanelCollapsedRef.current = rightPanelCollapsed;
  // Keep current width in refs to avoid stale closures in drag handlers
  const leftPanelWidthRef = useRef(leftPanelWidth);
  leftPanelWidthRef.current = leftPanelWidth;
  const rightPanelWidthRef = useRef(rightPanelWidth);
  rightPanelWidthRef.current = rightPanelWidth;

  const resolvePaneLayout = useCallback(
    (options?: {
      nextSidebarCollapsed?: boolean;
      nextRightPanelCollapsed?: boolean;
      preferExpanding?: 'left' | 'right';
    }) => {
      const containerWidth = appMainRef.current?.offsetWidth ?? 0;

      let nextSidebarCollapsed = options?.nextSidebarCollapsed ?? sidebarCollapsedRef.current;
      let nextRightPanelCollapsed =
        options?.nextRightPanelCollapsed ?? rightPanelCollapsedRef.current;
      let nextLeftWidth = Math.min(LEFT_MAX, leftPanelWidthRef.current);
      let nextRightWidth = Math.min(RIGHT_MAX, rightPanelWidthRef.current);

      if (containerWidth > 0) {
        const availableForSides = Math.max(0, containerWidth - CENTER_MIN);
        // First pass: keep both sides visible whenever possible by shrinking widths.
        if (!nextSidebarCollapsed && !nextRightPanelCollapsed) {
          const desiredTotal = nextLeftWidth + nextRightWidth;
          if (desiredTotal > availableForSides) {
            if (options?.preferExpanding === 'right') {
              nextLeftWidth = Math.max(0, availableForSides - nextRightWidth);
              if (nextLeftWidth + nextRightWidth > availableForSides) {
                nextRightWidth = Math.max(0, availableForSides - nextLeftWidth);
              }
            } else {
              nextRightWidth = Math.max(0, availableForSides - nextLeftWidth);
              if (nextLeftWidth + nextRightWidth > availableForSides) {
                nextLeftWidth = Math.max(0, availableForSides - nextRightWidth);
              }
            }
          }

          // Only collapse as a last resort when one side has effectively no drawable width.
          if (nextLeftWidth <= 0.5 && availableForSides > RIGHT_COLLAPSED_WIDTH) {
            nextSidebarCollapsed = true;
          }
          if (nextRightWidth <= 0.5 && availableForSides > LEFT_COLLAPSED_WIDTH) {
            nextRightPanelCollapsed = true;
          }
        }

        // Second pass: enforce center minimum with collapsed side widths if one side is hidden.
        if (!nextSidebarCollapsed && nextRightPanelCollapsed) {
          nextLeftWidth = Math.min(
            LEFT_MAX,
            Math.max(0, availableForSides - RIGHT_COLLAPSED_WIDTH)
          );
          if (nextLeftWidth <= 0.5) nextSidebarCollapsed = true;
        } else if (nextSidebarCollapsed && !nextRightPanelCollapsed) {
          nextRightWidth = Math.min(
            RIGHT_MAX,
            Math.max(0, availableForSides - LEFT_COLLAPSED_WIDTH)
          );
          if (nextRightWidth <= 0.5) nextRightPanelCollapsed = true;
        }
      }

      if (sidebarCollapsedRef.current !== nextSidebarCollapsed) {
        setSidebarCollapsed(nextSidebarCollapsed);
      }
      if (rightPanelCollapsedRef.current !== nextRightPanelCollapsed) {
        setRightPanelCollapsed(nextRightPanelCollapsed);
      }
      if (Math.abs(leftPanelWidthRef.current - nextLeftWidth) > 0.5) {
        setLeftPanelWidth(nextLeftWidth);
      }
      if (Math.abs(rightPanelWidthRef.current - nextRightWidth) > 0.5) {
        setRightPanelWidth(nextRightWidth);
      }
    },
    [CENTER_MIN, LEFT_COLLAPSED_WIDTH, LEFT_MAX, RIGHT_COLLAPSED_WIDTH, RIGHT_MAX]
  );

  const handleExpandSidebar = useCallback(() => {
    resolvePaneLayout({ nextSidebarCollapsed: false, preferExpanding: 'left' });
  }, [resolvePaneLayout]);

  const handleCollapseSidebar = useCallback(() => {
    setSidebarCollapsed(true);
  }, []);

  const handleToggleSidebar = useCallback(() => {
    if (sidebarCollapsedRef.current) {
      handleExpandSidebar();
      return;
    }
    handleCollapseSidebar();
  }, [handleCollapseSidebar, handleExpandSidebar]);

  const handleLeftResizerMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = leftPanelWidthRef.current;
    const onMouseMove = (ev: MouseEvent) => {
      const next = startWidth + (ev.clientX - startX);
      // Auto-collapse when dragged below threshold (VSCode behavior)
      if (next < LEFT_COLLAPSE_THRESHOLD) {
        setSidebarCollapsed(true);
        return;
      }
      const containerWidth = appMainRef.current?.offsetWidth ?? 0;
      const rightWidth = rightPanelCollapsedRef.current
        ? RIGHT_COLLAPSED_WIDTH
        : rightPanelWidthRef.current;
      const maxAllowed = containerWidth - CENTER_MIN - rightWidth;

      // Expanding left panel can force right panel to auto-collapse to preserve center minimum width.
      if (next > maxAllowed && !rightPanelCollapsedRef.current) {
        setRightPanelCollapsed(true);
        const maxAfterCollapse = containerWidth - CENTER_MIN - RIGHT_COLLAPSED_WIDTH;
        setLeftPanelWidth(Math.min(LEFT_MAX, maxAfterCollapse, next));
        return;
      }

      setLeftPanelWidth(Math.min(LEFT_MAX, maxAllowed, next));
      if (sidebarCollapsedRef.current) setSidebarCollapsed(false);
    };
    const cleanup = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', cleanup);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', cleanup);
  }, []);

  const handleRightResizerMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightPanelWidthRef.current;
    const onMouseMove = (ev: MouseEvent) => {
      // Dragging the right resizer leftward enlarges the right panel
      const next = startWidth - (ev.clientX - startX);
      // Auto-collapse when dragged below threshold
      if (next < RIGHT_COLLAPSE_THRESHOLD) {
        setRightPanelCollapsed(true);
        return;
      }
      const containerWidth = appMainRef.current?.offsetWidth ?? 0;
      const leftWidth = sidebarCollapsedRef.current
        ? LEFT_COLLAPSED_WIDTH
        : leftPanelWidthRef.current;
      const maxAllowed = containerWidth - CENTER_MIN - leftWidth;

      // Expanding right panel can force left panel to auto-collapse to preserve center minimum width.
      if (next > maxAllowed && !sidebarCollapsedRef.current) {
        setSidebarCollapsed(true);
        const maxAfterCollapse = containerWidth - CENTER_MIN - LEFT_COLLAPSED_WIDTH;
        setRightPanelWidth(Math.min(RIGHT_MAX, maxAfterCollapse, next));
        return;
      }

      setRightPanelWidth(Math.min(RIGHT_MAX, maxAllowed, next));
      if (rightPanelCollapsedRef.current) setRightPanelCollapsed(false);
    };
    const cleanup = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', cleanup);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', cleanup);
  }, []);

  React.useEffect(() => {
    const onResize = () => resolvePaneLayout();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [resolvePaneLayout]);

  const initializeProjectStore = useCallback(async (projectFolderPath: string) => {
    if (!window.electron?.ipcRenderer) return;
    const dbDir = `${projectFolderPath}/.novel-editor`;
    await window.electron.ipcRenderer.invoke('db-init', dbDir);
    const existing = await window.electron.ipcRenderer.invoke(
      'db-novel-get-by-folder',
      projectFolderPath
    );
    if (!existing) {
      const projectName = projectFolderPath.split('/').pop() || projectFolderPath;
      await window.electron.ipcRenderer.invoke(
        'db-novel-create',
        projectName,
        projectFolderPath,
        ''
      );
    }
  }, []);

  // Tab helpers
  const openFileInTab = useCallback((filePath: string) => {
    setOpenTabs((prev) => {
      if (prev.includes(filePath)) return prev;
      return [...prev, filePath];
    });
    setActiveTab(filePath);
  }, []);

  const closeTab = useCallback((filePath: string) => {
    setOpenTabs((prev) => {
      const newTabs = prev.filter((t) => t !== filePath);
      // If we're closing the active tab, activate adjacent tab
      if (activeTabRef.current === filePath) {
        const closedIndex = prev.indexOf(filePath);
        const nextTab = newTabs[Math.min(closedIndex, newTabs.length - 1)] || null;
        setActiveTab(nextTab);
      }
      return newTabs;
    });
  }, []);

  // Create new untitled tab (Cmd+N, like VS Code)
  const handleNewTab = useCallback(() => {
    const num = ++untitledCounterRef.current;
    const untitledPath = `__untitled__:Untitled-${num}`;
    setOpenTabs((prev) => [...prev, untitledPath]);
    setActiveTab(untitledPath);
  }, []);

  // Focus mode toggle (uses refs for stable closure — no deps on panel state)
  const toggleFocusMode = useCallback(() => {
    setFocusMode((prev) => {
      if (!prev) {
        // 进入专注模式：如果没有打开的 tab，自动新建一个
        if (openTabsRef.current.length === 0) {
          const num = ++untitledCounterRef.current;
          const untitledPath = `__untitled__:Untitled-${num}`;
          setOpenTabs([untitledPath]);
          setActiveTab(untitledPath);
        }
        preFocusStateRef.current = {
          sidebarCollapsed: sidebarCollapsedRef.current,
          rightPanelCollapsed: rightPanelCollapsedRef.current,
        };
        setSidebarCollapsed(true);
        setRightPanelCollapsed(true);
      } else {
        setSidebarCollapsed(preFocusStateRef.current.sidebarCollapsed);
        setRightPanelCollapsed(preFocusStateRef.current.rightPanelCollapsed);
      }
      return !prev;
    });
  }, []);

  const refreshCurrentFolder = useCallback(async () => {
    const currentFolderPath = folderPathRef.current;
    if (!currentFolderPath) return;
    setIsLoading(true);
    try {
      if (!window.electron?.ipcRenderer) {
        toast.error('Electron IPC 不可用');
        return;
      }
      const result = await window.electron.ipcRenderer.invoke('refresh-folder', currentFolderPath);
      if (result) {
        setFiles(result.files);
      }
    } catch (error) {
      console.error('Error refreshing folder:', error);
      toast.error(`刷新文件夹失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const loadDefaultPath = useCallback(async () => {
    setIsLoading(true);
    try {
      if (!window.electron?.ipcRenderer) {
        console.warn('Electron IPC not available, skipping default path load');
        return;
      }

      // 开箱即用：先初始化默认 SQLite 数据库，确保无论是否打开目录都可用
      await window.electron.ipcRenderer.invoke('db-init-default');
      setDbReady(true);

      // VS Code 风格：优先恢复上次打开的目录，首次安装打开 sample-data
      const lastFolder = await window.electron.ipcRenderer.invoke('get-last-folder');
      const targetPath =
        lastFolder || (await window.electron.ipcRenderer.invoke('get-default-data-path'));

      await initializeProjectStore(targetPath);
      await window.electron.ipcRenderer.invoke('add-recent-folder', targetPath);
      const result = await window.electron.ipcRenderer.invoke('refresh-folder', targetPath);
      if (result) {
        setFolderPath(result.path);
        setFiles(result.files);
      }

      // 更新后首次启动：自动打开更新日志
      try {
        const updateResult = await window.electron.ipcRenderer.invoke('check-just-updated');
        if (updateResult.updated) {
          openFileInTab('__changelog__:更新日志');
        }
      } catch {
        // 忽略检查失败
      }
    } catch (error) {
      console.error('Error loading default path:', error);
    } finally {
      setIsLoading(false);
    }
  }, [initializeProjectStore]);

  const handleOpenLocal = useCallback(async () => {
    setIsLoading(true);
    try {
      if (!window.electron?.ipcRenderer) {
        toast.error('Electron IPC 不可用');
        return;
      }
      const result = await window.electron.ipcRenderer.invoke('open-local-folder');
      if (result) {
        await initializeProjectStore(result.path);
        await window.electron.ipcRenderer.invoke('add-recent-folder', result.path);
        setFolderPath(result.path);
        setFiles(result.files);
        setOpenTabs([]);
        setActiveTab(null);
      }
    } catch (error) {
      console.error('Error opening folder:', error);
      toast.error(`打开文件夹失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsLoading(false);
    }
  }, [toast, initializeProjectStore]);

  const handleOpenSampleData = useCallback(async () => {
    setIsLoading(true);
    try {
      if (!window.electron?.ipcRenderer) return;
      const samplePath = await window.electron.ipcRenderer.invoke('open-sample-data');
      await initializeProjectStore(samplePath);
      await window.electron.ipcRenderer.invoke('add-recent-folder', samplePath);
      const result = await window.electron.ipcRenderer.invoke('refresh-folder', samplePath);
      if (result) {
        setFolderPath(result.path);
        setFiles(result.files);
        setOpenTabs([]);
        setActiveTab(null);
      }
    } catch (error) {
      console.error('Error opening sample data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [initializeProjectStore]);

  const handleCreateFile = useCallback(() => {
    if (!folderPathRef.current) return;
    setCreatingType('file');
  }, []);

  const handleCreateDirectory = useCallback(() => {
    if (!folderPathRef.current) return;
    setCreatingType('directory');
  }, []);

  // Determine target directory for inline creation based on selection
  // null = root level, string = specific directory path
  const createTargetPath = useMemo<string | null>(() => {
    if (!creatingType || !folderPath) return null;
    if (!activeTab) return null;
    const selectedNode = findNodeInTree(files, activeTab);
    if (!selectedNode) return null; // untitled or not in tree → root
    if (selectedNode.type === 'directory') return selectedNode.path;
    // File at root level → root
    if (files.some((n) => n.path === activeTab)) return null;
    // File in subdirectory → parent directory
    const lastSlash = Math.max(activeTab.lastIndexOf('/'), activeTab.lastIndexOf('\\'));
    return lastSlash > 0 ? activeTab.substring(0, lastSlash) : null;
  }, [creatingType, folderPath, activeTab, files]);

  const handleInlineCreate = useCallback(
    async (type: 'file' | 'directory', name: string) => {
      const targetDir = createTargetPath ?? folderPathRef.current;
      if (!targetDir) return;
      if (!window.electron?.ipcRenderer) {
        toast.error('Electron IPC 不可用');
        setCreatingType(null);
        return;
      }
      try {
        if (type === 'file') {
          await window.electron.ipcRenderer.invoke('create-file', targetDir, name);
          toast.success(`文件 "${name}" 创建成功`);
        } else {
          await window.electron.ipcRenderer.invoke('create-directory', targetDir, name);
          toast.success(`目录 "${name}" 创建成功`);
        }
        await refreshCurrentFolder();
      } catch (error) {
        toast.error(`创建失败: ${error instanceof Error ? error.message : '未知错误'}`);
      } finally {
        setCreatingType(null);
      }
    },
    [toast, refreshCurrentFolder, createTargetPath]
  );

  const handleCancelCreate = useCallback(() => {
    setCreatingType(null);
  }, []);

  const handleImportFile = useCallback(async () => {
    if (!window.electron?.ipcRenderer) return;
    try {
      const result = (await window.electron.ipcRenderer.invoke('import-file')) as {
        previews: { fileName: string; content: string }[];
        errors: { filePath: string; error: string }[];
      } | null;
      if (!result) return; // 用户取消
      // Open each preview as an untitled tab (no disk write — user saves manually)
      for (const preview of result.previews) {
        ++untitledCounterRef.current;
        const tabPath = `__untitled__:${preview.fileName}`;
        setOpenTabs((prev) => [...prev, tabPath]);
        setActiveTab(tabPath);
        setEditorContent(preview.content);
      }
      if (result.previews.length > 0) {
        toast.success('文件已转换，可自行编辑后保存');
      }
      if (result.errors.length > 0) {
        toast.error(`${result.errors.length} 个文件转换失败`);
      }
    } catch (error) {
      toast.error(`导入失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [toast]);

  const handleFileSelect = useCallback(
    (filePath: string) => {
      openFileInTab(filePath);
    },
    [openFileInTab]
  );

  const handleDeleteFile = useCallback(
    async (filePath: string) => {
      if (!window.electron?.ipcRenderer) return;
      const name = filePath.split('/').pop() || filePath;
      const confirmed = await dialog.confirm('删除文件', `确定要删除 "${name}" 吗？`);
      if (!confirmed) return;
      try {
        await window.electron.ipcRenderer.invoke('delete-file', filePath);
        closeTab(filePath);
        await refreshCurrentFolder();
        toast.success(`已删除 "${name}"`);
      } catch (error) {
        toast.error(`删除文件失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [toast, dialog, refreshCurrentFolder, closeTab]
  );

  const handleDeleteDirectory = useCallback(
    async (dirPath: string) => {
      if (!window.electron?.ipcRenderer) return;
      const name = dirPath.split('/').pop() || dirPath;
      const confirmed = await dialog.confirm(
        '删除文件夹',
        `确定要删除文件夹 "${name}" 及其所有内容吗？`
      );
      if (!confirmed) return;
      try {
        await window.electron.ipcRenderer.invoke('delete-directory', dirPath);
        // Close any tabs under this directory
        setOpenTabs((prev) => prev.filter((t) => !t.startsWith(dirPath)));
        if (activeTabRef.current?.startsWith(dirPath)) {
          setActiveTab(null);
        }
        await refreshCurrentFolder();
        toast.success(`已删除文件夹 "${name}"`);
      } catch (error) {
        toast.error(`删除目录失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [toast, dialog, refreshCurrentFolder]
  );

  const handleRename = useCallback(
    async (oldPath: string) => {
      if (!window.electron?.ipcRenderer) return;
      const oldName = oldPath.split('/').pop() || oldPath;
      const newName = await dialog.prompt('重命名', '请输入新名称', oldName);
      if (!newName || newName === oldName) return;
      const parentDir = oldPath.substring(0, oldPath.lastIndexOf('/'));
      const newPath = `${parentDir}/${newName}`;
      try {
        await window.electron.ipcRenderer.invoke('rename-file', oldPath, newPath);
        // Update tabs
        setOpenTabs((prev) => prev.map((t) => (t === oldPath ? newPath : t)));
        if (activeTabRef.current === oldPath) {
          setActiveTab(newPath);
        }
        await refreshCurrentFolder();
        toast.success(`已重命名为 "${newName}"`);
      } catch (error) {
        toast.error(`重命名失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [toast, dialog, refreshCurrentFolder]
  );

  const handleCopyFile = useCallback((filePath: string) => {
    setClipboard([filePath]);
  }, []);

  const handlePasteFiles = useCallback(
    async (targetDir: string) => {
      if (!window.electron?.ipcRenderer) return;
      try {
        // 优先使用应用内剪贴板；若为空，尝试读取系统剪贴板中的文件路径（macOS Finder 场景）
        let pathsToPaste = clipboard;
        if (pathsToPaste.length === 0) {
          pathsToPaste = await window.electron.ipcRenderer.invoke('read-clipboard-file-paths');
        }
        if (pathsToPaste.length === 0) return;
        await window.electron.ipcRenderer.invoke('paste-files', pathsToPaste, targetDir);
        await refreshCurrentFolder();
        toast.success('已粘贴');
      } catch (error) {
        toast.error(`粘贴失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [clipboard, toast, refreshCurrentFolder]
  );

  // 拖放导入：从 Finder/Explorer 拖入文件到目录面板（复用 paste-files IPC）
  const handleDropFiles = useCallback(
    async (filePaths: string[]) => {
      if (!window.electron?.ipcRenderer || filePaths.length === 0) return;
      const targetDir = folderPathRef.current;
      if (!targetDir) {
        toast.error('请先打开一个文件夹');
        return;
      }
      try {
        await window.electron.ipcRenderer.invoke('paste-files', filePaths, targetDir);
        await refreshCurrentFolder();
        toast.success(`已导入 ${filePaths.length} 个文件`);
      } catch (error) {
        toast.error(`导入失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [toast, refreshCurrentFolder]
  );

  // Keyboard shortcuts
  React.useEffect(() => {
    initKeyboardShortcuts();
    const timer = setTimeout(() => {
      loadDefaultPath();
    }, 100);

    const onNewFile = () => handleCreateFile();
    const onOpenFolder = () => handleOpenLocal();
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      // Cmd+Q: 退出应用（渲染进程兜底，确保 Menu accelerator 失效时仍可退出）
      if (mod && e.key === 'q') {
        e.preventDefault();
        window.electron?.ipcRenderer?.invoke('app-quit');
        return;
      }
      // Cmd+B: 切换侧边栏
      if (mod && !e.shiftKey && e.key === 'b') {
        e.preventDefault();
        handleToggleSidebar();
      }
      // Cmd+Shift+F 或 F11: 切换专注模式
      if (e.key === 'F11' || (mod && e.shiftKey && e.key === 'f')) {
        e.preventDefault();
        toggleFocusMode();
      }
      // Cmd+W: 关闭当前标签（排除 Cmd+Shift+W 导出 Word）
      if (mod && !e.shiftKey && e.key === 'w') {
        e.preventDefault();
        if (activeTabRef.current) {
          closeTab(activeTabRef.current);
        }
      }
      // Cmd+N: 新建标签
      if (mod && !e.shiftKey && e.key === 'n') {
        e.preventDefault();
        handleNewTab();
      }
    };

    window.addEventListener('app:new-file', onNewFile);
    window.addEventListener('app:open-folder', onOpenFolder);
    window.addEventListener('keydown', onKeyDown);

    // 侧边栏焦点跟踪：鼠标按下时记录是否在侧边栏范围内（VS Code 同款方案）
    const onMouseDown = (e: MouseEvent) => {
      sidebarFocusedRef.current = !!sidebarRef.current?.contains(e.target as Node);
    };
    document.addEventListener('mousedown', onMouseDown);

    // 阻止 Electron 默认的文件拖放行为（拖入文件时浏览器会导航到该文件）
    const preventDefaultDrag = (e: DragEvent) => e.preventDefault();
    document.addEventListener('dragover', preventDefaultDrag);
    document.addEventListener('drop', preventDefaultDrag);

    return () => {
      clearTimeout(timer);
      cleanupKeyboardShortcuts();
      window.removeEventListener('app:new-file', onNewFile);
      window.removeEventListener('app:open-folder', onOpenFolder);
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('dragover', preventDefaultDrag);
      document.removeEventListener('drop', preventDefaultDrag);
    };
  }, []);

  // 导出项目：将整个项目目录复制到用户选择的位置
  const handleExportProject = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const folder = folderPathRef.current;
    if (!folder) {
      toast.error('请先打开一个项目文件夹');
      return;
    }
    try {
      const result = (await ipc.invoke('export-project', folder)) as {
        success: boolean;
        destPath?: string;
        error?: string;
      } | null;
      if (!result) return; // 用户取消
      if (result.success) {
        toast.success(`项目已导出到: ${result.destPath}`);
      } else if (result.error) {
        toast.error(`导出失败: ${result.error}`);
      }
    } catch (error) {
      toast.error(`导出失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [toast]);

  // 监听原生菜单的导出项目快捷键
  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const dispose = ipc.on('menu-export-project', handleExportProject);
    return () => {
      dispose?.();
    };
  }, [handleExportProject]);

  // 监听 AI 独立窗口发来的事件
  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;

    // AI 窗口请求打开文件
    const disposeOpenFile = ipc.on('open-file-from-ai', (_event: unknown, filePath: string) => {
      openFileInTab(filePath);
    });

    // AI 窗口请求打开设置
    const disposeOpenSettings = ipc.on('open-settings-from-ai', () => {
      setSettingsCenterTab('ai');
      setShowSettingsCenter(true);
    });

    // AI 窗口提交修复 → 精确局部替换 + 写盘
    const disposeApplyFix = ipc.on(
      'ai-apply-fix-request',
      async (
        _event: unknown,
        payload: {
          filePath: string;
          original: string;
          modified: string;
          explanation?: string;
          proposedFullContent?: string;
          targetLine?: number;
        }
      ) => {
        const {
          filePath: fp,
          original,
          modified,
          targetLine: delegatedTargetLine,
          proposedFullContent,
        } = payload;

        // 1. 打开目标 tab
        openFileInTab(fp);

        // 2. 等待 EditorView 就绪（tab 切换可能是异步的）
        const waitForView = (): Promise<void> =>
          new Promise((resolve) => {
            if (editorViewRef.current) {
              resolve();
            } else {
              const timer = setTimeout(resolve, 200);
              const check = setInterval(() => {
                if (editorViewRef.current) {
                  clearInterval(check);
                  clearTimeout(timer);
                  resolve();
                }
              }, 20);
            }
          });
        await waitForView();

        const view = editorViewRef.current;
        let fullContent = proposedFullContent || '';
        let matchFrom = -1;
        let sourceForLine = '';
        if (view) {
          const doc = view.state.doc.toString();
          sourceForLine = doc;
          matchFrom = doc.indexOf(original);
          if (!fullContent) {
            const result = preciseReplaceWithReport(doc, original, modified);
            if (!result.content) {
              toast.error('AI 修复未命中，已生成诊断报告');
              console.warn(formatPreciseReplaceReport(result.report));
              return;
            }
            fullContent = result.content;
          }
        } else {
          try {
            const diskContent = (await ipc.invoke('read-file', fp)) as string;
            sourceForLine = diskContent;
            matchFrom = diskContent.indexOf(original);
            if (!fullContent) {
              const result = preciseReplaceWithReport(diskContent, original, modified);
              if (!result.content) {
                toast.error('AI 修复未命中');
                return;
              }
              fullContent = result.content;
            }
          } catch {
            toast.error('文件读写失败');
            return;
          }
        }

        const targetLine =
          delegatedTargetLine ||
          (matchFrom >= 0 ? sourceForLine.slice(0, matchFrom).split('\n').length : 1);

        // AI 侧已确认应用，这里直接落盘，不再触发编辑器二次确认
        dispatchFixCommand({ type: 'FIX_APPLY_STARTED' });
        try {
          await ipc.invoke('write-file', fp, fullContent);
          if (view) {
            // ── 原子事务：文档变更 + diff 装饰在同一个 CM6 transaction 中 ──
            // 这样 StateField 先处理 effect（创建装饰），再遇到 docChanged 时已经 return，
            // 装饰不会被 Decoration.none 清除
            const newFrom = fullContent.indexOf(modified);
            if (newFrom >= 0) {
              const diffEffect = setInlineDiffEffect.of({
                from: newFrom,
                to: newFrom + modified.length,
                oldText: original,
                newText: modified,
              });
              view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: fullContent },
                effects: diffEffect,
                selection: { anchor: newFrom },
                scrollIntoView: true,
              });
            } else {
              view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: fullContent },
              });
            }
            setEditorContent(view.state.doc.toString());
          } else {
            setEditorContent(fullContent);
            setEditorReloadToken((prev) => prev + 1);
          }
        } catch {
          dispatchFixCommand({ type: 'FIX_APPLY_FAILED', error: '文件写入失败' });
          toast.error('文件写入失败');
          return;
        }
        dispatchFixCommand({ type: 'FIX_APPLY_SUCCEEDED' });

        // React state 同步（仅用于 SQLite 持久化，CM6 装饰已在上方原子事务中设置）
        if (matchFrom >= 0) {
          const newFrom = fullContent.indexOf(modified);
          if (newFrom >= 0) {
            dispatchFixCommand({
              type: 'FIX_PREVIEW_READY',
              inlineDiff: {
                from: newFrom,
                to: newFrom + modified.length,
                oldText: original,
                newText: modified,
              },
            });
          }
        }

        if (targetLine > 0) {
          setScrollToLine({
            line: targetLine,
            id: fnv1a32(`apply:${targetLine}:${original}`),
          });
          setTransientHighlightLine({
            line: targetLine,
            id: fnv1a32(`apply:${targetLine}:${original}`),
          });
        }
      }
    );

    return () => {
      disposeOpenFile?.();
      disposeOpenSettings?.();
      disposeApplyFix?.();
    };
  }, [openFileInTab, toast]);

  // 侧边栏 Cmd+C/V 快捷键（独立 effect，确保 clipboard 最新值始终可用）
  React.useEffect(() => {
    /** 判断当前焦点是否在文本编辑区（输入框 / CodeMirror / contenteditable） */
    const isEditingText = () => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName.toUpperCase();
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        el.getAttribute('contenteditable') === 'true' ||
        !!el.closest('.cm-editor')
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!sidebarFocusedRef.current) return;
      if (isEditingText()) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      if (e.key === 'c') {
        // 复制：仅对真实文件路径（排除 __untitled__、__changelog__ 等虚拟路径）
        const tab = activeTabRef.current;
        if (tab && !tab.startsWith('__')) {
          e.preventDefault();
          setClipboard([tab]);
        }
      } else if (e.key === 'v') {
        // 粘贴：优先应用内剪贴板，其次系统剪贴板（Finder 复制的文件）
        e.preventDefault();
        const tab = activeTabRef.current;
        let targetDir = folderPathRef.current;
        if (tab && !tab.startsWith('__') && tab.includes('/')) {
          const node = findNodeInTree(filesRef.current, tab);
          if (node?.type === 'directory') {
            targetDir = tab;
          } else {
            targetDir = tab.substring(0, tab.lastIndexOf('/'));
          }
        }
        if (targetDir) handlePasteFiles(targetDir);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clipboard, handlePasteFiles]);

  const handleFileContextMenu = useCallback((event: ContextMenuEvent) => {
    setContextMenu({ x: event.x, y: event.y, node: event.node });
  }, []);

  const handleBackgroundContextMenu = useCallback((pos: { x: number; y: number }) => {
    setContextMenu({ x: pos.x, y: pos.y, node: null });
  }, []);

  const contextMenuItems = useMemo(() => {
    if (!contextMenu) return [];
    const { node } = contextMenu;

    // ─── 空白处右键（背景菜单） ───────────────────────────────────────────
    if (!node) {
      const bgPasteDir = folderPath;
      return [
        { label: '新建文件', onClick: handleCreateFile },
        { label: '新建文件夹', onClick: handleCreateDirectory },
        { label: '', onClick: () => {}, separator: true },
        {
          label: '粘贴',
          onClick: () => bgPasteDir && handlePasteFiles(bgPasteDir),
          disabled: !folderPath,
        },
        { label: '', onClick: () => {}, separator: true },
        { label: '刷新', onClick: refreshCurrentFolder },
      ];
    }

    // ─── 文件/目录右键 ────────────────────────────────────────────────────
    const pasteTargetDir =
      node.type === 'directory' ? node.path : node.path.substring(0, node.path.lastIndexOf('/'));
    const items: {
      label: string;
      onClick: () => void;
      danger?: boolean;
      disabled?: boolean;
      separator?: boolean;
    }[] = [
      { label: '复制', onClick: () => handleCopyFile(node.path) },
      {
        label: '粘贴',
        onClick: () => handlePasteFiles(pasteTargetDir),
      },
      { label: '', onClick: () => {}, separator: true },
      { label: '重命名', onClick: () => handleRename(node.path) },
      { label: '', onClick: () => {}, separator: true },
    ];
    if (node.type === 'file') {
      items.push({
        label: '删除文件',
        onClick: () => handleDeleteFile(node.path),
        danger: true,
      });
    } else {
      items.push({
        label: '删除文件夹',
        onClick: () => handleDeleteDirectory(node.path),
        danger: true,
      });
    }
    return items;
  }, [
    contextMenu,
    folderPath,
    clipboard,
    handleCreateFile,
    handleCreateDirectory,
    handleCopyFile,
    handlePasteFiles,
    handleRename,
    handleDeleteFile,
    handleDeleteDirectory,
    refreshCurrentFolder,
  ]);

  // Save untitled file: prompt for name, write to disk, replace tab
  const handleSaveUntitled = useCallback(
    async (untitledPath: string, content: string) => {
      const currentFolder = folderPathRef.current;
      if (!currentFolder || !window.electron?.ipcRenderer) {
        toast.error('请先打开一个文件夹');
        return;
      }
      const fileName = await dialog.prompt('保存文件', '请输入文件名', '');
      if (!fileName) return;
      const newPath = `${currentFolder}/${fileName}`;
      try {
        await window.electron.ipcRenderer.invoke('write-file', newPath, content);
        // Replace untitled tab with real file path
        setOpenTabs((prev) => prev.map((t) => (t === untitledPath ? newPath : t)));
        if (activeTabRef.current === untitledPath) {
          setActiveTab(newPath);
        }
        await refreshCurrentFolder();
        toast.success(`文件 "${fileName}" 已保存`);
      } catch (error) {
        toast.error(`保存失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [toast, dialog, refreshCurrentFolder]
  );

  const handleContentChange = useCallback((content: string) => {
    setEditorContent(content);
  }, []);

  const handleCursorChange = useCallback((pos: CursorPosition) => {
    setCursorPosition(pos);
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleToggleRightPanel = useCallback(() => {
    if (rightPanelCollapsedRef.current) {
      resolvePaneLayout({ nextRightPanelCollapsed: false, preferExpanding: 'right' });
      return;
    }
    setRightPanelCollapsed(true);
  }, [resolvePaneLayout]);

  const handleScrollProcessed = useCallback(() => {
    setScrollToLine(null);
  }, []);

  const handleTransientHighlightProcessed = useCallback(() => {
    setTransientHighlightLine(null);
  }, []);

  const handleScrollToLine = useCallback((line: number, contentKey?: string) => {
    setScrollToLine({ line, id: fnv1a32(contentKey ?? `line:${line}`) });
  }, []);

  const replaceIdRef = useRef(0);
  const handleReplaceLineText = useCallback((line: number, text: string) => {
    setReplaceLineRequest({ line, text, id: ++replaceIdRef.current });
  }, []);

  const handleTransientHighlightLine = useCallback((line: number) => {
    setTransientHighlightLine({ line, id: fnv1a32(`line:${line}`) });
  }, []);

  const handleDiffRequest = useCallback(
    (original: string, modified: string, originalLabel: string, modifiedLabel: string) => {
      const nextDiff: FixDiffState = { original, modified, originalLabel, modifiedLabel };
      dispatchFixCommand({ type: 'FIX_DIFF_VIEW_OPEN', diffState: nextDiff });
    },
    []
  );

  const handleCloseDiff = useCallback(() => {
    dispatchFixCommand({ type: 'FIX_CLEAR' });
  }, []);

  // 接受 AI 修复：写入文件并刷新编辑器
  const handleAcceptFix = useCallback(async () => {
    const fix = pendingApplyQueue[0] || null;
    if (!fix) return;
    dispatchFixCommand({ type: 'FIX_APPLY_STARTED' });
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    try {
      await ipc.invoke('write-file', fix.filePath, fix.content);

      // 强制同步：接受修改后总是打开并聚焦目标 tab，再更新编辑器与定位
      openFileInTab(fix.filePath);
      setEditorContent(fix.content);
      if (typeof fix.targetLine === 'number' && fix.targetLine > 0) {
        handleScrollToLine(fix.targetLine);
        handleTransientHighlightLine(fix.targetLine);
      }
      setEditorReloadToken((prev) => prev + 1);
    } catch {
      dispatchFixCommand({ type: 'FIX_APPLY_FAILED', error: '文件写入失败' });
      return;
    }
    dispatchFixCommand({ type: 'FIX_APPLY_SUCCEEDED' });
  }, [openFileInTab, handleScrollToLine, handleTransientHighlightLine, pendingApplyQueue]);

  const handleVersionRestore = useCallback(
    async (restoredFilePath: string) => {
      await refreshCurrentFolder();
      if (activeTabRef.current === restoredFilePath) {
        setEditorReloadToken((prev) => prev + 1);
      }
    },
    [refreshCurrentFolder]
  );

  // ─── Tab 右键菜单操作 ─────────────────────────────────────────────
  const handleCloseOtherTabs = useCallback((filePath: string) => {
    setOpenTabs([filePath]);
    setActiveTab(filePath);
  }, []);

  const handleCloseAllTabs = useCallback(() => {
    setOpenTabs([]);
    setActiveTab(null);
  }, []);

  const handleCloseAllAndSave = useCallback(() => {
    // 先触发保存当前文件
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true })
    );
    // 短延迟后关闭所有标签，确保保存完成
    setTimeout(() => {
      setOpenTabs([]);
      setActiveTab(null);
    }, 200);
  }, []);

  // 监听子组件通过自定义事件打开设置中心指定标签页
  React.useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail as SettingsTab;
      setSettingsCenterTab(tab);
      setShowSettingsCenter(true);
    };
    window.addEventListener('open-settings-tab', handler);
    return () => window.removeEventListener('open-settings-tab', handler);
  }, []);

  return (
    <AiConfigProvider>
      <div className={`${styles.app} ${focusMode ? styles.focusMode : ''}`}>
        {!focusMode && (
          <TitleBar
            title="小说编辑器"
            focusMode={focusMode}
            userInitials={userInitials}
            onToggleFocusMode={toggleFocusMode}
            onOpenSettings={() => {
              setSettingsCenterTab('general');
              setShowSettingsCenter(true);
            }}
            onOpenAccountSettings={() => {
              setSettingsCenterTab('account');
              setShowSettingsCenter(true);
            }}
            onShowShortcuts={() => setShowShortcuts(true)}
            onOpenSampleData={handleOpenSampleData}
            onOpenAIAssistant={() => setShowAIAssistant(true)}
            onExportProject={handleExportProject}
          />
        )}

        <div className={styles.appMain} ref={appMainRef}>
          {/* 左侧文件面板 */}
          {!focusMode && (
            <div
              ref={sidebarRef}
              className={`${styles.leftPanel} ${sidebarCollapsed ? styles.leftPanelCollapsed : ''}`}
              style={sidebarCollapsed ? undefined : { width: leftPanelWidth }}
            >
              {sidebarCollapsed ? (
                <button
                  className={styles.sidebarToggle}
                  onClick={handleExpandSidebar}
                  title="展开侧边栏"
                >
                  ▶
                </button>
              ) : (
                <FilePanel
                  files={files}
                  selectedFile={activeTab}
                  folderPath={folderPath}
                  isLoading={isLoading}
                  onFileSelect={handleFileSelect}
                  onCreateFile={handleCreateFile}
                  onCreateDirectory={handleCreateDirectory}
                  onRefresh={refreshCurrentFolder}
                  onOpenFolder={handleOpenLocal}
                  onImportFile={handleImportFile}
                  onCollapse={handleCollapseSidebar}
                  onContextMenu={handleFileContextMenu}
                  onBackgroundContextMenu={handleBackgroundContextMenu}
                  onCopyFile={handleCopyFile}
                  onPasteFiles={handlePasteFiles}
                  onDropFiles={handleDropFiles}
                  hasClipboard={clipboard.length > 0}
                  creatingType={creatingType}
                  createTargetPath={createTargetPath}
                  onInlineCreate={handleInlineCreate}
                  onCancelCreate={handleCancelCreate}
                />
              )}
            </div>
          )}

          {/* 左侧拖拽把手 */}
          {!focusMode && !sidebarCollapsed && (
            <PanelResizer onMouseDown={handleLeftResizerMouseDown} />
          )}

          {/* 中间内容面板 */}
          <div className={styles.centerPanel} style={{ minWidth: CENTER_MIN }}>
            {diffState ? (
              <Suspense fallback={<div className={styles.lazyFallback}>正在加载差异编辑器...</div>}>
                <DiffEditor
                  original={diffState.original}
                  modified={diffState.modified}
                  originalLabel={diffState.originalLabel}
                  modifiedLabel={diffState.modifiedLabel}
                  onClose={handleCloseDiff}
                  onAccept={pendingApplyQueue.length > 0 ? handleAcceptFix : undefined}
                />
              </Suspense>
            ) : (
              <ContentPanel
                openTabs={openTabs}
                activeTab={activeTab}
                focusMode={focusMode}
                reloadToken={editorReloadToken}
                encoding={encoding}
                scrollToLine={scrollToLine}
                transientHighlightLine={transientHighlightLine}
                replaceLineRequest={replaceLineRequest}
                inlineDiff={inlineDiff}
                editorViewRef={editorViewRef}
                onTabSelect={setActiveTab}
                onTabClose={closeTab}
                onCloseOtherTabs={handleCloseOtherTabs}
                onCloseAllTabs={handleCloseAllTabs}
                onCloseAllAndSave={handleCloseAllAndSave}
                onContentChange={handleContentChange}
                onCursorChange={handleCursorChange}
                onSaveUntitled={handleSaveUntitled}
                onScrollProcessed={handleScrollProcessed}
                onTransientHighlightProcessed={handleTransientHighlightProcessed}
              />
            )}
            {focusMode && (
              <button
                className={styles.exitFocusBtn}
                onClick={toggleFocusMode}
                title="退出聚焦模式 (F11)"
              >
                退出聚焦
              </button>
            )}
          </div>

          {/* 右侧拖拽把手 + 右侧信息面板 */}
          {!focusMode && (
            <>
              {!rightPanelCollapsed && <PanelResizer onMouseDown={handleRightResizerMouseDown} />}
              <div
                className={styles.rightPanelWrapper}
                style={
                  rightPanelCollapsed
                    ? { width: RIGHT_COLLAPSED_WIDTH }
                    : { width: rightPanelWidth }
                }
              >
                <RightPanel
                  content={editorContent}
                  collapsed={rightPanelCollapsed}
                  onToggle={handleToggleRightPanel}
                  onScrollToLine={handleScrollToLine}
                  onReplaceLineText={handleReplaceLineText}
                  folderPath={folderPath}
                  dbReady={dbReady}
                />
              </div>
            </>
          )}
        </div>

        {/* 版本历史模态框 */}
        {showVersionHistory && (
          <Suspense
            fallback={
              <div className={styles.lazyOverlay}>
                <div className={styles.lazyModal}>正在加载版本历史...</div>
              </div>
            }
          >
            <VersionTimeline
              visible={showVersionHistory}
              onClose={() => setShowVersionHistory(false)}
              folderPath={folderPath}
              filePath={activeTab}
              onDiffRequest={handleDiffRequest}
              onRestoreFile={handleVersionRestore}
            />
          </Suspense>
        )}

        {/* 状态栏 */}
        {!focusMode && (
          <StatusBar
            content={editorContent}
            currentLine={cursorPosition.line}
            currentColumn={cursorPosition.column}
            filePath={activeTab}
            encoding={encoding}
            onEncodingChange={setEncoding}
            folderPath={folderPath}
            onToggleVersionHistory={() => setShowVersionHistory((p) => !p)}
          />
        )}

        {/* 右键菜单 */}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextMenuItems}
            onClose={handleCloseContextMenu}
          />
        )}

        {/* 快捷键帮助 */}
        <ShortcutsHelp
          visible={showShortcuts}
          onClose={() => setShowShortcuts(false)}
          onOpenSampleData={handleOpenSampleData}
        />

        <AppSettingsCenter
          visible={showSettingsCenter}
          onClose={() => setShowSettingsCenter(false)}
          initialTab={settingsCenterTab}
          onSettingsChange={(next: SettingsDraft) => {
            const name = next.account.displayName.trim();
            setUserInitials(name ? name.slice(0, 2) : 'U');
          }}
          onOpenShortcuts={() => setShowShortcuts(true)}
        />

        <AIAssistantDialog
          visible={showAIAssistant}
          onClose={() => setShowAIAssistant(false)}
          folderPath={folderPath}
          content={editorContent}
          filePath={activeTab}
          onApplyFix={async (
            original: string,
            modified: string,
            targetPath?: string,
            targetLine?: number
          ) => {
            dispatchFixCommand({ type: 'FIX_APPLY_STARTED' });
            const view = editorViewRef.current;
            const ipc = window.electron?.ipcRenderer;
            const isCurrentTab = !targetPath || targetPath === activeTabRef.current;

            if (isCurrentTab && view) {
              // ── 原子事务：文档变更 + diff 装饰在同一个 CM6 transaction ──
              const doc = view.state.doc.toString();
              const matchFrom = doc.indexOf(original);
              if (matchFrom >= 0) {
                const diffEffect = setInlineDiffEffect.of({
                  from: matchFrom,
                  to: matchFrom + modified.length,
                  oldText: original,
                  newText: modified,
                });
                view.dispatch({
                  changes: { from: matchFrom, to: matchFrom + original.length, insert: modified },
                  effects: diffEffect,
                  selection: { anchor: matchFrom },
                  scrollIntoView: true,
                });
              } else {
                const result = preciseReplaceWithReport(doc, original, modified);
                if (result.content) {
                  const newFrom = result.content.indexOf(modified);
                  const effects =
                    newFrom >= 0
                      ? setInlineDiffEffect.of({
                          from: newFrom,
                          to: newFrom + modified.length,
                          oldText: original,
                          newText: modified,
                        })
                      : undefined;
                  view.dispatch({
                    changes: { from: 0, to: doc.length, insert: result.content },
                    effects: effects ? [effects] : undefined,
                    selection: newFrom >= 0 ? { anchor: newFrom } : undefined,
                    scrollIntoView: newFrom >= 0,
                  });
                }
              }
              // 同步 state + 写盘
              const newDoc = view.state.doc.toString();
              setEditorContent(newDoc);
              if (ipc && targetPath) {
                ipc.invoke('write-file', targetPath, newDoc).catch(() => {});
              }

              // React state 同步（仅用于 SQLite 持久化）
              const postDoc = view.state.doc.toString();
              const newFrom = postDoc.indexOf(modified);
              if (newFrom >= 0) {
                dispatchFixCommand({
                  type: 'FIX_PREVIEW_READY',
                  inlineDiff: {
                    from: newFrom,
                    to: newFrom + modified.length,
                    oldText: original,
                    newText: modified,
                  },
                });
              }
            } else {
              // 非当前 tab：读盘 → 替换 → 写盘 → reloadToken
              if (ipc && targetPath) {
                try {
                  const diskContent = (await ipc.invoke('read-file', targetPath)) as string;
                  const result = preciseReplaceWithReport(diskContent, original, modified);
                  if (result.content) {
                    await ipc.invoke('write-file', targetPath, result.content);
                  }
                } catch {
                  dispatchFixCommand({ type: 'FIX_APPLY_FAILED', error: '文件读写失败' });
                  return;
                }
              }
              setEditorReloadToken((prev) => prev + 1);
            }
            dispatchFixCommand({ type: 'FIX_APPLY_SUCCEEDED', keepPreview: true });
            // Scroll + highlight
            if (targetLine && targetLine > 0) {
              setScrollToLine({
                line: targetLine,
                id: fnv1a32(`fix:${targetLine}:${original}`),
              });
              setTransientHighlightLine({
                line: targetLine,
                id: fnv1a32(`fix:${targetLine}:${original}`),
              });
            }
          }}
          onOpenFile={openFileInTab}
          onPreviewDiff={(original, modified) => {
            // 在编辑器文档中定位 original 片段，设置内联 diff 装饰
            const view = editorViewRef.current;
            if (!view) return;
            const doc = view.state.doc.toString();
            let from = doc.indexOf(original);
            if (from < 0) {
              // 归一化回退查找
              const match = normalizedSearchInDoc(doc, original);
              if (!match) return;
              from = match.from;
            }
            const inlineDiffData = {
              from,
              to: from + original.length,
              oldText: original,
              newText: modified,
            };
            // ── 直接 dispatch 到 CM6，不经过 React state pipeline ──
            // 确保装饰立即生效，不受 BroadcastChannel / useEffect 时序干扰
            const line = view.state.doc.lineAt(Math.min(from, view.state.doc.length));
            view.dispatch({
              effects: setInlineDiffEffect.of(inlineDiffData),
              selection: { anchor: line.from },
              scrollIntoView: true,
            });
            // React state 同步（仅用于 SQLite 持久化）
            dispatchFixCommand({
              type: 'FIX_PREVIEW_READY',
              inlineDiff: inlineDiffData,
            });
          }}
          onOpenSettings={() => {
            setShowAIAssistant(false);
            setSettingsCenterTab('ai');
            setShowSettingsCenter(true);
          }}
        />
      </div>
    </AiConfigProvider>
  );
};

export default App;
