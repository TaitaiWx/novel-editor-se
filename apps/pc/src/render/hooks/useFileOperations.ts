import { useCallback } from 'react';
import { CHAPTER_MATERIALS_STORAGE_PREFIX } from '@/render/app/types';
import type { FileNode } from '@/render/types';
import {
  buildUniqueMarkdownName,
  buildUniqueMovedName,
  collectMaterialDeletionTargets,
  findNodeInTree,
  getFileExtension,
  getParentDirectory,
  getPathBaseName,
  isPathInWorkspace,
  isPathSameOrDescendant,
  joinSiblingPath,
  stripExtension,
} from '@/render/app/fileTreeUtils';
import {
  findStoryParentPath,
  isStoryFilePath,
  resolveOrderedStoryChildren,
  splitWorkspaceFiles,
} from '@/render/utils/workspace';
import { moveStoryPathRelative, remapStoryOrderMapPaths } from '@/render/app/storyOrder';
import { splitChapters } from '@/render/utils/chapterSplitter';
import { selectWorkScopeNodes } from '@/render/utils/workScope';
import { isPathInside } from '@/render/utils/path';
import type { WorkspaceState } from './state/useWorkspaceState';
import type { TabsState } from './state/useTabsState';
import type { EntitiesState } from './state/useEntitiesState';
import type { UiState } from './state/useUiState';
import type { TabActions } from './useTabActions';
import type { EditorSessionApi } from './useEditorSession';
import type { StoryOrderSync } from './useStoryOrderSync';
import type { ScopedContentReader } from './useScopedContentReader';
import type { ProjectLoaderApi } from './useProjectLoader';
import type { WorkspaceDerivedState } from './useWorkspaceDerivedState';

export type UseFileOperationsContext = Pick<
  WorkspaceState,
  | 'filesRef'
  | 'folderPathRef'
  | 'projectLayout'
  | 'setStoryOrderMap'
  | 'storyOrderMapRef'
  | 'workScope'
  | 'workScopePathRef'
> &
  Pick<TabsState, 'activeTabRef' | 'setActiveTab' | 'setOpenTabs' | 'setUntitledTabContents'> &
  Pick<EntitiesState, 'setChapterMaterialPaths'> &
  Pick<UiState, 'clipboard' | 'dialog' | 'setClipboard' | 'toast'> &
  Pick<TabActions, 'closeTab' | 'closeTabsByPredicate' | 'openFileInTab'> &
  Pick<
    EditorSessionApi,
    'moveViewportSnapshot' | 'remapPathReferences' | 'removeViewportSnapshots'
  > &
  Pick<StoryOrderSync, 'persistStoryOrderMap'> &
  Pick<ScopedContentReader, 'readStoryDocumentText'> &
  Pick<ProjectLoaderApi, 'refreshCurrentFolder'> &
  Pick<WorkspaceDerivedState, 'workspaceMaterialNodes'>;

/**
 * 文件树操作：删除、重命名、移动排序、复制粘贴、拖放导入、保存未命名文件、拆分章节
 */
export function useFileOperations(ctx: UseFileOperationsContext) {
  const {
    activeTabRef,
    clipboard,
    closeTab,
    closeTabsByPredicate,
    dialog,
    filesRef,
    folderPathRef,
    moveViewportSnapshot,
    openFileInTab,
    persistStoryOrderMap,
    readStoryDocumentText,
    refreshCurrentFolder,
    remapPathReferences,
    removeViewportSnapshots,
    setActiveTab,
    setChapterMaterialPaths,
    setClipboard,
    setOpenTabs,
    setStoryOrderMap,
    setUntitledTabContents,
    storyOrderMapRef,
    toast,
    projectLayout,
    workScope,
    workScopePathRef,
    workspaceMaterialNodes,
  } = ctx;

  const handleDeleteFile = useCallback(
    async (filePath: string) => {
      if (!window.electron?.ipcRenderer) return;
      const name = filePath.split('/').pop() || filePath;
      const confirmed = await dialog.confirm('删除文件', `确定要删除 "${name}" 吗？`);
      if (!confirmed) return;
      try {
        await window.electron.ipcRenderer.invoke('delete-file', filePath);
        closeTab(filePath);
        removeViewportSnapshots((path) => path === filePath);
        await refreshCurrentFolder();
        toast.success(`已删除 "${name}"`);
      } catch (error) {
        toast.error(`删除文件失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [toast, dialog, refreshCurrentFolder, closeTab, removeViewportSnapshots]
  );

  const handleDeleteDirectory = useCallback(
    async (dirPath: string) => {
      if (!window.electron?.ipcRenderer) return;
      const name = dirPath.split('/').pop() || dirPath;
      const confirmed = await dialog.confirm(
        '删除文件夹',
        `确定要删除文件夹 "${name}" 及其所有内容吗？`
      );
      if (!confirmed) return;
      try {
        await window.electron.ipcRenderer.invoke('delete-directory', dirPath);
        // Close any tabs under this directory
        setOpenTabs((prev) => prev.filter((t) => !isPathInside(t, dirPath)));
        removeViewportSnapshots((path) => isPathInside(path, dirPath));
        if (activeTabRef.current && isPathInside(activeTabRef.current, dirPath)) {
          setActiveTab(null);
        }
        await refreshCurrentFolder();
        toast.success(`已删除文件夹 "${name}"`);
      } catch (error) {
        toast.error(`删除目录失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [
      dialog,
      setOpenTabs,
      removeViewportSnapshots,
      activeTabRef,
      refreshCurrentFolder,
      toast,
      setActiveTab,
    ]
  );

  const handleDeleteVolumeNode = useCallback(
    async (volumePath: string, isSynthetic = false) => {
      if (isSynthetic) {
        toast.info('未分卷用于承接未归档正文，不能直接删除');
        return;
      }
      await handleDeleteDirectory(volumePath);
    },
    [handleDeleteDirectory, toast]
  );

  const handleRename = useCallback(
    async (oldPath: string) => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return;
      const oldName = getPathBaseName(oldPath);
      const storyNode = findNodeInTree(splitWorkspaceFiles(filesRef.current).storyNodes, oldPath);
      const isStoryDocument = storyNode?.type === 'file';
      const oldExtension = isStoryDocument ? getFileExtension(oldName) : '';
      const promptDefaultName = isStoryDocument ? stripExtension(oldName) : oldName;
      const nextInputName = await dialog.prompt('重命名', '请输入新名称', promptDefaultName);
      const normalizedInputName = nextInputName?.trim();
      if (!normalizedInputName) return;

      // 中文说明：正文文件统一保留原扩展名，避免用户关心文件类型。
      const nextName = isStoryDocument
        ? `${stripExtension(normalizedInputName)}${oldExtension}`
        : normalizedInputName;

      if (nextName === oldName) return;
      const parentDir = getParentDirectory(oldPath);
      if (!parentDir) {
        toast.error('重命名失败: 无法解析父目录');
        return;
      }
      const newPath = joinSiblingPath(parentDir, nextName, oldPath);
      try {
        await ipc.invoke('rename-file', oldPath, newPath);
        const nextStoryOrderMap = remapStoryOrderMapPaths(
          storyOrderMapRef.current,
          oldPath,
          newPath
        );
        storyOrderMapRef.current = nextStoryOrderMap;
        setStoryOrderMap(nextStoryOrderMap);
        await persistStoryOrderMap(nextStoryOrderMap);
        remapPathReferences(oldPath, newPath);
        await refreshCurrentFolder();
        toast.success(`已重命名为 "${isStoryDocument ? stripExtension(nextName) : nextName}"`);
      } catch (error) {
        toast.error(`重命名失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [
      filesRef,
      dialog,
      toast,
      storyOrderMapRef,
      setStoryOrderMap,
      persistStoryOrderMap,
      remapPathReferences,
      refreshCurrentFolder,
    ]
  );

  const handleReorderStoryNode = useCallback(
    async (sourcePath: string, targetPath: string, mode: 'before' | 'after' | 'inside') => {
      const ipc = window.electron?.ipcRenderer;
      const folder = folderPathRef.current;
      if (!ipc || !folder || sourcePath === targetPath) return;

      const storyNodes = splitWorkspaceFiles(filesRef.current).storyNodes;
      const sourceNode = findNodeInTree(storyNodes, sourcePath);
      const sourceParentPath = findStoryParentPath(storyNodes, folder, sourcePath);
      if (!sourceNode || !sourceParentPath) return;
      if (sourceNode.type === 'directory' && isPathSameOrDescendant(targetPath, sourcePath)) {
        return;
      }

      const destinationParentPath =
        mode === 'inside' ? targetPath : findStoryParentPath(storyNodes, folder, targetPath);
      if (!destinationParentPath) return;

      const sourceOrderedPaths = resolveOrderedStoryChildren(
        storyNodes,
        folder,
        sourceParentPath,
        storyOrderMapRef.current
      ).map((node) => node.path);
      const destinationOrderedPaths = resolveOrderedStoryChildren(
        storyNodes,
        folder,
        destinationParentPath,
        storyOrderMapRef.current
      ).map((node) => node.path);

      if (destinationParentPath === sourceParentPath) {
        const nextOrderedPaths =
          mode === 'inside'
            ? [...sourceOrderedPaths.filter((path) => path !== sourcePath), sourcePath]
            : moveStoryPathRelative(sourceOrderedPaths, sourcePath, targetPath, mode);

        if (
          nextOrderedPaths === sourceOrderedPaths ||
          nextOrderedPaths.join('|') === sourceOrderedPaths.join('|')
        ) {
          return;
        }

        const previousStoryOrderMap = storyOrderMapRef.current;
        const nextStoryOrderMap = {
          ...previousStoryOrderMap,
          [sourceParentPath]: nextOrderedPaths,
        };

        storyOrderMapRef.current = nextStoryOrderMap;
        setStoryOrderMap(nextStoryOrderMap);

        try {
          await persistStoryOrderMap(nextStoryOrderMap);
        } catch (error) {
          storyOrderMapRef.current = previousStoryOrderMap;
          setStoryOrderMap(previousStoryOrderMap);
          toast.error(`调整顺序失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
        return;
      }

      const siblingNames = new Set(
        destinationOrderedPaths
          .filter((path) => path !== sourcePath)
          .map((path) => findNodeInTree(storyNodes, path)?.name)
          .filter((name): name is string => Boolean(name))
      );
      const nextName = buildUniqueMovedName(sourceNode.name, siblingNames);
      const newPath = `${destinationParentPath}/${nextName}`;
      if (newPath === sourcePath) return;

      const previousStoryOrderMap = storyOrderMapRef.current;

      try {
        await ipc.invoke('rename-file', sourcePath, newPath);
        let nextStoryOrderMap = remapStoryOrderMapPaths(previousStoryOrderMap, sourcePath, newPath);
        const nextDestinationPaths = destinationOrderedPaths.filter((path) => path !== sourcePath);

        if (mode === 'inside') {
          nextDestinationPaths.push(newPath);
        } else {
          const targetIndex = nextDestinationPaths.indexOf(targetPath);
          if (targetIndex < 0) {
            nextDestinationPaths.push(newPath);
          } else {
            nextDestinationPaths.splice(
              mode === 'after' ? targetIndex + 1 : targetIndex,
              0,
              newPath
            );
          }
        }

        nextStoryOrderMap = {
          ...nextStoryOrderMap,
          [sourceParentPath]: sourceOrderedPaths.filter((path) => path !== sourcePath),
          [destinationParentPath]: Array.from(new Set(nextDestinationPaths)),
        };

        storyOrderMapRef.current = nextStoryOrderMap;
        setStoryOrderMap(nextStoryOrderMap);
        await persistStoryOrderMap(nextStoryOrderMap);
        remapPathReferences(sourcePath, newPath);
        await refreshCurrentFolder();
      } catch (error) {
        toast.error(`移动正文失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [
      filesRef,
      folderPathRef,
      persistStoryOrderMap,
      refreshCurrentFolder,
      remapPathReferences,
      setStoryOrderMap,
      storyOrderMapRef,
      toast,
    ]
  );

  const handleCopyFile = useCallback(
    (filePath: string) => {
      setClipboard([filePath]);
    },
    [setClipboard]
  );

  const handlePasteFiles = useCallback(
    async (targetDir: string) => {
      if (!window.electron?.ipcRenderer) return;
      try {
        // 优先使用应用内剪贴板；若为空，尝试读取系统剪贴板中的文件路径（macOS Finder 场景）
        let pathsToPaste = clipboard;
        if (pathsToPaste.length === 0) {
          pathsToPaste = await window.electron.ipcRenderer.invoke('read-clipboard-file-paths');
        }
        if (pathsToPaste.length === 0) return;
        await window.electron.ipcRenderer.invoke('paste-files', pathsToPaste, targetDir);
        await refreshCurrentFolder();
        toast.success('已粘贴');
      } catch (error) {
        toast.error(`粘贴失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [clipboard, toast, refreshCurrentFolder]
  );

  // 拖放导入：从 Finder/Explorer 拖入文件到目录面板（复用 paste-files IPC）
  const handleDropFiles = useCallback(
    async (filePaths: string[]) => {
      if (!window.electron?.ipcRenderer || filePaths.length === 0) return;
      const targetDir = folderPathRef.current;
      if (!targetDir) {
        toast.error('请先打开一个文件夹');
        return;
      }
      try {
        await window.electron.ipcRenderer.invoke('paste-files', filePaths, targetDir);
        await refreshCurrentFolder();
        toast.success(`已导入 ${filePaths.length} 个文件`);
      } catch (error) {
        toast.error(`导入失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [folderPathRef, toast, refreshCurrentFolder]
  );

  // Save untitled file: prompt for name, write to disk, replace tab
  const handleSaveUntitled = useCallback(
    async (untitledPath: string, content: string) => {
      const currentFolder = folderPathRef.current;
      if (!currentFolder || !window.electron?.ipcRenderer) {
        toast.error('请先打开一个文件夹');
        return;
      }
      const fileName = await dialog.prompt('保存文件', '请输入文件名', '');
      if (!fileName) return;
      const newPath = `${currentFolder}/${fileName}`;
      try {
        await window.electron.ipcRenderer.invoke('write-file', newPath, content);
        // Replace untitled tab with real file path
        setOpenTabs((prev) => prev.map((t) => (t === untitledPath ? newPath : t)));
        setUntitledTabContents((prev) => {
          if (!(untitledPath in prev)) return prev;
          const { [untitledPath]: _removed, ...rest } = prev;
          return rest;
        });
        moveViewportSnapshot(untitledPath, newPath);
        if (activeTabRef.current === untitledPath) {
          setActiveTab(newPath);
        }
        await refreshCurrentFolder();
        toast.success(`文件 "${fileName}" 已保存`);
      } catch (error) {
        toast.error(`保存失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [
      folderPathRef,
      dialog,
      toast,
      setOpenTabs,
      setUntitledTabContents,
      moveViewportSnapshot,
      activeTabRef,
      refreshCurrentFolder,
      setActiveTab,
    ]
  );

  // 清空当前作品的资料（资料跟随作品）；只删资料，不会删到同一目录下的正文
  const handleClearMaterials = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    const folder = workScopePathRef.current;
    if (!ipc || !folder) return;
    const targets = collectMaterialDeletionTargets(
      selectWorkScopeNodes(workspaceMaterialNodes, workScope, projectLayout),
      filesRef.current
    );
    if (targets.length === 0) {
      toast.info('当前作品没有可清空的资料');
      return;
    }
    const confirmed = await dialog.confirm(
      '清空资料',
      '确定要清空当前作品资料区中的所有文件与目录吗？该操作不会删除正文。'
    );
    if (!confirmed) return;

    try {
      for (const node of targets) {
        if (node.type === 'directory') {
          await ipc.invoke('delete-directory', node.path);
        } else {
          await ipc.invoke('delete-file', node.path);
        }
      }
      const settingsRows = (await ipc.invoke('db-settings-all')) as Array<{
        key: string;
        value: string;
      }>;
      const materialSettingKeys = settingsRows
        .map((row) => row.key)
        .filter(
          (key) =>
            key.startsWith(CHAPTER_MATERIALS_STORAGE_PREFIX) &&
            isPathInWorkspace(key.slice(CHAPTER_MATERIALS_STORAGE_PREFIX.length), folder)
        );
      if (materialSettingKeys.length > 0) {
        await ipc.invoke('db-settings-delete-prefixes', materialSettingKeys);
      }
      setChapterMaterialPaths([]);
      closeTabsByPredicate((tab) =>
        targets.some((node) => tab === node.path || tab.startsWith(`${node.path}/`))
      );
      await refreshCurrentFolder();
      toast.success('资料已清空');
    } catch (error) {
      toast.error(`清空资料失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [
    closeTabsByPredicate,
    dialog,
    filesRef,
    projectLayout,
    refreshCurrentFolder,
    setChapterMaterialPaths,
    toast,
    workScope,
    workScopePathRef,
    workspaceMaterialNodes,
  ]);

  const handleSplitStoryFile = useCallback(
    async (filePath: string) => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc || !isStoryFilePath(filePath)) return;

      try {
        const raw = await readStoryDocumentText(filePath);
        const chapters = splitChapters(raw).filter(
          (chapter) =>
            chapter.title.trim() &&
            chapter.title.trim() !== '全文' &&
            (chapter.content.trim() || chapter.title.trim())
        );
        if (chapters.length < 2) {
          toast.warning('当前文件未识别出可拆分的多个章节');
          return;
        }
        const preview = chapters
          .slice(0, 8)
          .map((chapter, index) => `${index + 1}. ${chapter.title}`)
          .join('\n');
        const confirmed = await dialog.confirm(
          '按章节拆分',
          `识别到 ${chapters.length} 个章节，将在当前目录生成对应章节文件。\n\n${preview}${chapters.length > 8 ? '\n…' : ''}`
        );
        if (!confirmed) return;

        const targetDir = getParentDirectory(filePath) || folderPathRef.current;
        if (!targetDir) throw new Error('无法确定拆分目标目录');
        const siblings = findNodeInTree(filesRef.current, targetDir)?.children || filesRef.current;
        const existingNames = new Set(
          siblings
            .filter((node): node is FileNode & { type: 'file' } => node.type === 'file')
            .map((node) => node.name)
        );
        const createdPaths: string[] = [];
        for (const chapter of chapters) {
          const fileName = buildUniqueMarkdownName(chapter.title, existingNames);
          const result = (await ipc.invoke('create-file', targetDir, fileName)) as {
            success: boolean;
            filePath: string;
          };
          const nextContent = [`# ${chapter.title}`, '', chapter.content.trim()]
            .filter(Boolean)
            .join('\n');
          await ipc.invoke('write-file', result.filePath, nextContent);
          createdPaths.push(result.filePath);
        }
        await refreshCurrentFolder();
        if (createdPaths[0]) {
          openFileInTab(createdPaths[0]);
        }
        toast.success(`已拆分生成 ${createdPaths.length} 个章节文件`);
      } catch (error) {
        toast.error(`按章节拆分失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [
      dialog,
      filesRef,
      folderPathRef,
      openFileInTab,
      readStoryDocumentText,
      refreshCurrentFolder,
      toast,
    ]
  );

  return {
    handleDeleteFile,
    handleDeleteDirectory,
    handleDeleteVolumeNode,
    handleRename,
    handleReorderStoryNode,
    handleCopyFile,
    handlePasteFiles,
    handleDropFiles,
    handleSaveUntitled,
    handleClearMaterials,
    handleSplitStoryFile,
  };
}

export type FileOperations = ReturnType<typeof useFileOperations>;
