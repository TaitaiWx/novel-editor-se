import { useCallback, useMemo } from 'react';
import {
  CHARACTER_CATEGORY_LABELS,
  DEFAULT_CHARACTER_HIGHLIGHT_COLOR,
  DEFAULT_CHARACTER_HIGHLIGHT_FIRST_MENTION_ONLY,
  inferCharacterCategoryFromRole,
  mapCharacterRows,
  normalizeCharacterCategory,
  stringifyCharacterAttributes,
} from '@/render/components/RightPanel/utils';
import type { StoryCreateKind } from '@/render/app/types';
import {
  WORKSPACE_TAB_CHARACTERS,
  WORKSPACE_TAB_LORE,
  createCharacterWorkspaceTab,
  createLoreWorkspaceTab,
  createVolumeWorkspaceTab,
  parseVolumeWorkspaceTab,
  splitWorkspaceFiles,
} from '@/render/utils/workspace';
import {
  ensureMarkdownFileName,
  findNodeInTree,
  getParentDirectory,
  isDraftLikeName,
  isMaterialLikeName,
  stripExtension,
} from '@/render/app/fileTreeUtils';
import { loadLoreEntriesByFolder } from '@/render/components/RightPanel/lore-data';
import type { AppState } from './useAppState';
import type { TabActions } from './useTabActions';
import type { ProjectLoaderApi } from './useProjectLoader';

export type UseWorkspaceCreationContext = Pick<
  AppState,
  | 'activeTab'
  | 'activeTabRef'
  | 'creatingType'
  | 'dialog'
  | 'files'
  | 'filesRef'
  | 'folderPath'
  | 'folderPathRef'
  | 'openTabsRef'
  | 'setActiveTab'
  | 'setCreatingType'
  | 'setEditorContent'
  | 'setOpenTabs'
  | 'setUntitledTabContents'
  | 'setWorkspaceCharacters'
  | 'setWorkspaceLoreEntries'
  | 'toast'
  | 'untitledCounterRef'
> &
  Pick<TabActions, 'openFileInTab'> &
  Pick<ProjectLoaderApi, 'refreshCurrentFolder'>;

/**
 * 新建文件 / 目录 / 卷章 / 人物 / 设定，以及导入文稿
 */
export function useWorkspaceCreation(ctx: UseWorkspaceCreationContext) {
  const {
    activeTab,
    activeTabRef,
    creatingType,
    dialog,
    files,
    filesRef,
    folderPath,
    folderPathRef,
    openFileInTab,
    openTabsRef,
    refreshCurrentFolder,
    setActiveTab,
    setCreatingType,
    setEditorContent,
    setOpenTabs,
    setUntitledTabContents,
    setWorkspaceCharacters,
    setWorkspaceLoreEntries,
    toast,
    untitledCounterRef,
  } = ctx;

  const handleCreateFile = useCallback(() => {
    if (!folderPathRef.current) return;
    setCreatingType('file');
  }, []);

  const handleCreateDirectory = useCallback(() => {
    if (!folderPathRef.current) return;
    setCreatingType('directory');
  }, []);

  const handleCreateMaterialDirectory = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    const folder = folderPathRef.current;
    if (!ipc || !folder) return;

    const name = await dialog.prompt('新建资料目录', '请输入资料目录名称', '新资料');
    if (!name?.trim()) return;

    const defaultRoot =
      filesRef.current.find((node) => node.type === 'directory' && isMaterialLikeName(node.name))
        ?.path ?? null;

    try {
      // 资料根目录的创建也放在 try 内，失败时给出提示而不是抛出未处理的异常
      const targetRoot =
        defaultRoot ||
        (
          (await ipc.invoke('create-directory', folder, '资料')) as {
            success: boolean;
            dirPath: string;
          }
        ).dirPath;
      await ipc.invoke('create-directory', targetRoot, name.trim());
      await refreshCurrentFolder();
      toast.success('资料目录创建成功');
    } catch (error) {
      toast.error(`新建资料目录失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [dialog, refreshCurrentFolder, toast]);

  const getCurrentNovelId = useCallback(async (): Promise<number | null> => {
    const ipc = window.electron?.ipcRenderer;
    const folder = folderPathRef.current;
    if (!ipc || !folder) return null;
    const novel = (await ipc.invoke('db-novel-get-by-folder', folder)) as { id: number } | null;
    return novel?.id ?? null;
  }, []);

  const handleCreateCharacter = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    const novelId = await getCurrentNovelId();
    if (!ipc || !novelId) return;

    const name = await dialog.prompt('新建人物', '请输入人物名称', '新人物');
    if (!name?.trim()) return;
    const role = await dialog.prompt('人物定位', '请输入角色定位（可选）', '');
    const inferredCategory = inferCharacterCategoryFromRole(role?.trim() || '');
    const categoryInput = await dialog.prompt(
      '人物分类',
      '请输入人物分类（主要角色 / 次要角色）',
      CHARACTER_CATEGORY_LABELS[inferredCategory]
    );
    const category = normalizeCharacterCategory(categoryInput, role?.trim() || '');

    try {
      const result = (await ipc.invoke(
        'db-character-create',
        novelId,
        name.trim(),
        role?.trim() || '',
        '',
        stringifyCharacterAttributes(
          {
            category,
            highlightColor: DEFAULT_CHARACTER_HIGHLIGHT_COLOR,
            highlightFirstMentionOnly: DEFAULT_CHARACTER_HIGHLIGHT_FIRST_MENTION_ONLY,
          },
          role?.trim() || ''
        )
      )) as { lastInsertRowid?: number | bigint };
      const nextRows = (await ipc.invoke('db-character-list', novelId)) as Array<{
        id: number;
        name: string;
        role: string;
        description: string;
        attributes: string;
      }>;
      setWorkspaceCharacters(mapCharacterRows(nextRows));
      const createdId = Number(result?.lastInsertRowid);
      if (Number.isFinite(createdId) && createdId > 0) {
        openFileInTab(createCharacterWorkspaceTab({ id: createdId }));
      } else {
        openFileInTab(WORKSPACE_TAB_CHARACTERS);
      }
      toast.success('人物创建成功');
    } catch (error) {
      toast.error(`新建人物失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [dialog, getCurrentNovelId, openFileInTab, toast]);

  const handleCreateLoreEntry = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    const folder = folderPathRef.current;
    if (!ipc || !folder) return;

    const title = await dialog.prompt('新建设定', '请输入设定名称', '新设定');
    if (!title?.trim()) return;

    try {
      await ipc.invoke(
        'db-world-setting-create-by-folder',
        folder,
        'world',
        title.trim(),
        '',
        '[]'
      );
      const nextEntries = await loadLoreEntriesByFolder(folder);
      setWorkspaceLoreEntries(nextEntries);
      const createdEntry = nextEntries.find((entry) => entry.title === title.trim());
      if (createdEntry) {
        openFileInTab(createLoreWorkspaceTab({ id: createdEntry.id }));
      } else {
        openFileInTab(WORKSPACE_TAB_LORE);
      }
      toast.success('设定创建成功');
    } catch (error) {
      toast.error(`新建设定失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [dialog, openFileInTab, toast]);

  const resolveStoryCreateTargetDir = useCallback((kind: StoryCreateKind): string | null => {
    const folder = folderPathRef.current;
    if (!folder) return null;
    const currentTab = activeTabRef.current;
    const activeVolumePath = parseVolumeWorkspaceTab(currentTab);
    const selectedStoryNode = currentTab
      ? findNodeInTree(splitWorkspaceFiles(filesRef.current).storyNodes, currentTab)
      : null;

    if (kind === 'volume') return folder;

    if (kind === 'chapter') {
      if (activeVolumePath) return activeVolumePath;
      if (selectedStoryNode?.type === 'directory' && !isDraftLikeName(selectedStoryNode.name)) {
        return selectedStoryNode.path;
      }
      if (selectedStoryNode?.type === 'file') {
        const parentDir = getParentDirectory(selectedStoryNode.path);
        if (parentDir) return parentDir;
      }
      return folder;
    }

    if (kind === 'draft-folder' || kind === 'draft') {
      if (selectedStoryNode?.type === 'directory') return selectedStoryNode.path;
      if (selectedStoryNode?.type === 'file') {
        const parentDir = getParentDirectory(selectedStoryNode.path);
        if (parentDir) return parentDir;
      }
      if (activeVolumePath) return activeVolumePath;
      return folder;
    }

    return folder;
  }, []);

  const suggestStoryCreateName = useCallback((kind: StoryCreateKind, targetDir: string): string => {
    const childNodes =
      targetDir === folderPathRef.current
        ? splitWorkspaceFiles(filesRef.current).storyNodes
        : findNodeInTree(filesRef.current, targetDir)?.children || [];
    if (kind === 'volume') {
      const volumeCount = childNodes.filter(
        (node) => node.type === 'directory' && !isDraftLikeName(node.name)
      ).length;
      return `第${volumeCount + 1}卷`;
    }
    if (kind === 'chapter') {
      const chapterCount = childNodes.filter(
        (node) =>
          node.type === 'file' &&
          (!isDraftLikeName(node.name) || /第.+[章节幕回篇集]/.test(node.name))
      ).length;
      return `第${chapterCount + 1}章 未命名`;
    }
    if (kind === 'draft-folder') {
      const draftDirCount = childNodes.filter(
        (node) => node.type === 'directory' && isDraftLikeName(node.name)
      ).length;
      return draftDirCount === 0 ? '样稿' : `样稿${draftDirCount + 1}`;
    }
    const draftCount = childNodes.filter(
      (node) => node.type === 'file' && isDraftLikeName(node.name)
    ).length;
    return draftCount === 0 ? '样稿' : `样稿-${draftCount + 1}`;
  }, []);

  const handleCreateStoryItem = useCallback(
    async (kind: StoryCreateKind) => {
      const ipc = window.electron?.ipcRenderer;
      const targetDir = resolveStoryCreateTargetDir(kind);
      if (!ipc || !targetDir) return;
      const defaultName = suggestStoryCreateName(kind, targetDir);
      const labelMap: Record<StoryCreateKind, string> = {
        volume: '新建卷',
        chapter: '新建章节',
        'draft-folder': '新建稿夹',
        draft: '新建稿',
      };
      const name = await dialog.prompt(labelMap[kind], '请输入名称', defaultName);
      if (!name?.trim()) return;

      try {
        if (kind === 'volume' || kind === 'draft-folder') {
          const result = (await ipc.invoke('create-directory', targetDir, name.trim())) as {
            success: boolean;
            dirPath: string;
          };
          await refreshCurrentFolder();
          if (kind === 'volume') {
            openFileInTab(createVolumeWorkspaceTab(result.dirPath));
          }
          toast.success(`${labelMap[kind]}成功`);
          return;
        }

        const fileName = ensureMarkdownFileName(name.trim());
        const result = (await ipc.invoke('create-file', targetDir, fileName)) as {
          success: boolean;
          filePath: string;
        };
        await refreshCurrentFolder();
        openFileInTab(result.filePath);
        toast.success(`${labelMap[kind]}成功`);
      } catch (error) {
        toast.error(
          `${labelMap[kind]}失败: ${error instanceof Error ? error.message : '未知错误'}`
        );
      }
    },
    [
      dialog,
      openFileInTab,
      refreshCurrentFolder,
      resolveStoryCreateTargetDir,
      suggestStoryCreateName,
      toast,
    ]
  );

  // Determine target directory for inline creation based on selection
  // null = root level, string = specific directory path
  const createTargetPath = useMemo<string | null>(() => {
    if (!creatingType || !folderPath) return null;
    if (!activeTab) return null;
    const selectedNode = findNodeInTree(files, activeTab);
    if (!selectedNode) return null; // untitled or not in tree → root
    if (selectedNode.type === 'directory') return selectedNode.path;
    // File at root level → root
    if (files.some((n) => n.path === activeTab)) return null;
    // File in subdirectory → parent directory
    const lastSlash = Math.max(activeTab.lastIndexOf('/'), activeTab.lastIndexOf('\\'));
    return lastSlash > 0 ? activeTab.substring(0, lastSlash) : null;
  }, [creatingType, folderPath, activeTab, files]);

  const handleInlineCreate = useCallback(
    async (type: 'file' | 'directory', name: string) => {
      const targetDir = createTargetPath ?? folderPathRef.current;
      if (!targetDir) return;
      if (!window.electron?.ipcRenderer) {
        toast.error('Electron IPC 不可用');
        setCreatingType(null);
        return;
      }
      try {
        if (type === 'file') {
          const fileName = ensureMarkdownFileName(name.trim());
          await window.electron.ipcRenderer.invoke('create-file', targetDir, fileName);
          toast.success(`文件 "${stripExtension(fileName)}" 创建成功`);
        } else {
          await window.electron.ipcRenderer.invoke('create-directory', targetDir, name);
          toast.success(`目录 "${name}" 创建成功`);
        }
        await refreshCurrentFolder();
      } catch (error) {
        toast.error(`创建失败: ${error instanceof Error ? error.message : '未知错误'}`);
      } finally {
        setCreatingType(null);
      }
    },
    [toast, refreshCurrentFolder, createTargetPath]
  );

  const handleCancelCreate = useCallback(() => {
    setCreatingType(null);
  }, []);

  const handleImportFile = useCallback(async () => {
    if (!window.electron?.ipcRenderer) return;
    try {
      const result = (await window.electron.ipcRenderer.invoke('import-file')) as {
        previews: { fileName: string; content: string }[];
        errors: { filePath: string; error: string }[];
      } | null;
      if (!result) return; // 用户取消
      // Open each preview as an untitled tab (no disk write — user saves manually)
      // 已占用的标签路径（含本批次），同名导入时追加序号避免标签与内容互相覆盖
      const usedPaths = new Set(openTabsRef.current);
      for (const preview of result.previews) {
        const num = ++untitledCounterRef.current;
        let tabPath = `__untitled__:${preview.fileName}`;
        if (usedPaths.has(tabPath)) {
          const dot = preview.fileName.lastIndexOf('.');
          const stem = dot > 0 ? preview.fileName.slice(0, dot) : preview.fileName;
          const ext = dot > 0 ? preview.fileName.slice(dot) : '';
          tabPath = `__untitled__:${stem} (${num})${ext}`;
        }
        usedPaths.add(tabPath);
        setOpenTabs((prev) => [...prev, tabPath]);
        setUntitledTabContents((prev) => ({ ...prev, [tabPath]: preview.content }));
        setActiveTab(tabPath);
        setEditorContent(preview.content);
      }
      if (result.previews.length > 0) {
        toast.success('文件已转换，可自行编辑后保存');
      }
      if (result.errors.length > 0) {
        toast.error(`${result.errors.length} 个文件转换失败`);
      }
    } catch (error) {
      toast.error(`导入失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [toast]);

  return {
    handleCreateFile,
    handleCreateDirectory,
    handleCreateMaterialDirectory,
    getCurrentNovelId,
    handleCreateCharacter,
    handleCreateLoreEntry,
    resolveStoryCreateTargetDir,
    suggestStoryCreateName,
    handleCreateStoryItem,
    createTargetPath,
    handleInlineCreate,
    handleCancelCreate,
    handleImportFile,
  };
}

export type WorkspaceCreationApi = ReturnType<typeof useWorkspaceCreation>;
