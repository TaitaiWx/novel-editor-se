import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import InlineRenameInput, { isRenameShortcut } from '../InlineRenameInput';
import type { FileNode, FileInfo, FileInfoBatchEntry } from '../../types';
import { isImeComposing } from '../../utils/ime';
import { buildFileTooltip, describeFileName, formatFileSize } from './fileDisplay';
import { getFileIcon } from './fileIcons';
import styles from './styles.module.scss';

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
}

const sortNodes = (nodes: FileNode[]): FileNode[] => {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name, 'zh-CN');
  });
};

function findAncestorDirectoryPaths(
  nodes: FileNode[],
  targetPath: string,
  ancestors: string[] = []
): string[] {
  for (const node of nodes) {
    if (node.path === targetPath) {
      return node.type === 'directory' ? [...ancestors, node.path] : ancestors;
    }
    if (node.type === 'directory' && node.children) {
      const result = findAncestorDirectoryPaths(node.children, targetPath, [
        ...ancestors,
        node.path,
      ]);
      if (result.length > 0) return result;
    }
  }
  return [];
}

function collectVisibleFilePaths(nodes: FileNode[], expandedDirs: Set<string>): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      paths.push(node.path);
      continue;
    }
    if (node.children && expandedDirs.has(node.path)) {
      paths.push(...collectVisibleFilePaths(sortNodes(node.children), expandedDirs));
    }
  }
  return paths;
}

const InlineCreateInput: React.FC<{
  type: 'file' | 'directory';
  onSubmit: (name: string) => void;
  onCancel: () => void;
  level?: number;
  baseIndent?: number;
  showExpandIcon?: boolean;
}> = ({ type, onSubmit, onCancel, level = 0, baseIndent = 8, showExpandIcon = true }) => {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (isImeComposing(e)) return;
    if (e.key === 'Enter' && value.trim()) {
      submittedRef.current = true;
      onSubmit(value.trim());
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  const handleBlur = () => {
    if (!submittedRef.current) {
      onCancel();
    }
  };

  const iconName = type === 'directory' ? 'folder' : value || 'file.txt';
  const iconType = type === 'directory' ? 'directory' : 'file';
  const { icon, className } = getFileIcon(iconName, iconType);

  return (
    <div className={styles.fileTreeItem}>
      <div className={styles.itemHeader} style={{ paddingLeft: `${baseIndent + level * 16}px` }}>
        {showExpandIcon ? (
          <span className={`${styles.expandIcon} ${styles.hidden}`}>&#9654;</span>
        ) : null}
        <span className={`${styles.fileIcon} ${styles[className]}`}>{icon}</span>
        <input
          ref={inputRef}
          className={styles.inlineInput}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={type === 'file' ? '文件名' : '目录名'}
        />
      </div>
    </div>
  );
};

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
  }) => {
    const isSelected = selectedFile === node.path;
    const fileInfo = fileInfoMap?.get(node.path) ?? null;
    const isCreateTarget =
      !!creatingType && node.type === 'directory' && node.path === createTargetPath;
    const effectiveExpanded =
      node.type === 'directory' && (expandedDirs.has(node.path) || isCreateTarget);

    // 行内重命名：双击名称或选中行按 F2 进入，Enter 提交、Esc 取消、失焦提交
    const [renaming, setRenaming] = useState(false);
    const rowRef = useRef<HTMLDivElement>(null);
    const startRename = (event: React.SyntheticEvent) => {
      if (!onRenameNode) return;
      event.preventDefault();
      event.stopPropagation();
      setRenaming(true);
    };

    const handleClick = () => {
      if (node.type === 'directory') {
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
          ref={rowRef}
          className={`${styles.itemHeader} ${styles[node.type]} ${isSelected ? styles.selected : ''}`}
          tabIndex={0}
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
          title={tooltip}
        >
          {showExpandIcon ? (
            <span
              className={`${styles.expandIcon} ${effectiveExpanded ? styles.expanded : ''} ${
                node.type === 'file' ? styles.hidden : ''
              }`}
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
