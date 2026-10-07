import { characterReferenceItems, type ReferenceAutoSource } from '../utils/referencePane';
import {
  characterReferencePaths,
  isSafeMediaPath,
  parseCharacterDesign,
  resolveCover,
} from '@novel-editor/core/entity-media';
import React, { useMemo, lazy } from 'react';
import { DEFAULT_CHARACTER_HIGHLIGHT_COLOR } from '@/render/components/RightPanel/utils';
import {
  WORKSPACE_TAB_CHARACTERS,
  WORKSPACE_TAB_LABELS,
  WORKSPACE_TAB_LORE,
  createCharacterWorkspaceTab,
  createGrowthWorkspaceTab,
  createLoreWorkspaceTab,
  createVolumeWorkspaceTab,
  isGrowthWorkspaceTab,
  parseGrowthWorkspaceTab,
  parseSceneVideoWorkspaceTab,
  parseVolumeWorkspaceTab,
} from '@/render/utils/workspace';
import { findNodeInTree } from '@/render/app/fileTreeUtils';
import InternalDataNotice from '@/render/components/InternalDataNotice';
import { classifyPath } from '@/render/utils/internalData';
import type { WorkspaceDerivedState } from './useWorkspaceDerivedState';
import type { WorkspaceState } from './state/useWorkspaceState';
import type { TabsState } from './state/useTabsState';
import type { EditorState } from './state/useEditorState';
import type { EntitiesState } from './state/useEntitiesState';
import type { WorkspaceCreationApi } from './useWorkspaceCreation';
import type { EditorInteractions } from './useEditorInteractions';
import type { TabActions } from './useTabActions';
import type { WorkspaceEntityActions } from './useWorkspaceEntityActions';
import type { GrowthEntryApi } from './useGrowthEntry';

const CharactersView = lazy(() =>
  import('@/render/components/RightPanel/CharactersView').then((module) => ({
    default: module.CharactersView,
  }))
);
const LoreView = lazy(() =>
  import('@/render/components/RightPanel/LoreView').then((module) => ({ default: module.LoreView }))
);
const VolumeWorkspaceView = lazy(() => import('@/render/components/VolumeWorkspaceView'));
const SceneVideoView = lazy(() => import('@/render/components/SceneVideoView'));
const GrowthView = lazy(() =>
  import('@/render/components/RightPanel/GrowthView').then((module) => ({
    default: module.GrowthView,
  }))
);

export type UseWorkspaceTabContentContext = Pick<
  WorkspaceDerivedState,
  | 'activeWorkspaceTab'
  | 'rootVolumeNode'
  | 'selectedCharacterTabId'
  | 'selectedLoreEntryTabId'
  | 'selectedVolumeNode'
  | 'selectedVolumePath'
> &
  Pick<WorkspaceState, 'dbReady' | 'files' | 'folderPath' | 'storyOrderMap'> &
  Partial<Pick<WorkspaceState, 'workScopePath'>> &
  Partial<Pick<WorkspaceDerivedState, 'activeDocumentTab'>> &
  Partial<Pick<EntitiesState, 'workspaceEntitiesPath'>> &
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
  Partial<Pick<TabActions, 'closeTab'>> &
  Pick<WorkspaceEntityActions, 'syncWorkspaceCharacters' | 'syncWorkspaceLoreEntries'> &
  Partial<Pick<WorkspaceEntityActions, 'handleFileSelect'>> &
  Pick<GrowthEntryApi, 'growthIndex' | 'handleOpenGrowth'> &
  Partial<Pick<GrowthEntryApi, 'growthChapter' | 'handleCreateGrowthSheet'>>;

/**
 * 工作区虚拟标签页（人物 / 设定 / 卷 / 成长档案）的标题与内容
 */
export function useWorkspaceTabContent(ctx: UseWorkspaceTabContentContext) {
  const {
    activeWorkspaceTab,
    closeTab,
    dbReady,
    editorContent,
    files,
    folderPath,
    growthChapter = null,
    growthIndex,
    handleCreateGrowthSheet,
    handleCreateStoryItem,
    handleOpenGrowth,
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
      ...Object.fromEntries(
        openTabs
          .map((tab) => parseGrowthWorkspaceTab(tab))
          .filter((name): name is string => Boolean(name))
          .map((name) => [createGrowthWorkspaceTab(name), `成长 · ${name}`])
      ),
      ...Object.fromEntries(
        openTabs
          .filter((tab) => parseSceneVideoWorkspaceTab(tab))
          .map((tab) => [tab, `视频 · ${parseSceneVideoWorkspaceTab(tab)?.scene ?? ''}`])
      ),
    }),
    [files, folderPath, openTabs, rootVolumeNode, workspaceCharacters, workspaceLoreEntries]
  );

  // 人物详情中的「成长档案」按钮：显示已建档角色的等级
  const growthLevels = useMemo<Record<string, number>>(
    () => Object.fromEntries((growthIndex?.sheets ?? []).map((item) => [item.name, item.level])),
    [growthIndex]
  );
  // 角色 / 设定 / 成长档案标签跟随当前作品（普通文件夹为文件夹本身）
  const scopePath = ctx.workScopePath ?? folderPath;
  const activeGrowthTab = isGrowthWorkspaceTab(activeWorkspaceTab) ? activeWorkspaceTab : null;
  const activeSceneVideo = useMemo(
    () => parseSceneVideoWorkspaceTab(activeWorkspaceTab),
    [activeWorkspaceTab]
  );
  // 场景视频：人物（名字 / 别名 / 头像 / 简介）与设定标题用于预填与提示
  const sceneVideoCharacters = useMemo(
    () =>
      workspaceCharacters.map((item) => {
        // 人物设计里的外貌 / 服装优先（保持各镜头人物一致），没有时用简介；参考图用图集封面
        const design = parseCharacterDesign(item.design);
        const look = [design.appearance, design.outfit].filter(Boolean).join('；');
        const turnaround = item.media?.find((media) => media.kind === 'turnaround')?.path;
        return {
          name: item.name,
          aliases: item.aliases,
          avatar: resolveCover(item.media, item.avatar),
          appearance: look || item.description,
          ...(turnaround ? { turnaround } : {}),
          ...(item.voice ? { voice: item.voice } : {}),
          // 视频参考图只能是作品内的图片文件（旧版 data URL 头像不作参考）
          referencePaths: characterReferencePaths(item.media, item.avatar).filter(isSafeMediaPath),
        };
      }),
    [workspaceCharacters]
  );
  // 文件栏「参考」按钮：窗格还空着时先放当前作品人物的三视图 / 形象图
  const referenceFallback = useMemo(
    () =>
      characterReferenceItems(
        ctx.workspaceEntitiesPath ?? scopePath ?? null,
        sceneVideoCharacters.map((item) => ({
          name: item.name,
          avatar: item.avatar,
          turnaround: item.turnaround,
        }))
      ),
    [ctx.workspaceEntitiesPath, scopePath, sceneVideoCharacters]
  );
  // 「参考」按钮的自动来源：当前文档引用的媒体 + 本章场景视频（从文件树查找）
  const activeDocumentPath = ctx.activeDocumentTab ?? null;
  const referenceWorkPath = ctx.workspaceEntitiesPath ?? scopePath ?? null;
  const referenceSource = useMemo<ReferenceAutoSource>(
    () => ({
      documentPath: activeDocumentPath,
      text: activeDocumentPath ? editorContent : '',
      workPath: referenceWorkPath,
      files,
    }),
    [activeDocumentPath, editorContent, files, referenceWorkPath]
  );
  const sceneVideoLoreTitles = useMemo(
    () => workspaceLoreEntries.map((item) => item.title),
    [workspaceLoreEntries]
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

  // 内部数据（不论从哪里被打开）：不显示原始 JSON，显示「请在 XX 中查看」并一键跳转
  const handleFileSelect = ctx.handleFileSelect;
  const internalDataTab = useMemo(() => {
    const classification = classifyPath(activeDocumentPath, folderPath);
    return classification.kind === 'internal' && activeDocumentPath
      ? { path: activeDocumentPath, owner: classification.owner }
      : null;
  }, [activeDocumentPath, folderPath]);
  const internalDataContent = useMemo<Record<string, React.ReactNode>>(() => {
    if (!internalDataTab) return {};
    const { path, owner } = internalDataTab;
    const canOpen = owner === 'growth' || owner === 'scene-video';
    return {
      [path]: (
        <InternalDataNotice
          owner={owner}
          onOpen={
            canOpen && handleFileSelect
              ? () => {
                  closeTab?.(path);
                  handleFileSelect(path);
                }
              : undefined
          }
        />
      ),
    };
  }, [closeTab, handleFileSelect, internalDataTab]);

  const specialTabContent = useMemo<Record<string, React.ReactNode>>(
    () => ({
      ...internalDataContent,
      [WORKSPACE_TAB_CHARACTERS]: (
        <CharactersView
          key={`characters-root-${scopePath ?? ''}-${workspaceCharactersVersion}`}
          folderPath={scopePath}
          content={editorContent}
          onCharactersChange={syncWorkspaceCharacters}
          onOpenSourceLocation={handleOpenSourceLocation}
          growthLevels={growthLevels}
          onOpenCharacter={(id) => openFileInTab(createCharacterWorkspaceTab({ id }))}
          renderGrowthOverview={() => (
            <GrowthView
              key={`growth-overview-embedded-${scopePath ?? ''}`}
              folderPath={scopePath}
              dbReady={dbReady}
              currentChapter={growthChapter}
              embedded
              onNavigateCharacter={handleOpenGrowth}
              onCreateSheet={
                handleCreateGrowthSheet
                  ? (options) => void handleCreateGrowthSheet(options)
                  : undefined
              }
            />
          )}
        />
      ),
      [WORKSPACE_TAB_LORE]: (
        <LoreView
          key={`lore-root-${scopePath ?? ''}-${workspaceLoreVersion}`}
          folderPath={scopePath}
          content={editorContent}
          onEntriesChange={syncWorkspaceLoreEntries}
        />
      ),
      ...(selectedCharacterTabId
        ? {
            [activeWorkspaceTab as string]: (
              <CharactersView
                key={`character-${selectedCharacterTabId}-${workspaceCharactersVersion}`}
                folderPath={scopePath}
                content={editorContent}
                initialSelectedCharacterId={selectedCharacterTabId}
                onCharactersChange={syncWorkspaceCharacters}
                onOpenSourceLocation={handleOpenSourceLocation}
                growthLevels={growthLevels}
                onOpenGrowthSheet={handleOpenGrowth}
                renderGrowth={(name) => (
                  <GrowthView
                    key={`growth-embedded-${name}-${scopePath ?? ''}`}
                    folderPath={scopePath}
                    dbReady={dbReady}
                    initialCharacter={name}
                    currentChapter={growthChapter}
                    embedded
                    onNavigateCharacter={handleOpenGrowth}
                    onCreateSheet={
                      handleCreateGrowthSheet
                        ? (options) => void handleCreateGrowthSheet(options)
                        : undefined
                    }
                  />
                )}
              />
            ),
          }
        : {}),
      ...(selectedLoreEntryTabId
        ? {
            [activeWorkspaceTab as string]: (
              <LoreView
                key={`lore-${selectedLoreEntryTabId}-${workspaceLoreVersion}`}
                folderPath={scopePath}
                content={editorContent}
                initialEntryId={selectedLoreEntryTabId}
                onEntriesChange={syncWorkspaceLoreEntries}
              />
            ),
          }
        : {}),
      ...(activeGrowthTab
        ? {
            [activeGrowthTab]: (
              <GrowthView
                key={`${activeGrowthTab}-${scopePath ?? ''}`}
                folderPath={scopePath}
                dbReady={dbReady}
                initialCharacter={parseGrowthWorkspaceTab(activeGrowthTab)}
                currentChapter={growthChapter}
                onNavigateCharacter={handleOpenGrowth}
                onCreateSheet={
                  handleCreateGrowthSheet
                    ? (options) => void handleCreateGrowthSheet(options)
                    : undefined
                }
                onSheetDeleted={(name) => {
                  // 先关闭该角色的标签，再打开总览（后设置的活动标签生效）
                  closeTab?.(createGrowthWorkspaceTab(name));
                  handleOpenGrowth(null);
                }}
              />
            ),
          }
        : {}),
      ...(activeSceneVideo && activeWorkspaceTab
        ? {
            [activeWorkspaceTab]: (
              <SceneVideoView
                key={`${activeWorkspaceTab}-${scopePath ?? ''}`}
                tabPath={activeWorkspaceTab}
                chapterPath={activeSceneVideo.chapterPath}
                scene={activeSceneVideo.scene}
                workPath={scopePath}
                dbReady={dbReady}
                characters={sceneVideoCharacters}
                loreTitles={sceneVideoLoreTitles}
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
      internalDataContent,
      activeGrowthTab,
      activeSceneVideo,
      activeWorkspaceTab,
      closeTab,
      dbReady,
      editorContent,
      growthChapter,
      growthLevels,
      handleCreateGrowthSheet,
      openFileInTab,
      handleCreateStoryItem,
      scopePath,
      handleOpenGrowth,
      handleOpenSourceLocation,
      selectedCharacterTabId,
      selectedLoreEntryTabId,
      selectedVolumeNode,
      selectedVolumePath,
      sceneVideoCharacters,
      sceneVideoLoreTitles,
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
    referenceFallback,
    referenceSource,
    specialTabContent,
  };
}

export type WorkspaceTabContentApi = ReturnType<typeof useWorkspaceTabContent>;
