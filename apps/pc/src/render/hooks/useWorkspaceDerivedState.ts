import { useMemo } from 'react';
import type { AssistantScopeTarget } from '@/render/app/types';
import type { FileNode } from '@/render/types';
import type { PersistedOutlineScopeInput } from '@/render/types/electron-api';
import {
  findNodeInTree,
  getNodeDisplayName,
  isUntitledTabPath,
  isVolumeLikeName,
} from '@/render/app/fileTreeUtils';
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
import type { WorkspaceState } from './state/useWorkspaceState';
import type { TabsState } from './state/useTabsState';
import type { EntitiesState } from './state/useEntitiesState';

export type UseWorkspaceDerivedStateContext = Pick<WorkspaceState, 'files' | 'folderPath'> &
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
    untitledTabContents,
    workspaceProjectName,
  } = ctx;

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
  const chapterAssistantEnabled = useMemo(
    () => shouldEnableChapterAssistant(activeDocumentTab),
    [activeDocumentTab]
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
    () => splitWorkspaceFiles(files),
    [files]
  );
  const materialFiles = useMemo(
    () => flattenFileNodes(workspaceMaterialNodes),
    [workspaceMaterialNodes]
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
  const rootVolumeNode = useMemo(() => {
    if (!folderPath) return null;
    const looseNodes = workspaceStoryNodes.filter(
      (node) => !(node.type === 'directory' && isVolumeLikeName(node.name))
    );
    if (looseNodes.length === 0) return null;
    return {
      name: '未分卷',
      path: folderPath,
      type: 'directory' as const,
      children: looseNodes,
    };
  }, [folderPath, workspaceStoryNodes]);
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
    if (activeDocumentTab && isStoryFilePath(activeDocumentTab)) {
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
    if (!folderPath) return null;
    return {
      kind: 'project',
      path: folderPath,
      label: workspaceProjectName?.trim() || getNodeDisplayName(folderPath),
    };
  }, [activeDocumentTab, folderPath, selectedVolumeNode, selectedVolumePath, workspaceProjectName]);
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
          node.type === 'file' && isStoryFilePath(node.path)
      ),
    [workspaceStoryNodes]
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
    selectedVolumeNode,
    currentAssistantScope,
    currentOutlineScope,
    storyFileNodes,
  };
}

export type WorkspaceDerivedState = ReturnType<typeof useWorkspaceDerivedState>;
