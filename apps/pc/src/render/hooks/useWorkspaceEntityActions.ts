import { useCallback } from 'react';
import {
  isSceneStoryboardFile,
  sceneVideoTargetFromStoryboard,
} from '@/render/components/SceneVideoView/events';
import type { AssistantScopeTarget } from '@/render/app/types';
import type { Character, LoreEntry } from '@/render/components/RightPanel/types';
import type { FileNode } from '@/render/types';
import {
  WORKSPACE_TAB_CHARACTERS,
  WORKSPACE_TAB_LORE,
  createCharacterWorkspaceTab,
  createLoreWorkspaceTab,
  createSceneVideoWorkspaceTab,
  createVolumeWorkspaceTab,
} from '@/render/utils/workspace';
import { areCharactersEqual, areLoreEntriesEqual } from '@/render/app/entityEquality';
import {
  createGraphLayoutStorageKey,
  createRelationStorageKey,
  stringifyCharacterAttributes,
} from '@/render/components/RightPanel/utils';
import { findNodeInTree, getNodeDisplayName } from '@/render/app/fileTreeUtils';
import type { WorkspaceState } from './state/useWorkspaceState';
import type { TabsState } from './state/useTabsState';
import type { EntitiesState } from './state/useEntitiesState';
import type { UiState } from './state/useUiState';
import type { TabActions } from './useTabActions';
import type { WorkspaceCreationApi } from './useWorkspaceCreation';

export type UseWorkspaceEntityActionsContext = Pick<
  WorkspaceState,
  'filesRef' | 'folderPathRef' | 'workScope' | 'workScopePathRef'
> &
  Pick<TabsState, 'activeTabRef' | 'setActiveTab' | 'setOpenTabs'> &
  Pick<
    EntitiesState,
    | 'bumpWorkspaceCharactersVersion'
    | 'bumpWorkspaceLoreVersion'
    | 'setWorkspaceCharacters'
    | 'setWorkspaceLoreEntries'
    | 'setWorkspaceProjectName'
    | 'workspaceCharacters'
    | 'workspaceLoreEntries'
    | 'workspaceProjectName'
  > &
  Pick<UiState, 'dialog' | 'toast'> &
  Pick<TabActions, 'closeTabsByPredicate' | 'openFileInTab'> &
  Pick<WorkspaceCreationApi, 'getCurrentNovelId'>;

/**
 * 工作区对象（人物、设定、卷、作品名）的导航、重命名、删除与清空
 */
export function useWorkspaceEntityActions(ctx: UseWorkspaceEntityActionsContext) {
  const {
    activeTabRef,
    bumpWorkspaceCharactersVersion,
    bumpWorkspaceLoreVersion,
    closeTabsByPredicate,
    dialog,
    filesRef,
    folderPathRef,
    getCurrentNovelId,
    workScope,
    workScopePathRef,
    openFileInTab,
    setActiveTab,
    setOpenTabs,
    setWorkspaceCharacters,
    setWorkspaceLoreEntries,
    setWorkspaceProjectName,
    toast,
    workspaceCharacters,
    workspaceLoreEntries,
    workspaceProjectName,
  } = ctx;

  const handleFileSelect = useCallback(
    (filePath: string) => {
      // 资料里的「分镜.json」是场景视频的画布：直接打开画布，而不是显示 JSON
      if (isSceneStoryboardFile(filePath)) {
        const ipc = window.electron?.ipcRenderer;
        void (ipc ? ipc.invoke('read-file', filePath) : Promise.resolve(''))
          .catch(() => '')
          .then((raw) => {
            const target = sceneVideoTargetFromStoryboard(String(raw ?? ''));
            openFileInTab(target ? createSceneVideoWorkspaceTab(target) : filePath);
          });
        return;
      }
      openFileInTab(filePath);
    },
    [openFileInTab]
  );
  const handleOpenCharacters = useCallback(() => {
    openFileInTab(WORKSPACE_TAB_CHARACTERS);
  }, [openFileInTab]);
  const handleOpenLore = useCallback(() => {
    openFileInTab(WORKSPACE_TAB_LORE);
  }, [openFileInTab]);
  const handleOpenCharacterNode = useCallback(
    (characterId: number) => {
      openFileInTab(createCharacterWorkspaceTab({ id: characterId }));
    },
    [openFileInTab]
  );
  const handleOpenLoreNode = useCallback(
    (entryId: number) => {
      openFileInTab(createLoreWorkspaceTab({ id: entryId }));
    },
    [openFileInTab]
  );

  /** 修改作品名：传入 nextName（行内重命名）时直接提交，否则弹出输入框 */
  const handleRenameProject = useCallback(
    async (inlineName?: string) => {
      const ipc = window.electron?.ipcRenderer;
      const folder = folderPathRef.current;
      if (!ipc || !folder) return;
      const novel = (await ipc.invoke('db-novel-get-by-folder', folder)) as {
        id: number;
        name?: string | null;
      } | null;
      if (!novel?.id) return;
      const currentName = (
        workspaceProjectName ||
        novel.name ||
        folder.split('/').pop() ||
        ''
      ).trim();
      const nextName =
        inlineName ?? (await dialog.prompt('修改作品名', '请输入新的作品名', currentName));
      if (!nextName?.trim() || nextName.trim() === currentName) return;

      try {
        await ipc.invoke('db-novel-update', novel.id, { name: nextName.trim() });
        setWorkspaceProjectName(nextName.trim());
        toast.success('作品名已更新');
      } catch (error) {
        toast.error(`修改作品名失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [dialog, folderPathRef, setWorkspaceProjectName, toast, workspaceProjectName]
  );

  const syncWorkspaceCharacters = useCallback(
    (nextCharacters: Character[]) => {
      setWorkspaceCharacters((prev) =>
        areCharactersEqual(prev, nextCharacters) ? prev : nextCharacters
      );
    },
    [setWorkspaceCharacters]
  );

  const syncWorkspaceLoreEntries = useCallback(
    (nextEntries: LoreEntry[]) => {
      setWorkspaceLoreEntries((prev) =>
        areLoreEntriesEqual(prev, nextEntries) ? prev : nextEntries
      );
    },
    [setWorkspaceLoreEntries]
  );
  const handleOpenVolumeNode = useCallback(
    (volumePath: string) => {
      openFileInTab(createVolumeWorkspaceTab(volumePath));
    },
    [openFileInTab]
  );

  // 作品级作用域跟随当前作品（普通文件夹为文件夹本身），与 useWorkspaceDerivedState 一致
  const buildProjectAssistantScope = useCallback((): AssistantScopeTarget | null => {
    const folder = workScopePathRef.current;
    if (!folder) return null;
    return {
      kind: 'project',
      path: folder,
      label:
        workScope?.kind === 'work'
          ? workScope.name
          : workspaceProjectName?.trim() || getNodeDisplayName(folder),
    };
  }, [workScope, workScopePathRef, workspaceProjectName]);

  const buildVolumeAssistantScope = useCallback(
    (volumePath: string): AssistantScopeTarget => {
      const node = findNodeInTree(filesRef.current, volumePath) as FileNode | null;
      return {
        kind: 'volume',
        path: volumePath,
        label:
          node?.name ||
          (folderPathRef.current === volumePath ? '未分卷' : getNodeDisplayName(volumePath)),
      };
    },
    [filesRef, folderPathRef]
  );

  const buildChapterAssistantScope = useCallback(
    (chapterPath: string): AssistantScopeTarget => ({
      kind: 'chapter',
      path: chapterPath,
      label: getNodeDisplayName(chapterPath),
    }),
    []
  );

  const handleDeleteCharacterNode = useCallback(
    async (characterId: number) => {
      const ipc = window.electron?.ipcRenderer;
      const target = workspaceCharacters.find((item) => item.id === characterId);
      if (!ipc || !target) return;
      const confirmed = await dialog.confirm('删除人物', `确定要删除人物 "${target.name}" 吗？`);
      if (!confirmed) return;

      try {
        await ipc.invoke('db-character-delete', characterId);
        setWorkspaceCharacters((prev) => prev.filter((item) => item.id !== characterId));
        const workspaceTab = createCharacterWorkspaceTab({ id: characterId });
        setOpenTabs((prev) => prev.filter((tab) => tab !== workspaceTab));
        if (activeTabRef.current === workspaceTab) {
          setActiveTab(WORKSPACE_TAB_CHARACTERS);
        }
        toast.success(`已删除人物 "${target.name}"`);
      } catch (error) {
        toast.error(`删除人物失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [
      activeTabRef,
      dialog,
      setActiveTab,
      setOpenTabs,
      setWorkspaceCharacters,
      toast,
      workspaceCharacters,
    ]
  );

  const handleRenameCharacterNode = useCallback(
    async (characterId: number, inlineName?: string) => {
      const ipc = window.electron?.ipcRenderer;
      const target = workspaceCharacters.find((item) => item.id === characterId);
      if (!ipc || !target) return;
      const nextName =
        inlineName ?? (await dialog.prompt('修改人物名', '请输入新的人物名', target.name));
      const normalizedName = nextName?.trim();
      if (!normalizedName || normalizedName === target.name) return;

      try {
        const novelId = await getCurrentNovelId();
        const existingRows = novelId
          ? ((await ipc.invoke('db-character-list', novelId)) as Array<{
              id: number;
              name: string;
              role: string;
              description: string;
              attributes: string;
            }>)
          : [];
        const matchedRow = existingRows.find((item) => item.id === characterId);
        await ipc.invoke('db-character-update', characterId, {
          name: normalizedName,
          role: target.role,
          description: target.description,
          attributes:
            matchedRow?.attributes ||
            stringifyCharacterAttributes(
              {
                avatar: target.avatar,
                design: target.design,
                media: target.media,
                aliases: target.aliases,
                category: target.category,
                highlightColor: target.highlightColor,
                highlightFirstMentionOnly: target.highlightFirstMentionOnly,
              },
              target.role
            ),
        });
        setWorkspaceCharacters((prev) =>
          prev.map((item) => (item.id === characterId ? { ...item, name: normalizedName } : item))
        );
        toast.success(`人物已更名为 "${normalizedName}"`);
      } catch (error) {
        toast.error(`修改人物名失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [dialog, getCurrentNovelId, setWorkspaceCharacters, toast, workspaceCharacters]
  );

  const handleDeleteLoreNode = useCallback(
    async (entryId: number) => {
      const ipc = window.electron?.ipcRenderer;
      const target = workspaceLoreEntries.find((item) => item.id === entryId);
      if (!ipc || !target) return;
      const confirmed = await dialog.confirm('删除设定', `确定要删除设定 "${target.title}" 吗？`);
      if (!confirmed) return;

      try {
        await ipc.invoke('db-world-setting-delete', entryId);
        setWorkspaceLoreEntries((prev) => prev.filter((item) => item.id !== entryId));
        const workspaceTab = createLoreWorkspaceTab({ id: entryId });
        setOpenTabs((prev) => prev.filter((tab) => tab !== workspaceTab));
        if (activeTabRef.current === workspaceTab) {
          setActiveTab(WORKSPACE_TAB_LORE);
        }
        toast.success(`已删除设定 "${target.title}"`);
      } catch (error) {
        toast.error(`删除设定失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [
      activeTabRef,
      dialog,
      setActiveTab,
      setOpenTabs,
      setWorkspaceLoreEntries,
      toast,
      workspaceLoreEntries,
    ]
  );

  const handleRenameLoreNode = useCallback(
    async (entryId: number, inlineTitle?: string) => {
      const ipc = window.electron?.ipcRenderer;
      const target = workspaceLoreEntries.find((item) => item.id === entryId);
      if (!ipc || !target) return;
      const nextTitle =
        inlineTitle ?? (await dialog.prompt('修改设定名', '请输入新的设定名', target.title));
      const normalizedTitle = nextTitle?.trim();
      if (!normalizedTitle || normalizedTitle === target.title) return;

      try {
        await ipc.invoke('db-world-setting-update', entryId, {
          title: normalizedTitle,
          content: target.summary,
          tags: JSON.stringify(target.tags),
        });
        setWorkspaceLoreEntries((prev) =>
          prev.map((item) => (item.id === entryId ? { ...item, title: normalizedTitle } : item))
        );
        toast.success(`设定已更名为 "${normalizedTitle}"`);
      } catch (error) {
        toast.error(`修改设定名失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [dialog, setWorkspaceLoreEntries, toast, workspaceLoreEntries]
  );

  const handleClearCharacters = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    const novelId = await getCurrentNovelId();
    const folder = workScopePathRef.current;
    if (!ipc || !novelId || !folder) return;
    if (workspaceCharacters.length === 0) {
      toast.info('当前作品没有可清空的人物');
      return;
    }
    const confirmed = await dialog.confirm(
      '清空人物',
      `确定要清空当前作品的 ${workspaceCharacters.length} 个人物吗？这会同时清空人物关系图。`
    );
    if (!confirmed) return;

    try {
      await ipc.invoke('db-character-clear-by-novel', novelId);
      const prefixes = [
        createRelationStorageKey(folder),
        createGraphLayoutStorageKey(folder),
      ].filter((item): item is string => Boolean(item));
      if (prefixes.length > 0) {
        await ipc.invoke('db-settings-delete-prefixes', prefixes);
      }
      setWorkspaceCharacters([]);
      bumpWorkspaceCharactersVersion();
      closeTabsByPredicate((tab) => tab.startsWith('__workspace__:character:'));
      toast.success('人物已清空');
    } catch (error) {
      toast.error(`清空人物失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [
    bumpWorkspaceCharactersVersion,
    closeTabsByPredicate,
    dialog,
    getCurrentNovelId,
    setWorkspaceCharacters,
    toast,
    workScopePathRef,
    workspaceCharacters.length,
  ]);

  const handleClearLoreEntries = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    const folder = workScopePathRef.current;
    if (!ipc || !folder) return;
    if (workspaceLoreEntries.length === 0) {
      toast.info('当前作品没有可清空的设定');
      return;
    }
    const confirmed = await dialog.confirm(
      '清空设定',
      `确定要清空当前作品的 ${workspaceLoreEntries.length} 条设定吗？`
    );
    if (!confirmed) return;

    try {
      await ipc.invoke('db-world-setting-clear-by-folder', folder);
      setWorkspaceLoreEntries([]);
      bumpWorkspaceLoreVersion();
      closeTabsByPredicate((tab) => tab.startsWith('__workspace__:lore-entry:'));
      toast.success('设定已清空');
    } catch (error) {
      toast.error(`清空设定失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [
    bumpWorkspaceLoreVersion,
    closeTabsByPredicate,
    dialog,
    setWorkspaceLoreEntries,
    toast,
    workScopePathRef,
    workspaceLoreEntries.length,
  ]);

  return {
    handleFileSelect,
    handleOpenCharacters,
    handleOpenLore,
    handleOpenCharacterNode,
    handleOpenLoreNode,
    handleRenameProject,
    syncWorkspaceCharacters,
    syncWorkspaceLoreEntries,
    handleOpenVolumeNode,
    buildProjectAssistantScope,
    buildVolumeAssistantScope,
    buildChapterAssistantScope,
    handleDeleteCharacterNode,
    handleRenameCharacterNode,
    handleDeleteLoreNode,
    handleRenameLoreNode,
    handleClearCharacters,
    handleClearLoreEntries,
  };
}

export type WorkspaceEntityActions = ReturnType<typeof useWorkspaceEntityActions>;
