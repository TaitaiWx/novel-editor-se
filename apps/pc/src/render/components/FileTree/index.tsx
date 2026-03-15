import React, { useRef, useEffect, useState, useMemo } from 'react';
import { AiFillFolder, AiOutlineFileText, AiOutlineCode, AiOutlineFile } from 'react-icons/ai';
import { DiJavascript1, DiReact, DiPython, DiHtml5, DiCss3 } from 'react-icons/di';
import { VscJson } from 'react-icons/vsc';
import { AiOutlineFileMarkdown } from 'react-icons/ai';
import type { FileNode, FileInfo } from '../../types';
import styles from './styles.module.scss';

export interface ContextMenuEvent {
  x: number;
  y: number;
  node: FileNode;
}

interface FileTreeProps {
  files: FileNode[];
  onFileSelect: (path: string) => void;
  selectedFile?: string | null;
  onContextMenu?: (event: ContextMenuEvent) => void;
  creatingType?: 'file' | 'directory' | null;
  createTargetPath?: string | null;
  onInlineCreate?: (type: 'file' | 'directory', name: string) => void;
  onCancelCreate?: () => void;
  /** 需要自动展开到的文件路径（搜索定位时使用） */
  revealPath?: string | null;
}

// 获取文件图标
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

// 格式化文件大小
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

// 排序: 目录优先，然后按名称排序
const sortNodes = (nodes: FileNode[]): FileNode[] => {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name, 'zh-CN');
  });
};

// 内联创建输入框
const InlineCreateInput: React.FC<{
  type: 'file' | 'directory';
  onSubmit: (name: string) => void;
  onCancel: () => void;
  level?: number;
}> = ({ type, onSubmit, onCancel, level = 0 }) => {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
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
      <div className={styles.itemHeader} style={{ paddingLeft: `${8 + level * 16}px` }}>
        <span className={`${styles.expandIcon} ${styles.hidden}`}>&#9654;</span>
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
  fileInfoMap?: Map<string, FileInfo>;
  createTargetPath?: string | null;
  creatingType?: 'file' | 'directory' | null;
  onInlineCreate?: (type: 'file' | 'directory', name: string) => void;
  onCancelCreate?: () => void;
  revealPath?: string | null;
}> = React.memo(
  ({
    node,
    onFileSelect,
    selectedFile,
    level = 0,
    onContextMenu,
    fileInfoMap,
    createTargetPath,
    creatingType,
    onInlineCreate,
    onCancelCreate,
    revealPath,
  }) => {
    const [isExpanded, setIsExpanded] = React.useState(false);
    const isSelected = selectedFile === node.path;
    const fileInfo = fileInfoMap?.get(node.path) ?? null;

    // Auto-expand directory if it's the creation target
    const isCreateTarget =
      !!creatingType && node.type === 'directory' && node.path === createTargetPath;

    // Auto-expand directory if revealPath is a descendant
    const isRevealAncestor =
      !!revealPath &&
      node.type === 'directory' &&
      (revealPath.startsWith(node.path + '/') || revealPath.startsWith(node.path + '\\'));

    React.useEffect(() => {
      if (isRevealAncestor) setIsExpanded(true);
    }, [isRevealAncestor]);

    const effectiveExpanded = isExpanded || isCreateTarget;

    const handleClick = () => {
      if (node.type === 'directory') {
        setIsExpanded(!isExpanded);
      } else {
        onFileSelect(node.path);
      }
    };

    const { icon, className } = getFileIcon(node.name, node.type);

    // Memoize sorted children to avoid re-sorting on every render
    const sortedChildren = React.useMemo(
      () => (node.children ? sortNodes(node.children) : []),
      [node.children]
    );

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
          style={{ paddingLeft: `${8 + level * 16}px` }}
        >
          <span
            className={`${styles.expandIcon} ${effectiveExpanded ? styles.expanded : ''} ${
              node.type === 'file' ? styles.hidden : ''
            }`}
          >
            &#9654;
          </span>
          <span className={`${styles.fileIcon} ${styles[className]}`}>{icon}</span>
          <span className={styles.itemName}>{node.name}</span>
          {node.type === 'file' && fileInfo && (
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
                fileInfoMap={fileInfoMap}
                createTargetPath={createTargetPath}
                creatingType={creatingType}
                onInlineCreate={onInlineCreate}
                onCancelCreate={onCancelCreate}
                revealPath={revealPath}
              />
            ))}
          </div>
        )}
      </div>
    );
  }
);

// 递归收集所有文件路径
function collectFilePaths(nodes: FileNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.type === 'file') paths.push(node.path);
    if (node.children) paths.push(...collectFilePaths(node.children));
  }
  return paths;
}

const FileTree: React.FC<FileTreeProps> = ({
  files,
  onFileSelect,
  selectedFile,
  onContextMenu,
  creatingType,
  createTargetPath,
  onInlineCreate,
  onCancelCreate,
  revealPath,
}) => {
  const sortedFiles = useMemo(() => sortNodes(files), [files]);
  const [fileInfoMap, setFileInfoMap] = useState<Map<string, FileInfo>>(new Map());

  // Show inline input at root only when target is root (createTargetPath === null)
  const showCreateAtRoot = !!creatingType && createTargetPath == null;

  // If a root-level file is selected, render the input after it (VS Code behavior)
  const selectedRootPath =
    showCreateAtRoot && selectedFile
      ? (sortedFiles.find((n) => n.path === selectedFile)?.path ?? null)
      : null;

  // 增量获取文件信息（仅请求新增路径，已有路径直接复用）
  useEffect(() => {
    const paths = collectFilePaths(files);
    if (paths.length === 0) {
      setFileInfoMap(new Map());
      return;
    }

    let cancelled = false;

    // 找出尚未获取的路径
    const pathsToFetch = paths.filter((p) => !fileInfoMap.has(p));
    if (pathsToFetch.length === 0) {
      // 只需清理不存在的条目
      const pathSet = new Set(paths);
      setFileInfoMap((prev) => {
        const next = new Map<string, FileInfo>();
        for (const [k, v] of prev) {
          if (pathSet.has(k)) next.set(k, v);
        }
        return next;
      });
      return;
    }

    Promise.allSettled(
      pathsToFetch.map((p) =>
        window.electron.ipcRenderer
          .invoke('get-file-info', p)
          .then((info: FileInfo) => ({ path: p, info }))
      )
    ).then((results) => {
      if (cancelled) return;
      const pathSet = new Set(paths);
      setFileInfoMap((prev) => {
        const next = new Map<string, FileInfo>();
        // 保留仍存在的旧条目
        for (const [k, v] of prev) {
          if (pathSet.has(k)) next.set(k, v);
        }
        // 合入新获取的条目
        for (const r of results) {
          if (r.status === 'fulfilled') {
            next.set(r.value.path, r.value.info);
          }
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [files]);

  return (
    <div className={styles.fileTree}>
      {/* Show at top only if no root-level item is selected */}
      {showCreateAtRoot && !selectedRootPath && onInlineCreate && onCancelCreate && (
        <InlineCreateInput
          type={creatingType}
          onSubmit={(name) => onInlineCreate(creatingType, name)}
          onCancel={onCancelCreate}
        />
      )}
      {sortedFiles.map((file) => (
        <React.Fragment key={file.path}>
          <FileTreeItem
            node={file}
            onFileSelect={onFileSelect}
            selectedFile={selectedFile}
            onContextMenu={onContextMenu}
            fileInfoMap={fileInfoMap}
            createTargetPath={createTargetPath}
            creatingType={creatingType}
            onInlineCreate={onInlineCreate}
            onCancelCreate={onCancelCreate}
            revealPath={revealPath}
          />
          {/* Render input after the selected root-level item */}
          {selectedRootPath === file.path && creatingType && onInlineCreate && onCancelCreate && (
            <InlineCreateInput
              type={creatingType}
              onSubmit={(name) => onInlineCreate(creatingType, name)}
              onCancel={onCancelCreate}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

export default FileTree;
