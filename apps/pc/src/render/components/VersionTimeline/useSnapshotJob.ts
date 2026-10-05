/**
 * useSnapshotJob — 创建版本快照任务并轮询进度
 */
import { useState, useCallback, useRef } from 'react';
import { useToast } from '../Toast';
import type { SnapshotJobStatus } from './types';

interface UseSnapshotJobOptions {
  folderPath: string | null;
  loadHistory: () => Promise<void>;
}

export const useSnapshotJob = ({ folderPath, loadHistory }: UseSnapshotJobOptions) => {
  const [snapshotJob, setSnapshotJob] = useState<SnapshotJobStatus | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const toast = useToast();

  const pollSnapshotJob = useCallback(
    async (jobId: string) => {
      try {
        const status = (await window.electron.ipcRenderer.invoke(
          'db-version-job-status',
          jobId
        )) as SnapshotJobStatus | null;
        if (!status) {
          setSnapshotJob(null);
          return;
        }

        setSnapshotJob(status);

        if (status.status === 'running') {
          pollTimerRef.current = window.setTimeout(() => {
            void pollSnapshotJob(jobId);
          }, 250);
          return;
        }

        pollTimerRef.current = null;
        if (status.status === 'completed') {
          if (status.snapshotId) {
            toast.success('版本保存成功');
            await loadHistory();
          } else {
            toast.info('当前没有新的更改需要保存');
          }
        } else if (status.error) {
          toast.error(`保存版本失败: ${status.error}`);
        }
      } catch (err) {
        pollTimerRef.current = null;
        setSnapshotJob(null);
        toast.error(`保存版本失败: ${err instanceof Error ? err.message : '未知错误'}`);
      }
    },
    [loadHistory, toast]
  );

  const handleCreateSnapshot = useCallback(async () => {
    if (!folderPath) return;
    try {
      const jobId = (await window.electron.ipcRenderer.invoke(
        'db-version-start-create',
        folderPath
      )) as string;
      setSnapshotJob({
        id: jobId,
        status: 'running',
        stage: 'scanning',
        discoveredFiles: 0,
        processedFiles: 0,
        totalFiles: 0,
        processedBytes: 0,
        totalBytes: 0,
        snapshotId: null,
        error: null,
      });
      void pollSnapshotJob(jobId);
    } catch (err) {
      toast.error(`保存版本失败: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  }, [folderPath, pollSnapshotJob, toast]);

  return { snapshotJob, setSnapshotJob, pollTimerRef, handleCreateSnapshot };
};
