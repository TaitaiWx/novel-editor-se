import { useMemo } from 'react';
import type { FileNode, WorkspaceProjectLayout } from '../../../types';
import type { StoryDisplayNode } from '../../../utils/storyStructure';
import {
  listWorkScopeOptions,
  resolveWorkScope,
  selectWorkScopeNodes,
  type WorkScopeOption,
} from '../../../utils/workScope';

function countChapters(node: StoryDisplayNode): number {
  if (node.type === 'file') return node.storyKind === 'document' ? 0 : 1;
  return (node.children ?? []).reduce((sum, child) => sum + countChapters(child), 0);
}

interface UseWorkScopedNodesOptions {
  folderPath: string | null;
  projectLayout: WorkspaceProjectLayout | null;
  /** 未提供时按项目结构取第一部作品（普通文件夹为文件夹本身） */
  workScope: WorkScopeOption | null | undefined;
  workScopeOptions: WorkScopeOption[] | undefined;
  storyDisplayNodes: StoryDisplayNode[];
  materialNodes: FileNode[];
  /** 正在搜索时跨作品显示全部结果 */
  searching: boolean;
}

/**
 * 「资料」分区标题已经说明了位置：只有一个「资料」根目录时直接展示其中内容，
 * 避免「资料 › 资料 › 素材」这样重复的一层
 */
export function unwrapMaterialRoot<T extends FileNode>(nodes: T[]): T[] {
  if (nodes.length !== 1) return nodes;
  const [root] = nodes;
  if (root.type !== 'directory' || root.name !== '资料') return nodes;
  return (root.children ?? []) as T[];
}

/**
 * 文件面板按当前作品筛选「正文 / 资料」：项目模式下只显示当前作品的卷 / 章与 `资料/`，
 * 「未归属」显示不属于任何作品的内容；普通文件夹显示全部。
 */
export function useWorkScopedNodes({
  folderPath,
  projectLayout,
  workScope: workScopeProp,
  workScopeOptions: workScopeOptionsProp,
  storyDisplayNodes,
  materialNodes,
  searching,
}: UseWorkScopedNodesOptions) {
  const workScopeOptions = useMemo(
    () => workScopeOptionsProp ?? listWorkScopeOptions(folderPath, projectLayout),
    [folderPath, projectLayout, workScopeOptionsProp]
  );
  const workScope =
    workScopeProp === undefined ? resolveWorkScope(workScopeOptions, null) : workScopeProp;
  const isProjectMode = Boolean(projectLayout) && workScope !== null && workScope.kind !== 'folder';
  const scopeToWork = isProjectMode && !searching;
  const scopedStoryNodes = useMemo(
    () =>
      scopeToWork
        ? selectWorkScopeNodes(storyDisplayNodes, workScope, projectLayout)
        : storyDisplayNodes,
    [projectLayout, scopeToWork, storyDisplayNodes, workScope]
  );
  const scopedMaterialNodes = useMemo(
    () =>
      unwrapMaterialRoot(
        scopeToWork ? selectWorkScopeNodes(materialNodes, workScope, projectLayout) : materialNodes
      ),
    [materialNodes, projectLayout, scopeToWork, workScope]
  );
  const workChapterCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    storyDisplayNodes.forEach((node) => {
      if (node.storyKind === 'work') counts[node.path] = countChapters(node);
    });
    return counts;
  }, [storyDisplayNodes]);
  // 正文分区顶层节点的父目录（拖拽排序用）：当前作品目录，否则项目根
  const storyParentPath =
    scopeToWork && workScope?.kind === 'work' ? workScope.path : folderPath || null;

  return {
    workScope,
    workScopeOptions,
    isProjectMode,
    scopeToWork,
    scopedStoryNodes,
    scopedMaterialNodes,
    workChapterCounts,
    storyParentPath,
  };
}
