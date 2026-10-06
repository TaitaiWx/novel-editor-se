import { useCallback, useMemo } from 'react';
import type { AssistantScopeTarget } from '@/render/app/types';
import type { FileNode } from '@/render/types';
import type { PersistedOutlineScopeInput } from '@/render/types/electron-api';
import { findNodeInTree, getNodeDisplayName, isUntitledTabPath } from '@/render/app/fileTreeUtils';
import {
  buildStoryStructure,
  getProjectDocPathSet,
  getSplitWorkspaceOptions,
} from '@/render/utils/storyStructure';
import {
  flattenFileNodes,
  isStoryFilePath,
  isWorkspaceTab,
  parseCharacterWorkspaceTab,
  parseLoreWorkspaceTab,
  parseVolumeWorkspaceTab,
  shouldEnableChapterAssistant,
  splitWorkspaceFiles,
} from '@/render/utils/workspace';
import { selectWorkScopeNodes } from '@/render/utils/workScope';
import type { WorkspaceState } from './state/useWorkspaceState';
import type { TabsState } from './state/useTabsState';
import type { EntitiesState } from './state/useEntitiesState';

export type UseWorkspaceDerivedStateContext = Pick<
  WorkspaceState,
  'files' | 'folderPath' | 'projectLayout' | 'workScope' | 'workScopePath'
> &
  Pick<TabsState, 'activeTab' | 'untitledTabContents'> &
  Pick<EntitiesState, 'chapterMaterialPaths' | 'workspaceProjectName'>;

/**
 * 基于当前 tab / 文件树计算的派生状态（纯 memo，无副作用）
 */
export function useWorkspaceDerivedState(ctx: UseWorkspaceDerivedStateContext) {
  const {
    activeTab,
    chapterMaterialPaths,
    files,
    folderPath,
    projectLayout,
    untitledTabContents,
    workScope = null,
    workspaceProjectName,
  } = ctx;
  const workScopePath = ctx.workScopePath ?? folderPath;

  const activeWorkspaceTab = useMemo(
    () => (isWorkspaceTab(activeTab) ? activeTab : null),
    [activeTab]
  );
  const activeUntitledVirtualContent = useMemo(() => {
    if (!activeTab || !isUntitledTabPath(activeTab)) return undefined;
    return untitledTabContents[activeTab] ?? '';
  }, [activeTab, untitledTabContents]);
  const activeDocumentTab = useMemo(
    () => (isWorkspaceTab(activeTab) ? null : activeTab),
    [activeTab]
  );
  const selectedCharacterTabId = useMemo(
    () => parseCharacterWorkspaceTab(activeWorkspaceTab),
    [activeWorkspaceTab]
  );
  const selectedLoreEntryTabId = useMemo(
    () => parseLoreWorkspaceTab(activeWorkspaceTab),
    [activeWorkspaceTab]
  );
  const selectedVolumePath = useMemo(
    () => parseVolumeWorkspaceTab(activeWorkspaceTab),
    [activeWorkspaceTab]
  );
  const { storyNodes: workspaceStoryNodes, materialNodes: workspaceMaterialNodes } = useMemo(
    () => splitWorkspaceFiles(files, getSplitWorkspaceOptions(projectLayout)),
    [files, projectLayout]
  );
  const storyStructure = useMemo(
    () => buildStoryStructure(workspaceStoryNodes, folderPath, projectLayout),
    [folderPath, projectLayout, workspaceStoryNodes]
  );
  // 项目文档（欢迎使用.md、README.md 等）不是章节：不启用章节助手、不计入正文统计
  const projectDocPaths = useMemo(() => getProjectDocPathSet(storyStructure), [storyStructure]);
  const isChapterDocument = useCallback(
    (path: string | null) =>
      Boolean(path) && !projectDocPaths.has(path as string) && isStoryFilePath(path, folderPath),
    [folderPath, projectDocPaths]
  );
  const chapterAssistantEnabled = useMemo(
    () =>
      shouldEnableChapterAssistant(activeDocumentTab, folderPath) &&
      !(activeDocumentTab && projectDocPaths.has(activeDocumentTab)),
    [activeDocumentTab, folderPath, projectDocPaths]
  );
  // 可关联到章节的资料：只列当前作品的资料（资料跟随作品）
  const materialFiles = useMemo(
    () => flattenFileNodes(selectWorkScopeNodes(workspaceMaterialNodes, workScope, projectLayout)),
    [projectLayout, workScope, workspaceMaterialNodes]
  );
  const materialFileMap = useMemo(
    () => new Map(materialFiles.map((item) => [item.path, item])),
    [materialFiles]
  );
  const linkedMaterialFiles = useMemo(
    () =>
      chapterMaterialPaths.map((path) => materialFileMap.get(path)).filter(Boolean) as FileNode[],
    [chapterMaterialPaths, materialFileMap]
  );
  const rootVolumeNode = storyStructure.unassignedNode;
  const selectedVolumeNode = useMemo(() => {
    if (!selectedVolumePath) return null;
    const existingNode = findNodeInTree(files, selectedVolumePath);
    if (existingNode?.type === 'directory') return existingNode;
    if (rootVolumeNode && folderPath && selectedVolumePath === folderPath) {
      return rootVolumeNode;
    }
    return null;
  }, [files, folderPath, rootVolumeNode, selectedVolumePath]);
  const currentAssistantScope = useMemo<AssistantScopeTarget | null>(() => {
    if (activeDocumentTab && isChapterDocument(activeDocumentTab)) {
      return {
        kind: 'chapter',
        path: activeDocumentTab,
        label: getNodeDisplayName(activeDocumentTab),
      };
    }
    if (selectedVolumePath) {
      const label = selectedVolumeNode?.name || getNodeDisplayName(selectedVolumePath);
      return {
        kind: 'volume',
        path: selectedVolumePath,
        label,
      };
    }
    if (!folderPath || !workScopePath) return null;
    // 作品级作用域：ne 项目中是当前作品（大纲、资料上下文跟随作品），普通文件夹是文件夹本身
    return {
      kind: 'project',
      path: workScopePath,
      label:
        workScope?.kind === 'work'
          ? workScope.name
          : workspaceProjectName?.trim() || getNodeDisplayName(folderPath),
    };
  }, [
    activeDocumentTab,
    folderPath,
    isChapterDocument,
    selectedVolumeNode,
    selectedVolumePath,
    workScope,
    workScopePath,
    workspaceProjectName,
  ]);
  const currentOutlineScope = useMemo<PersistedOutlineScopeInput | null>(() => {
    if (!currentAssistantScope) return null;
    return {
      kind: currentAssistantScope.kind,
      path: currentAssistantScope.path,
    };
  }, [currentAssistantScope]);
  const storyFileNodes = useMemo(
    () =>
      flattenFileNodes(workspaceStoryNodes).filter(
        (node): node is FileNode & { type: 'file' } =>
          node.type === 'file' && isChapterDocument(node.path)
      ),
    [isChapterDocument, workspaceStoryNodes]
  );

  return {
    activeWorkspaceTab,
    activeUntitledVirtualContent,
    activeDocumentTab,
    chapterAssistantEnabled,
    selectedCharacterTabId,
    selectedLoreEntryTabId,
    selectedVolumePath,
    workspaceStoryNodes,
    workspaceMaterialNodes,
    materialFiles,
    materialFileMap,
    linkedMaterialFiles,
    rootVolumeNode,
    storyStructure,
    projectDocPaths,
    selectedVolumeNode,
    currentAssistantScope,
    currentOutlineScope,
    storyFileNodes,
  };
}

export type WorkspaceDerivedState = ReturnType<typeof useWorkspaceDerivedState>;
