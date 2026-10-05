/**
 * useSnapshotActions — 版本条目操作：删除、重命名、查看对比/预览、恢复
 */
import type React from 'react';
import { useCallback } from 'react';
import { useToast } from '../Toast';
import { useDialog } from '../Dialog';
import type {
  BinaryReadResult,
  DiffRequestHandler,
  PreviewState,
  RestoreFileHandler,
  SnapshotFileContent,
  SnapshotInfo,
} from './types';
import { buildBinaryPreviewState, buildSvgPreviewState } from './utils';

interface UseSnapshotActionsOptions {
  folderPath: string | null;
  filePath: string | null;
  onClose: () => void;
  onDiffRequest?: DiffRequestHandler;
  onRestoreFile?: RestoreFileHandler;
  loadHistory: () => Promise<void>;
  setPreviewState: React.Dispatch<React.SetStateAction<PreviewState | null>>;
}

export const useSnapshotActions = ({
  folderPath,
  filePath,
  onClose,
  onDiffRequest,
  onRestoreFile,
  loadHistory,
  setPreviewState,
}: UseSnapshotActionsOptions) => {
  const toast = useToast();
  const dialog = useDialog();

  const loadCurrentBinaryFile = useCallback(async () => {
    if (!filePath) {
      return null;
    }

    try {
      return (await window.electron.ipcRenderer.invoke(
        'read-file-binary',
        filePath
      )) as BinaryReadResult;
    } catch {
      return null;
    }
  }, [filePath]);

  const handleDeleteCommit = useCallback(
    async (snapshot: SnapshotInfo, e: React.MouseEvent) => {
      e.stopPropagation();
      const confirmed = await dialog.confirm(
        '删除版本',
        `确定要删除版本 "${snapshot.message}" 吗？此操作不可撤销。`
      );
      if (!confirmed) return;
      try {
        await window.electron.ipcRenderer.invoke('db-version-delete', snapshot.id);
        toast.success('版本已删除');
        loadHistory();
      } catch (err) {
        toast.error(`删除版本失败: ${err instanceof Error ? err.message : '未知错误'}`);
      }
    },
    [dialog, toast, loadHistory]
  );

  const handleRenameCommit = useCallback(
    async (snapshot: SnapshotInfo, e: React.MouseEvent) => {
      e.stopPropagation();
      const newMessage = await dialog.prompt('重命名版本', '请输入新的版本名称', snapshot.message);
      if (!newMessage || newMessage === snapshot.message) return;
      try {
        await window.electron.ipcRenderer.invoke('db-version-rename', snapshot.id, newMessage);
        toast.success('版本已重命名');
        loadHistory();
      } catch (err) {
        toast.error(`重命名失败: ${err instanceof Error ? err.message : '未知错误'}`);
      }
    },
    [dialog, toast, loadHistory]
  );

  const handleViewDiff = useCallback(
    async (snapshot: SnapshotInfo) => {
      if (!folderPath || !filePath) return;
      try {
        const snapshotFile = (await window.electron.ipcRenderer.invoke(
          'db-version-get-file-content',
          folderPath,
          snapshot.id,
          filePath
        )) as SnapshotFileContent;

        if (snapshotFile.mimeType === 'image/svg+xml' && snapshotFile.content !== null) {
          let currentSvgContent: string | null = null;
          try {
            currentSvgContent = (await window.electron.ipcRenderer.invoke(
              'read-file',
              filePath
            )) as string;
          } catch {
            currentSvgContent = null;
          }

          setPreviewState(
            buildSvgPreviewState(
              snapshot,
              { ...snapshotFile, content: snapshotFile.content },
              currentSvgContent
            )
          );
          return;
        }

        if (snapshotFile.isBinary || snapshotFile.content === null) {
          const currentBinary = await loadCurrentBinaryFile();
          setPreviewState(buildBinaryPreviewState(snapshot, snapshotFile, currentBinary));
          return;
        }
        if (!onDiffRequest) return;
        const currentContent = await window.electron.ipcRenderer.invoke('read-file', filePath);
        onDiffRequest(snapshotFile.content, currentContent, snapshot.message, '当前版本');
        toast.success('版本对比已加载');
        onClose();
      } catch (err) {
        toast.error(`加载版本失败: ${err instanceof Error ? err.message : '未知错误'}`);
      }
    },
    // filePath 原先遗漏于依赖数组（通过 loadCurrentBinaryFile 间接覆盖），此处显式补上
    [folderPath, filePath, loadCurrentBinaryFile, onDiffRequest, toast, onClose, setPreviewState]
  );

  const handleRestoreSnapshot = useCallback(
    async (snapshot: SnapshotInfo, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!folderPath || !filePath) return;
      const confirmed = await dialog.confirm(
        '恢复当前文件',
        `确定要将当前文件恢复到版本「${snapshot.message}」吗？当前未提交更改会被覆盖。`
      );
      if (!confirmed) return;

      try {
        await window.electron.ipcRenderer.invoke(
          'db-version-restore-file',
          folderPath,
          snapshot.id,
          filePath
        );
        await onRestoreFile?.(filePath);
        setPreviewState(null);
        toast.success('已恢复到所选版本');
      } catch (err) {
        toast.error(`恢复版本失败: ${err instanceof Error ? err.message : '未知错误'}`);
      }
    },
    [dialog, filePath, folderPath, onRestoreFile, toast, setPreviewState]
  );

  return { handleDeleteCommit, handleRenameCommit, handleViewDiff, handleRestoreSnapshot };
};
