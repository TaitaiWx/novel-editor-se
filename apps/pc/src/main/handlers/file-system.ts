/**
 * File System IPC Handlers
 *
 * Handles: file read/write, directory operations, file watching, clipboard paths
 */
import {
  ipcMain,
  dialog,
  BrowserWindow,
  app,
  clipboard as electronClipboard,
  shell,
} from 'electron';
import { watch, type FSWatcher, existsSync } from 'fs';
import {
  readFile,
  writeFile,
  mkdir,
  access,
  cp,
  stat,
  unlink,
  rm,
  rename,
  copyFile,
  realpath,
} from 'fs/promises';
import path from 'path';
import dirTree from 'directory-tree';
import { addRecentFolder } from '../recent-folders';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function convertTreeFormat(node: dirTree.DirectoryTree): FileNode {
  return {
    name: node.name,
    path: node.path,
    type: node.type === 'directory' ? 'directory' : 'file',
    ...(node?.children && { children: node?.children?.map(convertTreeFormat) }),
  };
}

function guessMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeByExt: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
  };
  return mimeByExt[ext] || 'application/octet-stream';
}

const DIR_EXCLUDE = /node_modules|\.git|\.novel-editor|\.vscode|\.DS_Store|dist|build|out/;

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
      const tree = dirTree(folderPath, {
        exclude: DIR_EXCLUDE,
        attributes: ['type'],
      });
      return {
        path: folderPath,
        files: tree?.children ? tree?.children?.map(convertTreeFormat) : [],
      };
    }
    return null;
  });

  ipcMain.handle('read-file', async (_event, filePath: string, encoding?: string) => {
    try {
      if (encoding && encoding.toUpperCase() !== 'UTF-8') {
        const buffer = await readFile(filePath);
        const decoder = new TextDecoder(encoding.toLowerCase());
        return decoder.decode(buffer);
      }
      return await readFile(filePath, 'utf-8');
    } catch {
      throw new Error(`Failed to read file: ${filePath}`);
    }
  });

  ipcMain.handle('read-file-binary', async (_event, filePath: string) => {
    try {
      const buffer = await readFile(filePath);
      return {
        base64Content: buffer.toString('base64'),
        byteSize: buffer.byteLength,
        mimeType: guessMimeType(filePath),
      };
    } catch {
      throw new Error(`Failed to read binary file: ${filePath}`);
    }
  });

  ipcMain.handle('write-file', async (_event, filePath: string, content: string) => {
    try {
      await writeFile(filePath, content, 'utf-8');
      return { success: true };
    } catch {
      throw new Error(`Failed to write file: ${filePath}`);
    }
  });

  ipcMain.handle('get-file-info', async (_event, filePath: string) => {
    try {
      const stats = await stat(filePath);
      return {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
      };
    } catch {
      throw new Error(`Failed to get file info: ${filePath}`);
    }
  });

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
    try {
      const filePath = path.join(folderPath, fileName);
      try {
        await access(filePath);
        throw new Error('文件已存在');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await writeFile(filePath, '', 'utf-8');
      return { success: true, filePath };
    } catch (error) {
      throw new Error(
        `Failed to create file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });

  ipcMain.handle('create-directory', async (_event, folderPath: string, dirName: string) => {
    try {
      const dirPath = path.join(folderPath, dirName);
      try {
        await access(dirPath);
        throw new Error('目录已存在');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await mkdir(dirPath, { recursive: true });
      return { success: true, dirPath };
    } catch (error) {
      throw new Error(
        `Failed to create directory: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });

  ipcMain.handle('refresh-folder', async (_event, folderPath: string) => {
    try {
      const tree = dirTree(folderPath, {
        exclude: DIR_EXCLUDE,
        attributes: ['type'],
      });
      return {
        path: folderPath,
        files: tree?.children ? tree?.children?.map(convertTreeFormat) : [],
      };
    } catch {
      throw new Error(`Failed to refresh folder: ${folderPath}`);
    }
  });

  ipcMain.handle('delete-file', async (_event, filePath: string) => {
    try {
      await unlink(filePath);
      return { success: true };
    } catch {
      throw new Error(`Failed to delete file: ${filePath}`);
    }
  });

  ipcMain.handle('delete-directory', async (_event, dirPath: string) => {
    try {
      await rm(dirPath, { recursive: true });
      return { success: true };
    } catch {
      throw new Error(`Failed to delete directory: ${dirPath}`);
    }
  });

  ipcMain.handle('rename-file', async (_event, oldPath: string, newPath: string) => {
    try {
      await rename(oldPath, newPath);
      return { success: true, newPath };
    } catch {
      throw new Error(`Failed to rename: ${oldPath}`);
    }
  });

  ipcMain.handle('paste-files', async (_event, sourcePaths: string[], targetDir: string) => {
    const results: { source: string; dest: string }[] = [];
    if (!existsSync(targetDir)) {
      throw new Error(`目标目录不存在: ${path.basename(targetDir)}`);
    }

    for (const sourcePath of sourcePaths) {
      if (!existsSync(sourcePath)) {
        throw new Error(`源文件不存在: ${path.basename(sourcePath)}`);
      }

      const baseName = path.basename(sourcePath);
      const srcStat = await stat(sourcePath);
      const isDir = srcStat.isDirectory();

      let destPath = path.join(targetDir, baseName);
      let needsRename = false;
      if (existsSync(destPath)) {
        needsRename = true;
      } else {
        const srcReal = await realpath(sourcePath);
        const parentReal = await realpath(targetDir);
        if (path.dirname(srcReal) === parentReal && path.basename(srcReal) === baseName) {
          needsRename = true;
        }
      }

      if (needsRename) {
        const ext = path.extname(baseName);
        const nameWithoutExt = ext ? baseName.slice(0, -ext.length) : baseName;
        destPath = path.join(
          targetDir,
          isDir ? `${baseName} copy` : `${nameWithoutExt} copy${ext}`
        );
        let counter = 2;
        while (existsSync(destPath)) {
          destPath = path.join(
            targetDir,
            isDir ? `${baseName} copy ${counter}` : `${nameWithoutExt} copy ${counter}${ext}`
          );
          counter++;
        }
      }

      try {
        if (isDir) {
          await cp(sourcePath, destPath, { recursive: true });
        } else {
          await copyFile(sourcePath, destPath);
        }
        results.push({ source: sourcePath, dest: destPath });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(`粘贴失败 (${baseName}): ${msg}`);
      }
    }

    return { success: true, results };
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
      const userDataDir = path.join(app.getPath('documents'), 'Novel Editor');
      const userSamplePath = path.join(userDataDir, 'sample-data');
      try {
        await access(userSamplePath);
        return userSamplePath;
      } catch {
        // 尚未复制
      }

      let sourcePath: string;
      if (app.isPackaged) {
        sourcePath = path.join(process.resourcesPath, 'sample-data');
      } else {
        const appRoot = path.resolve(app.getAppPath(), '..');
        sourcePath = path.join(appRoot, 'sample-data');
      }
      try {
        await access(sourcePath);
        await mkdir(userDataDir, { recursive: true });
        await cp(sourcePath, userSamplePath, { recursive: true });
      } catch {
        await mkdir(userSamplePath, { recursive: true });
      }
      return userSamplePath;
    } catch {
      throw new Error('Failed to get default data path');
    }
  });

  ipcMain.handle('open-sample-data', async () => {
    const userDataDir = path.join(app.getPath('documents'), 'Novel Editor');
    const userSamplePath = path.join(userDataDir, 'sample-data');
    try {
      await access(userSamplePath);
    } catch {
      let sourcePath: string;
      if (app.isPackaged) {
        sourcePath = path.join(process.resourcesPath, 'sample-data');
      } else {
        const appRoot = path.resolve(app.getAppPath(), '..');
        sourcePath = path.join(appRoot, 'sample-data');
      }
      try {
        await access(sourcePath);
        await mkdir(userDataDir, { recursive: true });
        await cp(sourcePath, userSamplePath, { recursive: true });
      } catch {
        await mkdir(userSamplePath, { recursive: true });
      }
    }
    return userSamplePath;
  });

  ipcMain.handle('export-project', async (_event, folderPath: string) => {
    if (!existsSync(folderPath)) {
      return { success: false, error: '项目目录不存在' };
    }
    const projectName = path.basename(folderPath);
    const result = await dialog.showOpenDialog({
      title: '选择导出位置',
      buttonLabel: '导出到此处',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const destDir = path.join(result.filePaths[0], projectName);
    let finalDest = destDir;
    if (existsSync(finalDest)) {
      let counter = 2;
      while (existsSync(`${destDir} (${counter})`)) counter++;
      finalDest = `${destDir} (${counter})`;
    }
    try {
      await cp(folderPath, finalDest, { recursive: true });
      return { success: true, destPath: finalDest };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  });
}
