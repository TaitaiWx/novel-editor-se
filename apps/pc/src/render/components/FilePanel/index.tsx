import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  AiOutlineFile,
  AiOutlineFolderAdd,
  AiOutlineReload,
  AiOutlineFolderOpen,
  AiOutlineSearch,
  AiOutlineImport,
} from 'react-icons/ai';
import LoadingSpinner from '../LoadingSpinner';
import EmptyState from '../EmptyState';
import FileTree from '../FileTree';
import Tooltip from '../Tooltip';
import type { ContextMenuEvent } from '../FileTree';
import { FileNode } from '../../types';
import styles from './styles.module.scss';

interface FilePanelProps {
  files: FileNode[];
  selectedFile: string | null;
  folderPath: string | null;
  isLoading: boolean;
  onFileSelect: (filePath: string) => void;
  onCreateFile: () => void;
  onCreateDirectory: () => void;
  onRefresh: () => void;
  onOpenFolder: () => void;
  onImportFile?: () => void;
  onCollapse?: () => void;
  onContextMenu?: (event: ContextMenuEvent) => void;
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

const FilePanel: React.FC<FilePanelProps> = React.memo(
  ({
    files,
    selectedFile,
    folderPath,
    isLoading,
    onFileSelect,
    onCreateFile,
    onCreateDirectory,
    onRefresh,
    onOpenFolder,
    onImportFile,
    onCollapse,
    onContextMenu,
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
    const searchInputRef = useRef<HTMLInputElement>(null);

    // ─── 拖放导入（VS Code 风格: Finder/Explorer → 文件面板） ─────────────
    const [isDragOver, setIsDragOver] = useState(false);
    const dragCounterRef = useRef(0);

    const handleDragOver = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }, []);

    const handleDragEnter = useCallback((e: React.DragEvent) => {
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

    const filteredFiles = useMemo(() => {
      if (!searchQuery.trim()) return files;
      return filterTree(files, searchQuery.trim());
    }, [files, searchQuery]);

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
        if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
          e.preventDefault();
          setShowSearch(true);
          setTimeout(() => searchInputRef.current?.focus(), 50);
        }
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    const handlePanelKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
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

    return (
      <div className={styles.filePanel} tabIndex={-1} onKeyDown={handlePanelKeyDown}>
        <div className={styles.explorerHeader}>
          <span className={styles.explorerTitle}>资源管理器</span>
          <div className={styles.headerActions}>
            {renderIconButton(
              folderPath ? '更换文件夹' : '打开文件夹',
              onOpenFolder,
              <AiOutlineFolderOpen />,
              isLoading,
              styles.explorerAction
            )}
            {folderPath && (
              <Tooltip content="搜索文件 (Cmd+P)" position="bottom">
                <button
                  className={`${styles.explorerAction} ${showSearch ? styles.active : ''}`}
                  onClick={handleToggleSearch}
                  title="搜索文件 (Cmd+P)"
                  aria-label="搜索文件 (Cmd+P)"
                  type="button"
                >
                  <AiOutlineSearch />
                </button>
              </Tooltip>
            )}
            {onCollapse && (
              <Tooltip content="折叠侧边栏" position="bottom">
                <button
                  className={styles.explorerAction}
                  onClick={onCollapse}
                  title="折叠侧边栏"
                  aria-label="折叠侧边栏"
                  type="button"
                >
                  ◀
                </button>
              </Tooltip>
            )}
          </div>
        </div>

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
          {isLoading ? (
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
                      if (e.key === 'Escape') {
                        setSearchQuery('');
                        setShowSearch(false);
                      }
                    }}
                    placeholder="搜索文件..."
                  />
                  {searchQuery && (
                    <button className={styles.searchClear} onClick={() => setSearchQuery('')}>
                      ×
                    </button>
                  )}
                </div>
              )}
              <div className={styles.workspaceSection}>
                <div className={styles.workspaceHeader}>
                  <span className={styles.workspaceName}>{folderName?.toUpperCase()}</span>
                  <div className={styles.workspaceActions}>
                    {renderIconButton('新建正文文件', onCreateFile, <AiOutlineFile />, isLoading)}
                    {renderIconButton(
                      '新建目录',
                      onCreateDirectory,
                      <AiOutlineFolderAdd />,
                      isLoading
                    )}
                    {onImportFile &&
                      renderIconButton(
                        '导入 Word / Excel',
                        onImportFile,
                        <AiOutlineImport />,
                        isLoading
                      )}
                    {renderIconButton(
                      '重新扫描作品目录',
                      onRefresh,
                      <AiOutlineReload />,
                      isLoading
                    )}
                  </div>
                </div>
                <FileTree
                  files={filteredFiles}
                  onFileSelect={handleFileSelectFromSearch}
                  selectedFile={selectedFile}
                  onContextMenu={onContextMenu}
                  onBackgroundContextMenu={onBackgroundContextMenu}
                  creatingType={creatingType}
                  createTargetPath={createTargetPath}
                  onInlineCreate={onInlineCreate}
                  onCancelCreate={onCancelCreate}
                  revealPath={revealPath}
                />
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
