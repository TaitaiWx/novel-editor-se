import { useEffect } from 'react';
import type { WorkspaceState } from './state/useWorkspaceState';
import type { UiState } from './state/useUiState';

export type UseGeneratedMaterialCleanupContext = Pick<
  WorkspaceState,
  'cleanedGeneratedMaterialFoldersRef' | 'folderPath' | 'refreshCurrentFolderRef'
> &
  Pick<UiState, 'toast'>;

/**
 * 打开项目后在空闲时清理历史遗留的空资料目录
 */
export function useGeneratedMaterialCleanup(ctx: UseGeneratedMaterialCleanupContext) {
  const { cleanedGeneratedMaterialFoldersRef, folderPath, refreshCurrentFolderRef, toast } = ctx;

  useEffect(() => {
    const currentFolderPath = folderPath;
    const ipc = window.electron?.ipcRenderer;
    if (!currentFolderPath || !ipc) return;
    if (cleanedGeneratedMaterialFoldersRef.current.has(currentFolderPath)) return;
    cleanedGeneratedMaterialFoldersRef.current.add(currentFolderPath);

    let cancelled = false;
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;

    const cleanupGeneratedDirectories = async () => {
      try {
        const result = (await ipc.invoke(
          'cleanup-empty-generated-material-directories',
          currentFolderPath
        )) as { success: boolean; removed?: string[] };
        if (cancelled || !result?.success) return;
        const removedCount = result.removed?.length || 0;
        if (removedCount === 0) return;
        await refreshCurrentFolderRef.current?.();
        if (!cancelled) {
          toast.info(`已安全清理 ${removedCount} 个历史空资料目录`);
        }
      } catch {
        // 历史目录迁移失败不应阻塞项目打开。
      }
    };

    // 推迟到浏览器空闲再跑：低配机首屏不会被 IPC + 文件扫描拖慢
    const schedule = () => {
      if (cancelled) return;
      void cleanupGeneratedDirectories();
    };
    if (typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(schedule, { timeout: 4000 });
    } else {
      timeoutHandle = window.setTimeout(schedule, 1500);
    }

    return () => {
      cancelled = true;
      if (idleHandle !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
      }
    };
  }, [folderPath, toast]);
}
