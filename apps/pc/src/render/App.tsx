import React, { useState, useCallback, useRef, useMemo } from 'react';
import type { FileNode } from './types';
import TitleBar from './components/TitleBar';
import FilePanel from './components/FilePanel';
import ContentPanel from './components/ContentPanel';
import RightPanel from './components/RightPanel';
import StatusBar from './components/StatusBar';
import ContextMenu from './components/ContextMenu';
import ShortcutsHelp from './components/ShortcutsHelp';
import VersionTimeline from './components/VersionTimeline';
import DiffEditor from './components/DiffEditor';
import { useToast } from './components/Toast';
import { useDialog } from './components/Dialog';
import type { ContextMenuEvent } from './components/FileTree';
import styles from './App.module.scss';
import { initKeyboardShortcuts } from './components/ShortcutsHelp/shortcuts/initKeyboardShortcuts';
import { cleanupKeyboardShortcuts } from './components/ShortcutsHelp/shortcuts/cleanupKeyboardShortcuts';

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
  node: FileNode;
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
  const [scrollToLine, setScrollToLine] = useState<{ line: number; id: number } | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [editorReloadToken, setEditorReloadToken] = useState(0);
  const [diffState, setDiffState] = useState<{
    original: string;
    modified: string;
    originalLabel: string;
    modifiedLabel: string;
  } | null>(null);

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
      const defaultPath = await window.electron.ipcRenderer.invoke('get-default-data-path');
      await initializeProjectStore(defaultPath);
      const result = await window.electron.ipcRenderer.invoke('refresh-folder', defaultPath);
      if (result) {
        setFolderPath(result.path);
        setFiles(result.files);
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
      if (mod && e.key === 'b') {
        e.preventDefault();
        setSidebarCollapsed((prev) => !prev);
      }
      // Cmd+Shift+F 或 F11: 切换专注模式
      if (e.key === 'F11' || (mod && e.shiftKey && e.key === 'f')) {
        e.preventDefault();
        toggleFocusMode();
      }
      // Cmd+W: 关闭当前标签
      if (mod && e.key === 'w') {
        e.preventDefault();
        if (activeTabRef.current) {
          closeTab(activeTabRef.current);
        }
      }
      // Cmd+N: 新建标签
      if (mod && e.key === 'n') {
        e.preventDefault();
        handleNewTab();
      }
    };

    window.addEventListener('app:new-file', onNewFile);
    window.addEventListener('app:open-folder', onOpenFolder);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      clearTimeout(timer);
      cleanupKeyboardShortcuts();
      window.removeEventListener('app:new-file', onNewFile);
      window.removeEventListener('app:open-folder', onOpenFolder);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [loadDefaultPath, handleOpenLocal, handleCreateFile, toggleFocusMode, closeTab, handleNewTab]);

  const handleFileContextMenu = useCallback((event: ContextMenuEvent) => {
    setContextMenu({ x: event.x, y: event.y, node: event.node });
  }, []);

  const contextMenuItems = useMemo(() => {
    if (!contextMenu) return [];
    const { node } = contextMenu;
    const items: { label: string; onClick: () => void; danger?: boolean; separator?: boolean }[] = [
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
  }, [contextMenu, handleRename, handleDeleteFile, handleDeleteDirectory]);

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

  return (
    <div className={`${styles.app} ${focusMode ? styles.focusMode : ''}`}>
      {!focusMode && (
        <TitleBar
          title="小说编辑器"
          focusMode={focusMode}
          onToggleFocusMode={toggleFocusMode}
          onShowShortcuts={() => setShowShortcuts(true)}
        />
      )}

      <div className={styles.appMain}>
        {/* 左侧文件面板 */}
        {!focusMode && (
          <div
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
                onCollapse={() => setSidebarCollapsed(true)}
                onContextMenu={handleFileContextMenu}
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
            <DiffEditor
              original={diffState.original}
              modified={diffState.modified}
              originalLabel={diffState.originalLabel}
              modifiedLabel={diffState.modifiedLabel}
              onClose={handleCloseDiff}
            />
          ) : (
            <ContentPanel
              openTabs={openTabs}
              activeTab={activeTab}
              reloadToken={editorReloadToken}
              encoding={encoding}
              scrollToLine={scrollToLine}
              onTabSelect={setActiveTab}
              onTabClose={closeTab}
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
          />
        )}
      </div>

      {/* 版本历史模态框 */}
      <VersionTimeline
        visible={showVersionHistory}
        onClose={() => setShowVersionHistory(false)}
        folderPath={folderPath}
        filePath={activeTab}
        onDiffRequest={handleDiffRequest}
        onRestoreFile={handleVersionRestore}
      />

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
      <ShortcutsHelp visible={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </div>
  );
};

export default App;
