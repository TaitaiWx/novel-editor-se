import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import {
  AiFillFolder,
  AiOutlineFileText,
  AiOutlineCode,
  AiOutlineFile,
  AiOutlineEdit,
} from 'react-icons/ai';
import { DiJavascript1, DiReact, DiPython, DiHtml5, DiCss3 } from 'react-icons/di';
import { VscJson } from 'react-icons/vsc';
import { AiOutlineFileMarkdown } from 'react-icons/ai';
import type { FileNode, FileInfo, FileInfoBatchEntry } from '../../types';
import { isImeComposing } from '../../utils/ime';
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
  onRenameNode?: (path: string) => void;
  creatingType?: 'file' | 'directory' | null;
  createTargetPath?: string | null;
  onInlineCreate?: (type: 'file' | 'directory', name: string) => void;
  onCancelCreate?: () => void;
  revealPath?: string | null;
}

const getFileIcon = (name: string, type: 'file' | 'directory') => {
  if (type === 'directory') {
    return { icon: <AiFillFolder />, className: 'folder' };
  }

  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js':
      return { icon: <DiJavascript1 />, className: 'js' };
    case 'ts':
      return { icon: <AiOutlineCode />, className: 'ts' };
    case 'jsx':
    case 'tsx':
      return { icon: <DiReact />, className: 'jsx' };
    case 'json':
      return { icon: <VscJson />, className: 'json' };
    case 'md':
      return { icon: <AiOutlineFileMarkdown />, className: 'md' };
    case 'css':
    case 'scss':
      return { icon: <DiCss3 />, className: 'css' };
    case 'html':
      return { icon: <DiHtml5 />, className: 'html' };
    case 'txt':
      return { icon: <AiOutlineFileText />, className: 'txt' };
    case 'py':
      return { icon: <DiPython />, className: 'py' };
    default:
      return { icon: <AiOutlineFile />, className: 'file' };
  }
};

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

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
  onRenameNode?: (path: string) => void;
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

    const handleClick = () => {
      if (node.type === 'directory') {
        onToggleDirectory(node.path);
      } else {
        onFileSelect(node.path);
      }
    };

    const { icon, className } = getFileIcon(node.name, node.type);
    const sortedChildren = useMemo(
      () => (node.children ? sortNodes(node.children) : []),
      [node.children]
    );
    const itemMeta = itemMetaMap?.[node.path];

    return (
      <div className={styles.fileTreeItem}>
        <div
          className={`${styles.itemHeader} ${styles[node.type]} ${isSelected ? styles.selected : ''}`}
          onClick={handleClick}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onContextMenu?.({ x: e.clientX, y: e.clientY, node });
          }}
          style={{ paddingLeft: `${baseIndent + level * 16}px` }}
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
            <span className={styles.itemName}>{node.name}</span>
            {itemMeta && <span className={styles.itemMeta}>{itemMeta}</span>}
          </span>
          {onRenameNode && (
            <button
              type="button"
              className={styles.itemAction}
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
          {showFileSizes && node.type === 'file' && fileInfo && (
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

    window.electron.ipcRenderer
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
