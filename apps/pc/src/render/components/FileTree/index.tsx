import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { BsCameraReelsFill } from 'react-icons/bs';
import InlineRenameInput, { isRenameShortcut } from '../InlineRenameInput';
import type { FileNode, FileInfo, FileInfoBatchEntry } from '../../types';
import { isImeComposing } from '../../utils/ime';
import { buildFileTooltip, describeFileName, formatFileSize } from './fileDisplay';
import { getFileIcon } from './fileIcons';
import { NOVEL_EDITOR_PATH_MIME } from '../../utils/referencePane';
import InlineCreateInput from './InlineCreateInput';
import {
  collectVisibleFilePaths,
  findAncestorDirectoryPaths,
  findTreePath,
  sortNodes,
} from './treeUtils';
import styles from './styles.module.scss';

export { findAncestorDirectoryPaths, findTreePath } from './treeUtils';

export interface ContextMenuEvent {
  x: number;
  y: number;
  node: FileNode;
}

interface FileTreeProps {
  files: FileNode[];
  fill?: boolean;
  showFileSizes?: boolean;
  showExpandIcon?: boolean;
  baseIndent?: number;
  itemMetaMap?: Record<string, string>;
  onFileSelect: (path: string) => void;
  selectedFile?: string | null;
  onContextMenu?: (event: ContextMenuEvent) => void;
  onBackgroundContextMenu?: (pos: { x: number; y: number }) => void;
  /** 行内重命名提交（双击名称 / 选中行按 F2）；未提供时不可重命名 */
  onRenameNode?: (path: string, nextName: string) => void;
  creatingType?: 'file' | 'directory' | null;
  createTargetPath?: string | null;
  onInlineCreate?: (type: 'file' | 'directory', name: string) => void;
  onCancelCreate?: () => void;
  revealPath?: string | null;
  /**
   * 外部「在资料中定位」请求：展开全部祖先目录、滚动到该行并高亮一段时间。
   * 树里暂时没有该文件时（新生成的文件、文件树尚未刷新）先调用 onRevealMissing，刷新后继续定位。
   */
  revealRequest?: { path: string; id: string } | null;
  onRevealMissing?: (path: string) => void;
}

/** 定位高亮持续时间（毫秒） */
export const FILE_TREE_REVEAL_HIGHLIGHT_MS = 2400;
/** 树里一直找不到要定位的文件时，最多等待这么久（等待文件树刷新） */
export const FILE_TREE_REVEAL_TIMEOUT_MS = 8000;

const FileTreeItem: React.FC<{
  node: FileNode;
  onFileSelect: (path: string) => void;
  selectedFile?: string | null;
  level?: number;
  onContextMenu?: (event: ContextMenuEvent) => void;
  onRenameNode?: (path: string, nextName: string) => void;
  fileInfoMap?: Map<string, FileInfo>;
  showFileSizes: boolean;
  itemMetaMap?: Record<string, string>;
  expandedDirs: Set<string>;
  onToggleDirectory: (path: string) => void;
  showExpandIcon: boolean;
  baseIndent: number;
  createTargetPath?: string | null;
  creatingType?: 'file' | 'directory' | null;
  onInlineCreate?: (type: 'file' | 'directory', name: string) => void;
  onCancelCreate?: () => void;
  revealedPath?: string | null;
  registerRow?: (path: string, element: HTMLDivElement | null) => void;
}> = React.memo(
  ({
    node,
    onFileSelect,
    selectedFile,
    level = 0,
    onContextMenu,
    onRenameNode,
    fileInfoMap,
    showFileSizes,
    itemMetaMap,
    expandedDirs,
    onToggleDirectory,
    showExpandIcon,
    baseIndent,
    createTargetPath,
    creatingType,
    onInlineCreate,
    onCancelCreate,
    revealedPath,
    registerRow,
  }) => {
    const isSelected = selectedFile === node.path;
    const isRevealed = revealedPath === node.path;
    const fileInfo = fileInfoMap?.get(node.path) ?? null;
    const isCreateTarget =
      !!creatingType && node.type === 'directory' && node.path === createTargetPath;
    const effectiveExpanded =
      node.type === 'directory' && (expandedDirs.has(node.path) || isCreateTarget);

    // 行内重命名：双击名称或选中行按 F2 进入，Enter 提交、Esc 取消、失焦提交
    const [renaming, setRenaming] = useState(false);
    const rowRef = useRef<HTMLDivElement | null>(null);
    const setRowRef = useCallback(
      (element: HTMLDivElement | null) => {
        rowRef.current = element;
        registerRow?.(node.path, element);
      },
      [node.path, registerRow]
    );
    const startRename = (event: React.SyntheticEvent) => {
      if (!onRenameNode) return;
      event.preventDefault();
      event.stopPropagation();
      setRenaming(true);
    };

    // 场景视频目录：分镜状态是内部数据（已隐藏），单击 / Enter 直接打开这一场的画布，箭头仍可展开看成片
    const isSceneVideo = node.type === 'directory' && node.sceneVideo === true;
    const handleClick = () => {
      if (node.type === 'directory' && !isSceneVideo) {
        onToggleDirectory(node.path);
      } else {
        onFileSelect(node.path);
      }
    };

    const isFile = node.type === 'file';
    // 按文件名缓存派生信息（类型、中间省略拆分、是否机器生成），大目录重渲染时不重复计算
    const display = useMemo(
      () => (isFile ? describeFileName(node.name) : null),
      [isFile, node.name]
    );
    const { icon, className } = getFileIcon(node.name, node.type, display?.kind);
    const tooltip = useMemo(
      () => buildFileTooltip(node.name, display ? display.kindLabel : null, fileInfo),
      [display, fileInfo, node.name]
    );
    const sortedChildren = useMemo(
      () => (node.children ? sortNodes(node.children) : []),
      [node.children]
    );
    const itemMeta = itemMetaMap?.[node.path];

    return (
      <div className={`${styles.fileTreeItem} ${isFile ? styles.leaf : ''}`}>
        <div
          ref={setRowRef}
          className={`${styles.itemHeader} ${styles[node.type]} ${isSelected ? styles.selected : ''} ${
            isRevealed ? styles.revealed : ''
          }`}
          data-path={node.path}
          data-revealed={isRevealed ? 'true' : undefined}
          tabIndex={0}
          draggable={isFile && !renaming}
          onDragStart={(event) => {
            if (!isFile) return;
            // 拖到参考窗格等处：携带绝对路径（不设 text/plain，避免拖进正文插入路径文字）
            event.dataTransfer.effectAllowed = 'copy';
            event.dataTransfer.setData(NOVEL_EDITOR_PATH_MIME, node.path);
          }}
          aria-keyshortcuts={onRenameNode ? 'F2' : undefined}
          onClick={handleClick}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget || isImeComposing(event)) return;
            if (isRenameShortcut(event)) {
              startRename(event);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              handleClick();
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onContextMenu?.({ x: e.clientX, y: e.clientY, node });
          }}
          style={{ paddingLeft: `${baseIndent + level * 16}px` }}
          title={isSceneVideo ? `${node.name}\n场景视频 · 单击打开画布` : tooltip}
          data-scene-video={isSceneVideo ? 'true' : undefined}
        >
          {showExpandIcon ? (
            <span
              className={`${styles.expandIcon} ${effectiveExpanded ? styles.expanded : ''} ${
                node.type === 'file' ? styles.hidden : ''
              }`}
              onClick={
                isSceneVideo
                  ? (event) => {
                      // 场景目录的行点击打开画布，箭头单独负责展开 / 收起
                      event.stopPropagation();
                      onToggleDirectory(node.path);
                    }
                  : undefined
              }
            >
              &#9654;
            </span>
          ) : null}
          <span className={`${styles.fileIcon} ${styles[className]}`}>{icon}</span>
          <span className={styles.itemText}>
            {renaming && onRenameNode ? (
              <InlineRenameInput
                initialValue={node.name}
                ariaLabel={`重命名 ${node.name}`}
                selectEnd={
                  isFile && node.name.lastIndexOf('.') > 0 ? node.name.lastIndexOf('.') : undefined
                }
                restoreFocusRef={rowRef}
                onCommit={(nextName) => {
                  setRenaming(false);
                  onRenameNode(node.path, nextName);
                }}
                onCancel={() => setRenaming(false)}
              />
            ) : display?.tail ? (
              // 中间省略：头部可收缩，尾部（主名末尾 + 扩展名）始终可见
              <span
                className={`${styles.itemName} ${styles.itemNameSplit}`}
                onDoubleClick={startRename}
              >
                <span className={styles.itemNameHead}>{display.head}</span>
                <span className={styles.itemNameTail}>{display.tail}</span>
              </span>
            ) : (
              <span className={styles.itemName} onDoubleClick={startRename}>
                {node.name}
              </span>
            )}
            {(itemMeta || display?.machineGenerated) && (
              <span className={styles.itemMeta}>
                {display?.machineGenerated && (
                  <span className={styles.itemKind}>{display.kindLabel}</span>
                )}
                {itemMeta}
              </span>
            )}
          </span>
          {isSceneVideo && !renaming && (
            <span className={styles.sceneBadge}>
              <BsCameraReelsFill aria-hidden="true" />
              场景视频
            </span>
          )}
          {showFileSizes && isFile && fileInfo && (
            <span className={styles.itemSize}>{formatFileSize(fileInfo.size)}</span>
          )}
        </div>
        {node.type === 'directory' && effectiveExpanded && (
          <div className={styles.itemChildren}>
            {isCreateTarget && creatingType && onInlineCreate && onCancelCreate && (
              <InlineCreateInput
                type={creatingType}
                onSubmit={(name) => onInlineCreate(creatingType, name)}
                onCancel={onCancelCreate}
                level={level + 1}
                baseIndent={baseIndent}
                showExpandIcon={showExpandIcon}
              />
            )}
            {sortedChildren.map((child) => (
              <FileTreeItem
                key={child.path}
                node={child}
                onFileSelect={onFileSelect}
                selectedFile={selectedFile}
                level={level + 1}
                onContextMenu={onContextMenu}
                onRenameNode={onRenameNode}
                fileInfoMap={fileInfoMap}
                showFileSizes={showFileSizes}
                itemMetaMap={itemMetaMap}
                expandedDirs={expandedDirs}
                onToggleDirectory={onToggleDirectory}
                showExpandIcon={showExpandIcon}
                baseIndent={baseIndent}
                createTargetPath={createTargetPath}
                creatingType={creatingType}
                onInlineCreate={onInlineCreate}
                onCancelCreate={onCancelCreate}
                revealedPath={revealedPath}
                registerRow={registerRow}
              />
            ))}
          </div>
        )}
      </div>
    );
  }
);

const FileTree: React.FC<FileTreeProps> = ({
  files,
  fill = true,
  showFileSizes = true,
  showExpandIcon = true,
  baseIndent = 8,
  itemMetaMap,
  onFileSelect,
  selectedFile,
  onContextMenu,
  creatingType,
  createTargetPath,
  onInlineCreate,
  onCancelCreate,
  revealPath,
  onBackgroundContextMenu,
  onRenameNode,
  revealRequest,
  onRevealMissing,
}) => {
  const sortedFiles = useMemo(() => sortNodes(files), [files]);
  const [fileInfoMap, setFileInfoMap] = useState<Map<string, FileInfo>>(new Map());
  const fileInfoMapRef = useRef(fileInfoMap);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const showCreateAtRoot = !!creatingType && createTargetPath == null;
  const selectedRootPath =
    showCreateAtRoot && selectedFile
      ? (sortedFiles.find((n) => n.path === selectedFile)?.path ?? null)
      : null;

  useEffect(() => {
    if (!revealPath && !createTargetPath) return;
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (revealPath) {
        findAncestorDirectoryPaths(sortedFiles, revealPath).forEach((path) => next.add(path));
      }
      if (createTargetPath) {
        findAncestorDirectoryPaths(sortedFiles, createTargetPath).forEach((path) => next.add(path));
      }
      return next;
    });
  }, [createTargetPath, revealPath, sortedFiles]);

  // ─── 外部定位请求：展开祖先 → 滚动到行 → 高亮 ───────────────────────
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const registerRow = useCallback((path: string, element: HTMLDivElement | null) => {
    if (element) rowRefs.current.set(path, element);
    else rowRefs.current.delete(path);
  }, []);
  const [revealedPath, setRevealedPath] = useState<string | null>(null);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const pendingRevealRef = useRef<{
    path: string;
    id: string;
    since: number;
    refreshRequested: boolean;
  } | null>(null);
  const onRevealMissingRef = useRef(onRevealMissing);
  onRevealMissingRef.current = onRevealMissing;

  useEffect(() => {
    if (!revealRequest?.path) return;
    pendingRevealRef.current = {
      path: revealRequest.path,
      id: revealRequest.id,
      since: Date.now(),
      refreshRequested: false,
    };
  }, [revealRequest?.id, revealRequest?.path]);

  useEffect(() => {
    const pending = pendingRevealRef.current;
    if (!pending) return;
    const treePath = findTreePath(sortedFiles, pending.path);
    if (treePath) {
      pendingRevealRef.current = null;
      setExpandedDirs((prev) => {
        const ancestors = findAncestorDirectoryPaths(sortedFiles, treePath).filter(
          (path) => path !== treePath
        );
        if (ancestors.every((path) => prev.has(path))) return prev;
        const next = new Set(prev);
        ancestors.forEach((path) => next.add(path));
        return next;
      });
      setScrollTarget(treePath);
      return;
    }
    if (Date.now() - pending.since > FILE_TREE_REVEAL_TIMEOUT_MS) {
      pendingRevealRef.current = null;
      return;
    }
    // 文件树里还没有（例如刚生成的成片）：请求刷新一次，刷新后 sortedFiles 变化会再次进入这里
    if (!pending.refreshRequested) {
      pending.refreshRequested = true;
      onRevealMissingRef.current?.(pending.path);
    }
  }, [revealRequest?.id, sortedFiles]);

  useEffect(() => {
    if (!scrollTarget) return;
    let innerFrame = 0;
    const outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => {
        const row = rowRefs.current.get(scrollTarget);
        if (!row) return;
        row.scrollIntoView?.({ block: 'center', inline: 'nearest' });
        row.focus({ preventScroll: true });
        setRevealedPath(scrollTarget);
        setScrollTarget(null);
      });
    });
    return () => {
      window.cancelAnimationFrame(outerFrame);
      window.cancelAnimationFrame(innerFrame);
    };
  }, [expandedDirs, scrollTarget]);

  useEffect(() => {
    if (!revealedPath) return;
    const timer = window.setTimeout(() => setRevealedPath(null), FILE_TREE_REVEAL_HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [revealedPath]);

  const visibleFilePaths = useMemo(
    () => (showFileSizes ? collectVisibleFilePaths(sortedFiles, expandedDirs) : []),
    [expandedDirs, showFileSizes, sortedFiles]
  );

  useEffect(() => {
    fileInfoMapRef.current = fileInfoMap;
  }, [fileInfoMap]);

  useEffect(() => {
    if (!showFileSizes) {
      setFileInfoMap((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }

    if (visibleFilePaths.length === 0) {
      setFileInfoMap((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }

    let cancelled = false;
    const pathsToFetch = visibleFilePaths.filter((path) => !fileInfoMapRef.current.has(path));
    const visiblePathSet = new Set(visibleFilePaths);

    if (pathsToFetch.length === 0) {
      setFileInfoMap((prev) => {
        let changed = false;
        const next = new Map<string, FileInfo>();
        for (const [key, value] of prev) {
          if (visiblePathSet.has(key)) {
            next.set(key, value);
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      return;
    }

    // 预览 / 测试环境可能没有 preload 注入的 IPC，直接跳过文件信息读取
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    ipc
      .invoke('get-file-info-batch', pathsToFetch)
      .then((entries: FileInfoBatchEntry[]) => {
        if (cancelled) return;
        setFileInfoMap((prev) => {
          let changed = false;
          const next = new Map<string, FileInfo>();
          for (const [key, value] of prev) {
            if (visiblePathSet.has(key)) {
              next.set(key, value);
            } else {
              changed = true;
            }
          }
          for (const entry of entries) {
            if (next.get(entry.path) !== entry.info) {
              changed = true;
            }
            next.set(entry.path, entry.info);
          }
          return changed ? next : prev;
        });
      })
      .catch(() => {
        if (cancelled) return;
      });

    return () => {
      cancelled = true;
    };
  }, [showFileSizes, visibleFilePaths]);

  const handleToggleDirectory = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  return (
    <div
      className={`${styles.fileTree} ${fill ? styles.fill : ''}`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onBackgroundContextMenu?.({ x: e.clientX, y: e.clientY });
      }}
    >
      {showCreateAtRoot && !selectedRootPath && onInlineCreate && onCancelCreate && (
        <InlineCreateInput
          type={creatingType}
          onSubmit={(name) => onInlineCreate(creatingType, name)}
          onCancel={onCancelCreate}
          baseIndent={baseIndent}
          showExpandIcon={showExpandIcon}
        />
      )}
      {sortedFiles.map((file) => (
        <React.Fragment key={file.path}>
          <FileTreeItem
            node={file}
            onFileSelect={onFileSelect}
            selectedFile={selectedFile}
            onContextMenu={onContextMenu}
            onRenameNode={onRenameNode}
            fileInfoMap={fileInfoMap}
            showFileSizes={showFileSizes}
            itemMetaMap={itemMetaMap}
            expandedDirs={expandedDirs}
            onToggleDirectory={handleToggleDirectory}
            showExpandIcon={showExpandIcon}
            baseIndent={baseIndent}
            createTargetPath={createTargetPath}
            creatingType={creatingType}
            onInlineCreate={onInlineCreate}
            onCancelCreate={onCancelCreate}
            revealedPath={revealedPath}
            registerRow={registerRow}
          />
          {selectedRootPath === file.path && creatingType && onInlineCreate && onCancelCreate && (
            <InlineCreateInput
              type={creatingType}
              onSubmit={(name) => onInlineCreate(creatingType, name)}
              onCancel={onCancelCreate}
              baseIndent={baseIndent}
              showExpandIcon={showExpandIcon}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

export default FileTree;
