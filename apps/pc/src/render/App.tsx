import React, { Suspense, lazy, useState, useCallback, useRef, useMemo } from 'react';
import type { FileNode } from './types';
import TitleBar from './components/TitleBar';
import FilePanel from './components/FilePanel';
import ContentPanel from './components/ContentPanel';
import RightPanel from './components/RightPanel';
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
  const [scrollToLine, setScrollToLine] = useState<{ line: number; id: number } | null>(null);
  const [replaceLineRequest, setReplaceLineRequest] = useState<{
    line: number;
    text: string;
    id: number;
  } | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showSettingsCenter, setShowSettingsCenter] = useState(false);
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [settingsCenterTab, setSettingsCenterTab] = useState<SettingsTab>('general');
  const [userInitials, setUserInitials] = useState('U');
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [editorReloadToken, setEditorReloadToken] = useState(0);
  const [diffState, setDiffState] = useState<{
    original: string;
    modified: string;
    originalLabel: string;
    modifiedLabel: string;
  } | null>(null);
  const [dbReady, setDbReady] = useState(false);

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
  const sidebarFocusedRef = useRef(false);
  const sidebarCollapsedRef = useRef(sidebarCollapsed);
  sidebarCollapsedRef.current = sidebarCollapsed;
  const rightPanelCollapsedRef = useRef(rightPanelCollapsed);
  rightPanelCollapsedRef.current = rightPanelCollapsed;

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
        setSidebarCollapsed((prev) => !prev);
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
    setRightPanelCollapsed((prev) => !prev);
  }, []);

  const scrollIdRef = useRef(0);
  const handleScrollToLine = useCallback((line: number) => {
    setScrollToLine({ line, id: ++scrollIdRef.current });
  }, []);

  const replaceIdRef = useRef(0);
  const handleReplaceLineText = useCallback((line: number, text: string) => {
    setReplaceLineRequest({ line, text, id: ++replaceIdRef.current });
  }, []);

  const handleDiffRequest = useCallback(
    (original: string, modified: string, originalLabel: string, modifiedLabel: string) => {
      setDiffState({ original, modified, originalLabel, modifiedLabel });
    },
    []
  );

  const handleCloseDiff = useCallback(() => {
    setDiffState(null);
  }, []);

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

        <div className={styles.appMain}>
          {/* 左侧文件面板 */}
          {!focusMode && (
            <div
              ref={sidebarRef}
              className={`${styles.leftPanel} ${sidebarCollapsed ? styles.leftPanelCollapsed : ''}`}
            >
              {sidebarCollapsed ? (
                <button
                  className={styles.sidebarToggle}
                  onClick={() => setSidebarCollapsed(false)}
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
                  onCollapse={() => setSidebarCollapsed(true)}
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

          {/* 中间内容面板 */}
          <div className={styles.centerPanel}>
            {diffState ? (
              <Suspense fallback={<div className={styles.lazyFallback}>正在加载差异编辑器...</div>}>
                <DiffEditor
                  original={diffState.original}
                  modified={diffState.modified}
                  originalLabel={diffState.originalLabel}
                  modifiedLabel={diffState.modifiedLabel}
                  onClose={handleCloseDiff}
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
                replaceLineRequest={replaceLineRequest}
                onTabSelect={setActiveTab}
                onTabClose={closeTab}
                onCloseOtherTabs={handleCloseOtherTabs}
                onCloseAllTabs={handleCloseAllTabs}
                onCloseAllAndSave={handleCloseAllAndSave}
                onContentChange={handleContentChange}
                onCursorChange={handleCursorChange}
                onSaveUntitled={handleSaveUntitled}
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

          {/* 右侧信息面板 */}
          {!focusMode && (
            <RightPanel
              content={editorContent}
              collapsed={rightPanelCollapsed}
              onToggle={handleToggleRightPanel}
              onScrollToLine={handleScrollToLine}
              onReplaceLineText={handleReplaceLineText}
              folderPath={folderPath}
              dbReady={dbReady}
            />
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
