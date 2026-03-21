/**
 * Version Snapshot IPC Handlers
 *
 * Handles: create/list/delete/rename/restore snapshots
 */
import { ipcMain } from 'electron';
import { versionOps } from '@novel-editor/store';

interface SnapshotJobState {
  id: string;
  status: 'running' | 'completed' | 'failed';
  stage: 'scanning' | 'persisting' | 'completed' | 'failed';
  discoveredFiles: number;
  processedFiles: number;
  totalFiles: number;
  processedBytes: number;
  totalBytes: number;
  snapshotId: number | null;
  error: string | null;
}

const snapshotJobs = new Map<string, SnapshotJobState>();
let snapshotJobCounter = 0;

function createSnapshotJob(folderPath: string, message?: string): string {
  const id = `snapshot-job-${Date.now()}-${++snapshotJobCounter}`;
  snapshotJobs.set(id, {
    id,
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

  void versionOps
    .createSnapshot(folderPath, message, (progress) => {
      const current = snapshotJobs.get(id);
      if (!current) return;
      snapshotJobs.set(id, {
        ...current,
        stage: progress.stage,
        discoveredFiles: progress.discoveredFiles,
        processedFiles: progress.processedFiles,
        totalFiles: progress.totalFiles,
        processedBytes: progress.processedBytes,
        totalBytes: progress.totalBytes,
      });
    })
    .then((snapshotId) => {
      const current = snapshotJobs.get(id);
      if (!current) return;
      snapshotJobs.set(id, { ...current, status: 'completed', stage: 'completed', snapshotId });
      setTimeout(() => snapshotJobs.delete(id), 60_000);
    })
    .catch((error) => {
      const current = snapshotJobs.get(id);
      if (!current) return;
      snapshotJobs.set(id, {
        ...current,
        status: 'failed',
        stage: 'failed',
        error: error instanceof Error ? error.message : '未知错误',
      });
      setTimeout(() => snapshotJobs.delete(id), 60_000);
    });

  return id;
}

export function registerVersionHandlers(): void {
  ipcMain.handle('db-version-create', async (_event, folderPath: string, message?: string) =>
    versionOps.createSnapshot(folderPath, message)
  );

  ipcMain.handle('db-version-start-create', (_event, folderPath: string, message?: string) =>
    createSnapshotJob(folderPath, message)
  );

  ipcMain.handle(
    'db-version-job-status',
    (_event, jobId: string) => snapshotJobs.get(jobId) || null
  );

  ipcMain.handle(
    'db-version-list',
    (_event, folderPath: string, filePath?: string, limit?: number) =>
      versionOps.listSnapshots(folderPath, filePath, limit)
  );

  ipcMain.handle('db-version-delete', async (_event, snapshotId: number) => {
    versionOps.deleteSnapshot(snapshotId);
    return { success: true };
  });

  ipcMain.handle('db-version-rename', async (_event, snapshotId: number, message: string) => {
    versionOps.renameSnapshot(snapshotId, message);
    return { success: true };
  });

  ipcMain.handle(
    'db-version-get-file-content',
    (_event, folderPath: string, snapshotId: number, filePath: string) =>
      versionOps.getSnapshotFileContent(folderPath, snapshotId, filePath)
  );

  ipcMain.handle(
    'db-version-restore-file',
    async (_event, folderPath: string, snapshotId: number, filePath: string) => {
      await versionOps.restoreFileFromSnapshot(folderPath, snapshotId, filePath);
      return { success: true };
    }
  );
}
