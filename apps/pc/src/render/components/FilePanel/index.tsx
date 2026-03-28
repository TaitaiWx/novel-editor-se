import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  AiOutlineReload,
  AiOutlineFolderOpen,
  AiOutlineSearch,
  AiOutlineImport,
  AiOutlinePlus,
} from 'react-icons/ai';
import LoadingSpinner from '../LoadingSpinner';
import EmptyState from '../EmptyState';
import FileTree from '../FileTree';
import type { ContextMenuEvent } from '../FileTree';
import { FileNode } from '../../types';
import type { ChapterStatus } from '../../utils/chapterWorkspace';
import { CHAPTER_STATUS_LABELS, formatChapterIndex } from '../../utils/chapterWorkspace';
import styles from './styles.module.scss';

interface ChapterListItem {
  path: string;
  title: string;
  order: number;
  directoryLabel: string;
  status: ChapterStatus;
  summary?: string;
  plotNote?: string;
  linkedCharacters: number;
  linkedLore: number;
}

interface FilePanelProps {
  files: FileNode[];
  selectedFile: string | null;
  folderPath: string | null;
  isLoading: boolean;
  onFileSelect: (filePath: string) => void;
  onCreateChapter?: () => void;
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
  onDropFiles?: (filePaths: string[]) => void;
  creatingType?: 'file' | 'directory' | null;
  createTargetPath?: string | null;
  onInlineCreate?: (type: 'file' | 'directory', name: string) => void;
  onCancelCreate?: () => void;
  chapters: ChapterListItem[];
  onBatchCreateChapters?: () => void;
  onChapterReorder?: (sourcePath: string, targetPath: string) => void;
}

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

function filterTree(
  nodes: FileNode[],
  query: string,
  chapterInfoMap?: Map<string, { searchText?: string }>
): FileNode[] {
  const lowerQuery = query.toLowerCase();
  return nodes.reduce<FileNode[]>((acc, node) => {
    if (node.type === 'directory') {
      const filteredChildren = node.children
        ? filterTree(node.children, query, chapterInfoMap)
        : [];
      const nameMatches = node.name.toLowerCase().includes(lowerQuery);
      if (nameMatches || filteredChildren.length > 0) {
        acc.push({
          ...node,
          children: filteredChildren.length > 0 ? filteredChildren : node.children,
        });
      }
    } else {
      const chapterSearchText = chapterInfoMap?.get(node.path)?.searchText || '';
      const haystack = `${node.name} ${chapterSearchText}`.toLowerCase();
      if (haystack.includes(lowerQuery)) {
        acc.push(node);
      }
    }
    return acc;
  }, []);
}

function buildChapterTooltip(chapter: ChapterListItem): string {
  const relationMeta = [
    chapter.linkedCharacters > 0 ? `${chapter.linkedCharacters} 人物` : '',
    chapter.linkedLore > 0 ? `${chapter.linkedLore} 设定` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return [
    `第${formatChapterIndex(chapter.order)}章 ${chapter.title}`,
    `状态：${CHAPTER_STATUS_LABELS[chapter.status]}`,
    `目录：${chapter.directoryLabel}`,
    relationMeta ? `关联：${relationMeta}` : '',
    chapter.summary ? `摘要：${chapter.summary}` : '',
    !chapter.summary && chapter.plotNote ? `备注：${chapter.plotNote}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildChapterSearchText(chapter: ChapterListItem): string {
  return [
    chapter.title,
    chapter.directoryLabel,
    CHAPTER_STATUS_LABELS[chapter.status],
    chapter.summary || '',
    chapter.plotNote || '',
  ]
    .join(' ')
    .trim();
}

const FilePanel: React.FC<FilePanelProps> = React.memo(
  ({
    files,
    selectedFile,
    folderPath,
    isLoading,
    onFileSelect,
    onCreateChapter,
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
    creatingType,
    createTargetPath,
    onInlineCreate,
    onCancelCreate,
    chapters,
    onBatchCreateChapters,
    onChapterReorder,
  }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [revealPath, setRevealPath] = useState<string | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const dragCounterRef = useRef(0);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const createMenuRef = useRef<HTMLDivElement>(null);
    const [showCreateMenu, setShowCreateMenu] = useState(false);

    const handleDragOver = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }, []);

    const handleDragEnter = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      dragCounterRef.current += 1;
      if (dragCounterRef.current === 1) setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback(() => {
      dragCounterRef.current -= 1;
      if (dragCounterRef.current === 0) setIsDragOver(false);
    }, []);

    const handleDrop = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        dragCounterRef.current = 0;
        setIsDragOver(false);
        const droppedFiles = e.dataTransfer.files;
        if (droppedFiles.length === 0) return;
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

    const chapterInfoMap = useMemo(
      () =>
        new Map(
          chapters.map((chapter) => [
            chapter.path,
            {
              status: chapter.status,
              tooltip: buildChapterTooltip(chapter),
              searchText: buildChapterSearchText(chapter),
            },
          ])
        ),
      [chapters]
    );

    const filteredFiles = useMemo(() => {
      if (!searchQuery.trim()) return files;
      return filterTree(files, searchQuery.trim(), chapterInfoMap);
    }, [files, searchQuery, chapterInfoMap]);

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

    const handleFileSelectFromSearch = useCallback(
      (filePath: string) => {
        if (searchQuery.trim()) {
          setSearchQuery('');
          setShowSearch(false);
          setRevealPath(filePath);
          setTimeout(() => setRevealPath(null), 300);
        }
        onFileSelect(filePath);
      },
      [searchQuery, onFileSelect]
    );

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

    useEffect(() => {
      if (!showCreateMenu) return;
      const handlePointerDown = (event: MouseEvent) => {
        if (createMenuRef.current?.contains(event.target as Node)) return;
        setShowCreateMenu(false);
      };
      document.addEventListener('mousedown', handlePointerDown);
      return () => document.removeEventListener('mousedown', handlePointerDown);
    }, [showCreateMenu]);

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
          const node = findNodeByPath(files, selectedFile);
          const targetDir =
            node?.type === 'directory'
              ? selectedFile
              : selectedFile.substring(0, selectedFile.lastIndexOf('/'));
          if (targetDir) onPasteFiles?.(targetDir);
        }
      },
      [selectedFile, files, onCopyFile, onPasteFiles]
    );

    return (
      <div className={styles.filePanel} tabIndex={-1} onKeyDown={handlePanelKeyDown}>
        <div className={styles.explorerHeader}>
          <span className={styles.explorerTitle}>作品目录</span>
          <div className={styles.headerActions}>
            <button
              className={styles.explorerAction}
              onClick={onOpenFolder}
              disabled={isLoading}
              title={folderPath ? '更换文件夹' : '打开文件夹'}
            >
              <AiOutlineFolderOpen />
            </button>
            {folderPath && (
              <button
                className={`${styles.explorerAction} ${showSearch ? styles.active : ''}`}
                onClick={handleToggleSearch}
                title="搜索目录、章节或文件 (Cmd+P)"
              >
                <AiOutlineSearch />
              </button>
            )}
            {onCollapse && (
              <button className={styles.explorerAction} onClick={onCollapse} title="折叠侧边栏">
                ◀
              </button>
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
                    placeholder="搜索目录、章节或文件..."
                  />
                  {searchQuery && (
                    <button className={styles.searchClear} onClick={() => setSearchQuery('')}>
                      ×
                    </button>
                  )}
                </div>
              )}

              <div className={styles.workspaceSection}>
                <div className={styles.workspaceBar}>
                  <span className={styles.workspaceName} title={folderName || undefined}>
                    {folderName}
                  </span>
                  <div className={styles.workspaceTools}>
                    <div className={styles.createMenuWrap} ref={createMenuRef}>
                      <button
                        className={styles.workspaceAction}
                        onClick={() => setShowCreateMenu((prev) => !prev)}
                        title="新建"
                        disabled={isLoading}
                      >
                        <AiOutlinePlus />
                      </button>
                      {showCreateMenu && (
                        <div className={styles.createMenu}>
                          {onCreateChapter && (
                            <button
                              className={styles.createMenuItem}
                              type="button"
                              onClick={() => {
                                setShowCreateMenu(false);
                                onCreateChapter();
                              }}
                            >
                              新建章节
                            </button>
                          )}
                          {onBatchCreateChapters && (
                            <button
                              className={styles.createMenuItem}
                              type="button"
                              onClick={() => {
                                setShowCreateMenu(false);
                                onBatchCreateChapters();
                              }}
                            >
                              批量章节
                            </button>
                          )}
                          <button
                            className={styles.createMenuItem}
                            type="button"
                            onClick={() => {
                              setShowCreateMenu(false);
                              onCreateFile();
                            }}
                          >
                            新建文件
                          </button>
                          <button
                            className={styles.createMenuItem}
                            type="button"
                            onClick={() => {
                              setShowCreateMenu(false);
                              onCreateDirectory();
                            }}
                          >
                            新建目录
                          </button>
                          {onImportFile && (
                            <button
                              className={styles.createMenuItem}
                              type="button"
                              onClick={() => {
                                setShowCreateMenu(false);
                                onImportFile();
                              }}
                            >
                              导入文稿
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      className={styles.workspaceAction}
                      onClick={onRefresh}
                      title="刷新"
                      disabled={isLoading}
                    >
                      <AiOutlineReload />
                    </button>
                    {onImportFile && (
                      <button
                        className={styles.workspaceAction}
                        onClick={onImportFile}
                        title="导入 Word / Excel"
                        disabled={isLoading}
                      >
                        <AiOutlineImport />
                      </button>
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
                  chapterInfoMap={chapterInfoMap}
                  onChapterReorder={onChapterReorder}
                />
              </div>
            </>
          ) : (
            <EmptyState variant="folder" actionText="打开作品文件夹" onAction={onOpenFolder} />
          )}
        </div>
      </div>
    );
  }
);

export default FilePanel;
