/**
 * File System IPC Handlers
 *
 * Handles: file read/write, directory operations, file watching, clipboard paths
 *
 * 纯文件逻辑统一由 @novel-editor/core 实现（与 CLI 共用同一套代码），
 * 这里只保留 Electron 专属能力（dialog / shell / clipboard / app 路径 / fs.watch 推送）
 * 并负责保持 IPC 通道名、参数与返回结构不变。
 */
import { ipcMain, dialog, BrowserWindow, clipboard as electronClipboard, shell } from 'electron';
import { watch, type FSWatcher, existsSync } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import {
  cleanupEmptyGeneratedMaterialDirectories,
  copyProjectTo,
  createDirectory,
  createFile,
  deleteDirectory,
  deleteFile,
  ensureSeededDirectory,
  getFileInfo,
  getFileInfoBatch,
  isCoreError,
  isStoryFile,
  pastePaths,
  readFileBinary,
  readFolderTree,
  readProjectLayout,
  readTextFileWithEncoding,
  recordStoryFileSave,
  renamePath,
  saveTextFile,
} from '@novel-editor/core';
import { addRecentFolder } from '../recent-folders';
import { getSampleDataPaths } from '../sample-data';
import { getWorkspaceRootForSender } from './session';

// ─── Types ──────────────────────────────────────────────────────────────────

export type { FileNode } from '@novel-editor/core';

// ─── Helpers ────────────────────────────────────────────────────────────────

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 示例数据：用户文档目录下的副本，以及随应用分发的种子目录 */
/** 读取保存前的文件内容；文件不存在（新建）时返回 null */
async function readPreviousContent(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * 读取文件夹树，并附带 `ne init` 项目结构（作品根目录与作品列表，没有配置时为 null），
 * 渲染进程据此按「作品 / 卷 / 章」展示正文，与 CLI 的 `ne novel list` / `ne chapter list` 同一口径
 */
async function readWorkspaceTree(folderPath: string) {
  const tree = await readFolderTree(folderPath);
  const project = await readProjectLayout(folderPath).catch((error: unknown) => {
    console.warn('[project] 读取项目配置失败，按普通文件夹展示:', errorMessage(error));
    return null;
  });
  return { ...tree, project };
}

// ─── File watchers ──────────────────────────────────────────────────────────

const fileWatchers = new Map<string, FSWatcher>();

// ─── Register handlers ─────────────────────────────────────────────────────

export function registerFileSystemHandlers(): void {
  ipcMain.handle('open-local-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择要打开的文件夹',
    });
    if (!result.canceled && result.filePaths.length > 0) {
      const folderPath = result.filePaths[0];
      addRecentFolder(folderPath);
      return readWorkspaceTree(folderPath);
    }
    return null;
  });

  ipcMain.handle('read-file', async (_event, filePath: string, encoding?: string) => {
    try {
      return await readTextFileWithEncoding(filePath, encoding);
    } catch {
      throw new Error(`Failed to read file: ${filePath}`);
    }
  });

  ipcMain.handle('read-file-binary', async (_event, filePath: string) => {
    try {
      return await readFileBinary(filePath);
    } catch {
      throw new Error(`Failed to read binary file: ${filePath}`);
    }
  });

  ipcMain.handle(
    'write-file',
    async (event: { sender?: { id: number } }, filePath: string, content: string) => {
      // 正文文件保存前读取旧内容，用于计算写作日志的字数增量（只读当前文件，不扫描项目）
      const trackWriting = isStoryFile(filePath);
      const previousContent = trackWriting ? await readPreviousContent(filePath) : null;
      try {
        await saveTextFile(filePath, content);
      } catch {
        throw new Error(`Failed to write file: ${filePath}`);
      }
      if (trackWriting) {
        // 与 CLI 共用 core 写作日志（ne stats today/history）；不阻塞保存，失败只打日志
        void recordStoryFileSave({
          path: filePath,
          previousContent,
          content,
          workspaceRoot: getWorkspaceRootForSender(event?.sender?.id),
        })
          .then((results) => {
            for (const result of results) {
              if (result.error) console.warn('[writing-log] record failed:', result.error.message);
            }
          })
          .catch((error) => console.warn('[writing-log] record failed:', errorMessage(error)));
      }
      return { success: true };
    }
  );

  ipcMain.handle('get-file-info', async (_event, filePath: string) => {
    try {
      return await getFileInfo(filePath);
    } catch {
      throw new Error(`Failed to get file info: ${filePath}`);
    }
  });

  ipcMain.handle('get-file-info-batch', (_event, filePaths: string[]) =>
    getFileInfoBatch(filePaths)
  );

  ipcMain.handle('open-in-system-app', async (_event, filePath: string) => {
    try {
      const errorMessage = await shell.openPath(filePath);
      if (errorMessage) throw new Error(errorMessage);
      return { success: true };
    } catch (error) {
      throw new Error(`无法打开文件: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  ipcMain.handle('watch-file', (_event, filePath: string) => {
    if (fileWatchers.has(filePath)) return;
    try {
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      const watcher = watch(filePath, (eventType) => {
        if (eventType !== 'change') return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const win = BrowserWindow.getAllWindows()[0];
          if (win && !win.isDestroyed()) {
            win.webContents.send('file-changed', filePath);
          }
        }, 500);
      });
      watcher.on('error', () => {
        fileWatchers.delete(filePath);
      });
      fileWatchers.set(filePath, watcher);
    } catch {
      // 监视不是核心功能
    }
  });

  ipcMain.handle('unwatch-file', (_event, filePath: string) => {
    const watcher = fileWatchers.get(filePath);
    if (watcher) {
      watcher.close();
      fileWatchers.delete(filePath);
    }
  });

  ipcMain.handle('create-file', async (_event, folderPath: string, fileName: string) => {
    const filePath = path.join(folderPath, fileName);
    try {
      await createFile(filePath);
      return { success: true, filePath };
    } catch (error) {
      const reason =
        isCoreError(error) && error.code === 'ALREADY_EXISTS' ? '文件已存在' : errorMessage(error);
      throw new Error(`Failed to create file: ${reason}`);
    }
  });

  ipcMain.handle('create-directory', async (_event, folderPath: string, dirName: string) => {
    const dirPath = path.join(folderPath, dirName);
    try {
      await createDirectory(dirPath);
      return { success: true, dirPath };
    } catch (error) {
      const reason =
        isCoreError(error) && error.code === 'ALREADY_EXISTS' ? '目录已存在' : errorMessage(error);
      throw new Error(`Failed to create directory: ${reason}`);
    }
  });

  ipcMain.handle('refresh-folder', async (_event, folderPath: string) => {
    try {
      return await readWorkspaceTree(folderPath);
    } catch {
      throw new Error(`Failed to refresh folder: ${folderPath}`);
    }
  });

  ipcMain.handle(
    'cleanup-empty-generated-material-directories',
    async (_event, folderPath: string) => {
      try {
        const removed = await cleanupEmptyGeneratedMaterialDirectories(folderPath);
        return { success: true, removed };
      } catch {
        throw new Error(`Failed to cleanup generated material directories: ${folderPath}`);
      }
    }
  );

  ipcMain.handle('delete-file', async (_event, filePath: string) => {
    try {
      await deleteFile(filePath);
      return { success: true };
    } catch {
      throw new Error(`Failed to delete file: ${filePath}`);
    }
  });

  ipcMain.handle('delete-directory', async (_event, dirPath: string) => {
    try {
      await deleteDirectory(dirPath);
      return { success: true };
    } catch {
      throw new Error(`Failed to delete directory: ${dirPath}`);
    }
  });

  ipcMain.handle('rename-file', async (_event, oldPath: string, newPath: string) => {
    try {
      await renamePath(oldPath, newPath);
      return { success: true, newPath };
    } catch {
      throw new Error(`Failed to rename: ${oldPath}`);
    }
  });

  ipcMain.handle('paste-files', async (_event, sourcePaths: string[], targetDir: string) => {
    try {
      const results = await pastePaths(sourcePaths, targetDir);
      return { success: true, results };
    } catch (error) {
      throw new Error(errorMessage(error));
    }
  });

  ipcMain.handle('read-clipboard-file-paths', (): string[] => {
    try {
      if (process.platform === 'darwin') {
        const plistStr = electronClipboard.read('NSFilenamesPboardType');
        if (plistStr) {
          const paths: string[] = [];
          const regex = /<string>([^<]+)<\/string>/g;
          let match;
          while ((match = regex.exec(plistStr)) !== null) {
            if (match[1] && match[1].startsWith('/')) paths.push(match[1]);
          }
          if (paths.length > 0) return paths;
        }
        const formats = electronClipboard.availableFormats();
        if (formats.some((f) => f.includes('file-url'))) {
          const fileUrl = electronClipboard.read('public.file-url');
          if (fileUrl?.startsWith('file://')) {
            const filePath = decodeURIComponent(new URL(fileUrl).pathname);
            return [filePath];
          }
        }
      }
      if (process.platform === 'win32') {
        const text = electronClipboard.readText();
        if (text) {
          const lines = text
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l.length > 0 && (l.startsWith('/') || /^[A-Za-z]:\\/.test(l)));
          if (lines.length > 0) return lines;
        }
      }
    } catch {
      // 静默降级
    }
    return [];
  });

  ipcMain.handle('get-default-data-path', async () => {
    try {
      const { userSamplePath, sourcePath } = getSampleDataPaths();
      return await ensureSeededDirectory(userSamplePath, sourcePath);
    } catch {
      throw new Error('Failed to get default data path');
    }
  });

  ipcMain.handle('open-sample-data', async () => {
    const { userSamplePath, sourcePath } = getSampleDataPaths();
    return ensureSeededDirectory(userSamplePath, sourcePath);
  });

  ipcMain.handle('export-project', async (_event, folderPath: string) => {
    if (!existsSync(folderPath)) {
      return { success: false, error: '项目目录不存在' };
    }
    const result = await dialog.showOpenDialog({
      title: '选择导出位置',
      buttonLabel: '导出到此处',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    try {
      const destPath = await copyProjectTo(folderPath, result.filePaths[0]);
      return { success: true, destPath };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  });
}
