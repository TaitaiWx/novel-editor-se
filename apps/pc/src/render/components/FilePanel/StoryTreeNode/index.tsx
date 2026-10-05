import React from 'react';
import { AiOutlineEdit } from 'react-icons/ai';
import type { ContextMenuEvent } from '../../FileTree';
import type { FileNode } from '../../../types';
import { createVolumeWorkspaceTab, stripStoryFileExtension } from '../../../utils/workspace';
import { countStoryStats } from '../utils';
import type { ObjectContextMenuTarget, StoryDropMode, StoryDropTarget } from '../types';
import { getStoryDirectoryMeta, getStoryFileMeta } from './storyMeta';
import styles from './styles.module.scss';

/** 正文树递归渲染时共享的上下文（由 FilePanel 统一下发） */
export interface StoryTreeContext {
  expandedStoryDirs: Set<string>;
  revealPath: string | null;
  folderPath: string | null;
  activeWorkspaceTab?: string | null;
  selectedFile: string | null;
  storyDropTarget: StoryDropTarget | null;
  canReorder: boolean;
  registerNodeRef: (path: string, element: HTMLDivElement | null) => void;
  onToggleDirectory: (path: string) => void;
  onSelectFile: (path: string) => void;
  onRenameNode: (path: string) => void;
  onRowKeyDown: (event: React.KeyboardEvent, onActivate: () => void) => void;
  onDragStart: (event: React.DragEvent, sourcePath: string, parentPath: string) => void;
  onDragOver: (
    event: React.DragEvent,
    targetPath: string,
    parentPath: string,
    allowsInside: boolean
  ) => void;
  onDrop: (
    event: React.DragEvent,
    targetPath: string,
    parentPath: string,
    mode: StoryDropMode
  ) => void;
  onDragEnd: () => void;
  onContextMenu?: (event: ContextMenuEvent) => void;
  onObjectContextMenu: (event: React.MouseEvent, target: ObjectContextMenuTarget) => void;
}

interface StoryTreeNodeProps {
  node: FileNode;
  level?: number;
  parentPath?: string | null;
  tree: StoryTreeContext;
}

const groupRowClassName = `${styles.storyNodeButton} ${styles.storyNodeButtonGroup}`;
const itemRowClassName = `${styles.storyNodeButton} ${styles.storyNodeButtonLeaf}`;

/** 正文树节点（卷 / 正文夹 / 稿夹 / 章 / 稿），目录节点递归渲染子节点 */
const StoryTreeNode: React.FC<StoryTreeNodeProps> = ({
  node,
  level = 0,
  parentPath = null,
  tree,
}) => {
  const {
    expandedStoryDirs,
    revealPath,
    folderPath,
    activeWorkspaceTab,
    selectedFile,
    storyDropTarget,
    canReorder,
    registerNodeRef,
    onToggleDirectory,
    onSelectFile,
    onRenameNode,
    onRowKeyDown,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    onContextMenu,
    onObjectContextMenu,
  } = tree;

  if (node.type === 'directory') {
    const expanded = expandedStoryDirs.has(node.path);
    const isRevealedNode = revealPath === node.path;
    const directoryMeta = getStoryDirectoryMeta(node.name);
    const directoryTypeClass =
      directoryMeta.label === '卷'
        ? styles.storyNodeTypeVolume
        : directoryMeta.label === '稿夹'
          ? styles.storyNodeTypeDraftFolder
          : styles.storyNodeTypeGroup;
    const volumeTabPath = createVolumeWorkspaceTab(node.path);
    const isVolumeNode = directoryMeta.label === '卷';
    const isSyntheticVolume = isVolumeNode && folderPath === node.path && node.name === '未分卷';
    const isActiveVolume = isVolumeNode && activeWorkspaceTab === volumeTabPath;
    const storyStats = isVolumeNode ? countStoryStats(node) : null;
    const isReorderableDirectory =
      Boolean(parentPath) && !isVolumeNode && !isSyntheticVolume && canReorder;
    const currentDropMode = storyDropTarget?.path === node.path ? storyDropTarget.mode : null;

    return (
      <div className={styles.storyNode}>
        <div className={styles.storyNodeRow} style={{ paddingLeft: `${14 + level * 16}px` }}>
          <div
            ref={(element) => registerNodeRef(node.path, element)}
            role="button"
            tabIndex={0}
            aria-expanded={expanded}
            draggable={isReorderableDirectory}
            className={`${groupRowClassName} ${
              isActiveVolume ? styles.storyNodeButtonActive : ''
            } ${isRevealedNode ? styles.storyNodeButtonReveal : ''} ${
              currentDropMode === 'inside'
                ? styles.storyNodeDropTargetInside
                : currentDropMode === 'before'
                  ? styles.storyNodeDropTargetBefore
                  : currentDropMode === 'after'
                    ? styles.storyNodeDropTargetAfter
                    : ''
            }`}
            onClick={() => onToggleDirectory(node.path)}
            onKeyDown={(event) => onRowKeyDown(event, () => onToggleDirectory(node.path))}
            onDragStart={(event) =>
              parentPath ? onDragStart(event, node.path, parentPath) : undefined
            }
            onDragOver={(event) =>
              parentPath ? onDragOver(event, node.path, parentPath, true) : undefined
            }
            onDrop={(event) =>
              parentPath && currentDropMode
                ? onDrop(event, node.path, parentPath, currentDropMode)
                : undefined
            }
            onDragEnd={onDragEnd}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (isVolumeNode) {
                onObjectContextMenu(event, {
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
          node.children?.map((child) => (
            <StoryTreeNode
              key={child.path}
              node={child}
              level={level + 1}
              parentPath={node.path}
              tree={tree}
            />
          ))}
      </div>
    );
  }

  const isSelectedChapter = selectedFile === node.path;
  const isRevealedNode = revealPath === node.path;
  const fileMeta = getStoryFileMeta(node.name);
  const fileTypeClass =
    fileMeta.label === '章' ? styles.storyNodeTypeChapter : styles.storyNodeTypeDraft;
  const currentDropMode = storyDropTarget?.path === node.path ? storyDropTarget.mode : null;
  const displayName = stripStoryFileExtension(node.name);

  return (
    <div className={styles.storyNode}>
      <div
        ref={(element) => registerNodeRef(node.path, element)}
        role="button"
        tabIndex={0}
        draggable={Boolean(parentPath && canReorder)}
        className={`${itemRowClassName} ${
          isSelectedChapter ? styles.storyNodeButtonActive : ''
        } ${isRevealedNode ? styles.storyNodeButtonReveal : ''} ${
          currentDropMode === 'before'
            ? styles.storyNodeDropTargetBefore
            : currentDropMode === 'after'
              ? styles.storyNodeDropTargetAfter
              : ''
        }`}
        style={{ marginLeft: `${22 + level * 16}px`, marginRight: '12px' }}
        onClick={() => onSelectFile(node.path)}
        onKeyDown={(event) => onRowKeyDown(event, () => onSelectFile(node.path))}
        onDragStart={(event) =>
          parentPath ? onDragStart(event, node.path, parentPath) : undefined
        }
        onDragOver={(event) =>
          parentPath ? onDragOver(event, node.path, parentPath, false) : undefined
        }
        onDrop={(event) =>
          parentPath && currentDropMode
            ? onDrop(event, node.path, parentPath, currentDropMode)
            : undefined
        }
        onDragEnd={onDragEnd}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onContextMenu?.({ x: event.clientX, y: event.clientY, node });
        }}
      >
        <span className={styles.storyNodeIcon}>{fileMeta.icon}</span>
        <span className={`${styles.storyNodeType} ${fileTypeClass}`}>{fileMeta.label}</span>
        <span className={styles.storyNodePrimary}>
          <span className={styles.storyNodeTitle}>{displayName}</span>
          <button
            type="button"
            className={styles.storyNodeAction}
            onClick={(event) => {
              event.stopPropagation();
              onRenameNode(node.path);
            }}
            aria-label={`修改 ${displayName}`}
            title={`修改 ${displayName}`}
          >
            <AiOutlineEdit />
          </button>
        </span>
      </div>
    </div>
  );
};

export default StoryTreeNode;
