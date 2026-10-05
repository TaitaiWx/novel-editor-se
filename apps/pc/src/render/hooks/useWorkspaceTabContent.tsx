import React, { useMemo, lazy } from 'react';
import { DEFAULT_CHARACTER_HIGHLIGHT_COLOR } from '@/render/components/RightPanel/utils';
import {
  WORKSPACE_TAB_CHARACTERS,
  WORKSPACE_TAB_LABELS,
  WORKSPACE_TAB_LORE,
  createCharacterWorkspaceTab,
  createLoreWorkspaceTab,
  createVolumeWorkspaceTab,
  parseVolumeWorkspaceTab,
} from '@/render/utils/workspace';
import { findNodeInTree } from '@/render/app/fileTreeUtils';
import type { WorkspaceDerivedState } from './useWorkspaceDerivedState';
import type { WorkspaceState } from './state/useWorkspaceState';
import type { TabsState } from './state/useTabsState';
import type { EditorState } from './state/useEditorState';
import type { EntitiesState } from './state/useEntitiesState';
import type { WorkspaceCreationApi } from './useWorkspaceCreation';
import type { EditorInteractions } from './useEditorInteractions';
import type { TabActions } from './useTabActions';
import type { WorkspaceEntityActions } from './useWorkspaceEntityActions';

const CharactersView = lazy(() =>
  import('@/render/components/RightPanel/CharactersView').then((module) => ({
    default: module.CharactersView,
  }))
);
const LoreView = lazy(() =>
  import('@/render/components/RightPanel/LoreView').then((module) => ({ default: module.LoreView }))
);
const VolumeWorkspaceView = lazy(() => import('@/render/components/VolumeWorkspaceView'));

export type UseWorkspaceTabContentContext = Pick<
  WorkspaceDerivedState,
  | 'activeWorkspaceTab'
  | 'rootVolumeNode'
  | 'selectedCharacterTabId'
  | 'selectedLoreEntryTabId'
  | 'selectedVolumeNode'
  | 'selectedVolumePath'
> &
  Pick<WorkspaceState, 'files' | 'folderPath' | 'storyOrderMap'> &
  Pick<TabsState, 'openTabs'> &
  Pick<EditorState, 'editorContent'> &
  Pick<
    EntitiesState,
    | 'workspaceCharacters'
    | 'workspaceCharactersVersion'
    | 'workspaceLoreEntries'
    | 'workspaceLoreVersion'
  > &
  Pick<WorkspaceCreationApi, 'handleCreateStoryItem'> &
  Pick<EditorInteractions, 'handleOpenSourceLocation'> &
  Pick<TabActions, 'openFileInTab'> &
  Pick<WorkspaceEntityActions, 'syncWorkspaceCharacters' | 'syncWorkspaceLoreEntries'>;

/**
 * 工作区虚拟标签页（人物 / 设定 / 卷）的标题与内容
 */
export function useWorkspaceTabContent(ctx: UseWorkspaceTabContentContext) {
  const {
    activeWorkspaceTab,
    editorContent,
    files,
    folderPath,
    handleCreateStoryItem,
    handleOpenSourceLocation,
    openFileInTab,
    openTabs,
    rootVolumeNode,
    selectedCharacterTabId,
    selectedLoreEntryTabId,
    selectedVolumeNode,
    selectedVolumePath,
    storyOrderMap,
    syncWorkspaceCharacters,
    syncWorkspaceLoreEntries,
    workspaceCharacters,
    workspaceCharactersVersion,
    workspaceLoreEntries,
    workspaceLoreVersion,
  } = ctx;

  const workspaceTabLabels = useMemo<Record<string, string>>(
    () => ({
      ...WORKSPACE_TAB_LABELS,
      ...Object.fromEntries(
        workspaceCharacters.map((item) => [createCharacterWorkspaceTab(item), item.name])
      ),
      ...Object.fromEntries(
        workspaceLoreEntries.map((item) => [createLoreWorkspaceTab(item), item.title])
      ),
      ...Object.fromEntries(
        openTabs
          .map((tab) => parseVolumeWorkspaceTab(tab))
          .filter((path): path is string => Boolean(path))
          .map((volumePath) => {
            const node = findNodeInTree(files, volumePath);
            const label =
              node?.name ||
              (rootVolumeNode && folderPath && volumePath === folderPath
                ? rootVolumeNode.name
                : '卷规划');
            return [createVolumeWorkspaceTab(volumePath), label];
          })
      ),
    }),
    [files, folderPath, openTabs, rootVolumeNode, workspaceCharacters, workspaceLoreEntries]
  );

  const editorCharacterHighlights = useMemo(
    () =>
      workspaceCharacters
        .map((item) => ({
          id: item.id,
          name: item.name,
          aliases: item.aliases || [],
          color: item.highlightColor || DEFAULT_CHARACTER_HIGHLIGHT_COLOR,
          highlightFirstMentionOnly: item.highlightFirstMentionOnly !== false,
        }))
        .filter((item) => item.name.trim()),
    [workspaceCharacters]
  );

  const specialTabContent = useMemo<Record<string, React.ReactNode>>(
    () => ({
      [WORKSPACE_TAB_CHARACTERS]: (
        <CharactersView
          key={`characters-root-${workspaceCharactersVersion}`}
          folderPath={folderPath}
          content={editorContent}
          onCharactersChange={syncWorkspaceCharacters}
          onOpenSourceLocation={handleOpenSourceLocation}
        />
      ),
      [WORKSPACE_TAB_LORE]: (
        <LoreView
          key={`lore-root-${workspaceLoreVersion}`}
          folderPath={folderPath}
          content={editorContent}
          onEntriesChange={syncWorkspaceLoreEntries}
        />
      ),
      ...(selectedCharacterTabId
        ? {
            [activeWorkspaceTab as string]: (
              <CharactersView
                key={`character-${selectedCharacterTabId}-${workspaceCharactersVersion}`}
                folderPath={folderPath}
                content={editorContent}
                initialSelectedCharacterId={selectedCharacterTabId}
                onCharactersChange={syncWorkspaceCharacters}
                onOpenSourceLocation={handleOpenSourceLocation}
              />
            ),
          }
        : {}),
      ...(selectedLoreEntryTabId
        ? {
            [activeWorkspaceTab as string]: (
              <LoreView
                key={`lore-${selectedLoreEntryTabId}-${workspaceLoreVersion}`}
                folderPath={folderPath}
                content={editorContent}
                initialEntryId={selectedLoreEntryTabId}
                onEntriesChange={syncWorkspaceLoreEntries}
              />
            ),
          }
        : {}),
      ...(selectedVolumePath && selectedVolumeNode?.type === 'directory'
        ? {
            [activeWorkspaceTab as string]: (
              <VolumeWorkspaceView
                volumePath={selectedVolumePath}
                volumeName={selectedVolumeNode.name}
                volumeNode={selectedVolumeNode}
                storyOrderMap={storyOrderMap}
                onOpenFile={openFileInTab}
                onCreateChapter={() => void handleCreateStoryItem('chapter')}
                onCreateDraftFolder={() => void handleCreateStoryItem('draft-folder')}
                onCreateDraft={() => void handleCreateStoryItem('draft')}
              />
            ),
          }
        : {}),
    }),
    [
      activeWorkspaceTab,
      editorContent,
      folderPath,
      openFileInTab,
      handleCreateStoryItem,
      handleOpenSourceLocation,
      selectedCharacterTabId,
      selectedLoreEntryTabId,
      selectedVolumeNode,
      selectedVolumePath,
      syncWorkspaceCharacters,
      syncWorkspaceLoreEntries,
      storyOrderMap,
      workspaceCharactersVersion,
      workspaceLoreVersion,
    ]
  );

  return {
    workspaceTabLabels,
    editorCharacterHighlights,
    specialTabContent,
  };
}

export type WorkspaceTabContentApi = ReturnType<typeof useWorkspaceTabContent>;
