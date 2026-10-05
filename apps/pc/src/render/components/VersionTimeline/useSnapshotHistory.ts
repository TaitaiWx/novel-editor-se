/**
 * useSnapshotHistory — 加载当前文件的版本快照列表，并在打开时自动加载
 */
import { useState, useEffect, useCallback } from 'react';
import type { SnapshotInfo } from './types';

interface UseSnapshotHistoryOptions {
  visible: boolean;
  folderPath: string | null;
  filePath: string | null;
}

export const useSnapshotHistory = ({
  visible,
  folderPath,
  filePath,
}: UseSnapshotHistoryOptions) => {
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [loading, setLoading] = useState(false);

  // 加载当前文件的版本历史
  const loadHistory = useCallback(async () => {
    if (!folderPath || !visible) return;
    setLoading(true);
    try {
      const snapshotsResult = await window.electron.ipcRenderer.invoke(
        'db-version-list',
        folderPath,
        filePath,
        50
      );
      setSnapshots((snapshotsResult as SnapshotInfo[]) || []);
    } catch {
      setSnapshots([]);
    } finally {
      setLoading(false);
    }
  }, [folderPath, filePath, visible]);

  // 打开时自动加载
  useEffect(() => {
    if (visible && folderPath) {
      loadHistory();
    }
  }, [visible, folderPath, loadHistory]);

  return { snapshots, loading, loadHistory };
};
