import React, { useCallback } from 'react';
import {
  findWorkScopeForPath,
  isSameWorkPath,
  readStoredWorkPath,
  storeWorkPath,
} from '@/render/utils/workScope';
import type { WorkspaceState } from './state/useWorkspaceState';
import type { UiState } from './state/useUiState';
import type { WorkspaceDerivedState } from './useWorkspaceDerivedState';
import type { ProjectLoaderApi } from './useProjectLoader';

export type UseWorkScopeContext = Pick<
  WorkspaceState,
  | 'folderPath'
  | 'projectLayout'
  | 'setPreferredWorkPath'
  | 'workScope'
  | 'workScopeOptions'
  | 'workScopePathRef'
> &
  Pick<WorkspaceDerivedState, 'activeDocumentTab'> &
  Pick<UiState, 'dialog' | 'toast'> &
  Pick<ProjectLoaderApi, 'refreshCurrentFolder'>;

/**
 * 当前作品：切换项目时恢复上次选择的作品；打开另一部作品的章节时自动切换过去；
 * 提供作品切换器的「切换 / 新建作品」动作。上次选择按项目保存（localStorage）。
 */
export function useWorkScope(ctx: UseWorkScopeContext) {
  const {
    activeDocumentTab,
    dialog,
    folderPath,
    projectLayout,
    refreshCurrentFolder,
    setPreferredWorkPath,
    toast,
    workScope,
    workScopeOptions,
    workScopePathRef,
  } = ctx;

  // 切换项目：恢复该项目上次选择的作品（不存在时 resolveWorkScope 回退到第一部作品）
  React.useEffect(() => {
    setPreferredWorkPath(readStoredWorkPath(folderPath));
  }, [folderPath, setPreferredWorkPath]);

  const selectWork = useCallback(
    (workPath: string) => {
      setPreferredWorkPath(workPath);
      storeWorkPath(folderPath, workPath);
    },
    [folderPath, setPreferredWorkPath]
  );

  // 打开另一部作品的章节 / 资料时，当前作品跟着切换。只在当前文件变化时判断：
  // 作者手动切换作品后，留在原作品的标签不会把作品切回去（文件树刷新也不会）
  const handledDocumentRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (handledDocumentRef.current === activeDocumentTab) return;
    const owner = findWorkScopeForPath(workScopeOptions, activeDocumentTab);
    // 作品列表还没加载到（例如刚打开项目）时先不记为已处理，等列表就绪后再判断
    if (!owner && activeDocumentTab && workScopeOptions.length === 0) return;
    handledDocumentRef.current = activeDocumentTab;
    if (!owner || isSameWorkPath(owner.path, workScopePathRef.current)) return;
    selectWork(owner.path);
  }, [activeDocumentTab, selectWork, workScopeOptions, workScopePathRef]);

  // 主动点击某个标签（即使它已是当前标签）：该文件属于其他作品时切过去。
  // 与上面的自动切换互补——手动切换作品后，再点回原作品的标签表示要回到那部作品
  const revealWorkForDocument = useCallback(
    (filePath: string) => {
      const owner = findWorkScopeForPath(workScopeOptions, filePath);
      if (!owner || isSameWorkPath(owner.path, workScopePathRef.current)) return;
      handledDocumentRef.current = filePath;
      selectWork(owner.path);
    },
    [selectWork, workScopeOptions, workScopePathRef]
  );

  const handleCreateWork = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc || !projectLayout) return;
    const name = (await dialog.prompt('新建作品', '请输入作品名称', '新作品'))?.trim();
    if (!name) return;
    if (/[\\/:*?"<>|]/.test(name) || name.startsWith('.')) {
      toast.error('作品名不能包含 / \\ : * ? " < > | 或以 . 开头');
      return;
    }
    try {
      const result = (await ipc.invoke('create-directory', projectLayout.novelsPath, name)) as {
        dirPath: string;
      };
      selectWork(result.dirPath);
      await refreshCurrentFolder();
      toast.success(`已新建作品「${name}」`);
    } catch (error) {
      toast.error(`新建作品失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [dialog, projectLayout, refreshCurrentFolder, selectWork, toast]);

  return {
    workScope,
    workScopeOptions,
    handleSelectWork: selectWork,
    handleCreateWork,
    revealWorkForDocument,
  };
}

export type WorkScopeApi = ReturnType<typeof useWorkScope>;
