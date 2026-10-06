import React, { useCallback } from 'react';
import type { KnowledgeExportOptions } from '@/render/app/types';
import type { WorkspaceState } from './state/useWorkspaceState';
import type { UiState } from './state/useUiState';

export type UseProjectExportContext = Pick<WorkspaceState, 'folderPathRef'> &
  Partial<Pick<WorkspaceState, 'workScopePathRef'>> &
  Pick<UiState, 'knowledgeExportOptions' | 'setShowKnowledgeExportDialog' | 'toast'>;

/**
 * 导出项目与导出角色卡 / 设定 / 资料
 */
export function useProjectExport(ctx: UseProjectExportContext) {
  const { folderPathRef, knowledgeExportOptions, setShowKnowledgeExportDialog, toast } = ctx;
  const workScopePathRef = ctx.workScopePathRef ?? folderPathRef;

  // 导出项目：将整个项目目录复制到用户选择的位置
  const handleExportProject = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const folder = folderPathRef.current;
    if (!folder) {
      toast.error('请先打开一个项目文件夹');
      return;
    }
    try {
      const result = (await ipc.invoke('export-project', folder)) as {
        success: boolean;
        destPath?: string;
        error?: string;
      } | null;
      if (!result) return; // 用户取消
      if (result.success) {
        toast.success(`项目已导出到: ${result.destPath}`);
      } else if (result.error) {
        toast.error(`导出失败: ${result.error}`);
      }
    } catch (error) {
      toast.error(`导出失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [folderPathRef, toast]);

  // 导出角色卡、设定与资料：数据源直接来自 SQLite，避免依赖组件临时状态。导出的是当前作品。
  const handleExportKnowledgeText = useCallback(
    async (options: KnowledgeExportOptions) => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return;
      const folder = workScopePathRef.current;
      if (!folder) {
        toast.error('请先打开一个项目文件夹');
        return;
      }
      if (!options.includeCharacters && !options.includeLore && !options.includeMaterials) {
        toast.warning('请至少勾选一种导出内容（角色/设定/资料）');
        return;
      }
      try {
        const filePath = (await ipc.invoke('db-export-knowledge-text', folder, options)) as
          | string
          | null;
        if (!filePath) return;
        toast.success(`角色卡、设定与资料已导出: ${filePath}`);
      } catch (error) {
        toast.error(
          `导出角色卡、设定与资料失败: ${error instanceof Error ? error.message : '未知错误'}`
        );
      }
    },
    [workScopePathRef, toast]
  );

  const handleOpenKnowledgeExportDialog = useCallback(() => {
    setShowKnowledgeExportDialog(true);
  }, [setShowKnowledgeExportDialog]);

  const handleConfirmKnowledgeExport = useCallback(async () => {
    await handleExportKnowledgeText(knowledgeExportOptions);
    setShowKnowledgeExportDialog(false);
  }, [handleExportKnowledgeText, knowledgeExportOptions, setShowKnowledgeExportDialog]);

  // 监听原生菜单的导出项目快捷键
  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const dispose = ipc.on('menu-export-project', handleExportProject);
    return () => {
      dispose?.();
    };
  }, [handleExportProject]);

  return {
    handleExportProject,
    handleExportKnowledgeText,
    handleOpenKnowledgeExportDialog,
    handleConfirmKnowledgeExport,
  };
}

export type ProjectExportApi = ReturnType<typeof useProjectExport>;
