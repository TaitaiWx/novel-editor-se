import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import dirTree from 'directory-tree';
import { readFile, writeFile, mkdir, access, cp } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { addRecentFolder, getLastFolder, getRecentFolders } from './recent-folders';

// ========== better-sqlite3 原生模块路径解析 ==========
// 打包后的 Electron 应用无法通过 bindings 模块自动定位 .node 文件，
// 通过显式指定 nativeBinding 路径绕过 bindings 解析。
let _nativeBinding: string | undefined;
let _nativeBindingResolved = false;

function getNativeBinding(): string | undefined {
  if (_nativeBindingResolved) return _nativeBinding;
  _nativeBindingResolved = true;

  if (!app.isPackaged) return undefined;

  // asarUnpack 会将 better-sqlite3 解压到 app.asar.unpacked 目录
  const unpackedPath = app.getAppPath() + '.unpacked';
  const bindingPath = path.join(
    unpackedPath,
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node'
  );

  if (existsSync(bindingPath)) {
    _nativeBinding = bindingPath;
  } else {
    console.warn('better-sqlite3 native binding not found at:', bindingPath);
  }

  return _nativeBinding;
}
import { getAllShortcuts } from './shortcuts/getAllShortcuts';
import { importFile, SUPPORTED_IMPORT_EXTENSIONS } from './file-importer';
import { getDeviceId } from './device-id';
import {
  checkForUpdatesManually,
  downloadUpdate,
  getUpdateStatus,
  installUpdate,
  rollbackToPreviousVersion,
  setUpdateChannel,
} from './auto-updater';
import type { UpdateChannel } from './auto-updater';
import {
  initDatabase,
  closeDatabase,
  novelOps,
  characterOps,
  statsOps,
  settingsOps,
  exportAllData,
  importData,
  versionOps,
  type ExportData,
} from '@novel-editor/store';

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
      snapshotJobs.set(id, {
        ...current,
        status: 'completed',
        stage: 'completed',
        snapshotId,
      });
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

// 类型定义
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

// 转换目录树结构
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

// 设置IPC通信处理程序
export function setupIPC() {
  // 打开本地文件夹
  ipcMain.handle('open-local-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择要打开的文件夹',
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const folderPath = result.filePaths[0];
      addRecentFolder(folderPath);
      const tree = dirTree(folderPath, {
        exclude: /node_modules|\.git|\.novel-editor|\.vscode|\.DS_Store|dist|build|out/,
        attributes: ['type'],
      });

      return {
        path: folderPath,
        files: tree?.children ? tree?.children?.map(convertTreeFormat) : [],
      };
    }
    return null;
  });

  // 读取文件内容（支持指定编码）
  ipcMain.handle('read-file', async (event, filePath: string, encoding?: string) => {
    try {
      if (encoding && encoding.toUpperCase() !== 'UTF-8') {
        const buffer = await readFile(filePath);
        const decoder = new TextDecoder(encoding.toLowerCase());
        return decoder.decode(buffer);
      }
      return await readFile(filePath, 'utf-8');
    } catch (error) {
      console.error('Error reading file:', error);
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
    } catch (error) {
      console.error('Error reading binary file:', error);
      throw new Error(`Failed to read binary file: ${filePath}`);
    }
  });

  // 写入文件内容
  ipcMain.handle('write-file', async (event, filePath: string, content: string) => {
    try {
      await writeFile(filePath, content, 'utf-8');
      return { success: true };
    } catch (error) {
      console.error('Error writing file:', error);
      throw new Error(`Failed to write file: ${filePath}`);
    }
  });

  // 获取文件信息
  ipcMain.handle('get-file-info', async (event, filePath: string) => {
    try {
      const { stat } = await import('fs/promises');
      const stats = await stat(filePath);

      return {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
      };
    } catch (error) {
      console.error('Error getting file info:', error);
      throw new Error(`Failed to get file info: ${filePath}`);
    }
  });

  // 获取默认示例数据目录（首次启动时复制到用户文档目录，确保可写）
  ipcMain.handle('get-default-data-path', async () => {
    try {
      const userDataDir = path.join(app.getPath('documents'), 'Novel Editor');
      const userSamplePath = path.join(userDataDir, 'sample-data');

      // 已复制到用户目录，直接返回
      try {
        await access(userSamplePath);
        return userSamplePath;
      } catch {
        // 尚未复制，继续
      }

      // 定位源 sample-data 目录
      let sourcePath: string;
      if (app.isPackaged) {
        sourcePath = path.join(process.resourcesPath, 'sample-data');
      } else {
        const appRoot = path.resolve(app.getAppPath(), '..');
        sourcePath = path.join(appRoot, 'sample-data');
      }

      // 复制 sample-data 到用户目录
      try {
        await access(sourcePath);
        await mkdir(userDataDir, { recursive: true });
        await cp(sourcePath, userSamplePath, { recursive: true });
      } catch {
        // 源目录不存在时创建空目录
        await mkdir(userSamplePath, { recursive: true });
      }

      return userSamplePath;
    } catch (error) {
      console.error('Error creating/getting sample-data path:', error);
      throw new Error('Failed to get default data path');
    }
  });

  // 最近打开的文件夹
  ipcMain.handle('get-recent-folders', () => getRecentFolders());
  ipcMain.handle('get-last-folder', () => getLastFolder());
  ipcMain.handle('add-recent-folder', (_event, folderPath: string) => {
    addRecentFolder(folderPath);
  });

  // 打开示例项目（返回 sample-data 路径）
  ipcMain.handle('open-sample-data', async () => {
    const userDataDir = path.join(app.getPath('documents'), 'Novel Editor');
    const userSamplePath = path.join(userDataDir, 'sample-data');

    // 确保 sample-data 已复制到用户目录
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

  // 创建新文件
  ipcMain.handle('create-file', async (event, folderPath: string, fileName: string) => {
    try {
      const filePath = path.join(folderPath, fileName);

      // 检查文件是否已存在
      try {
        await access(filePath);
        throw new Error('文件已存在');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }

      // 创建空文件
      await writeFile(filePath, '', 'utf-8');

      return { success: true, filePath };
    } catch (error) {
      console.error('Error creating file:', error);
      throw new Error(
        `Failed to create file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });

  // 创建新目录
  ipcMain.handle('create-directory', async (event, folderPath: string, dirName: string) => {
    try {
      const dirPath = path.join(folderPath, dirName);

      // 检查目录是否已存在
      try {
        await access(dirPath);
        throw new Error('目录已存在');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }

      // 创建目录
      await mkdir(dirPath, { recursive: true });

      return { success: true, dirPath };
    } catch (error) {
      console.error('Error creating directory:', error);
      throw new Error(
        `Failed to create directory: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });

  // 刷新文件夹内容
  ipcMain.handle('refresh-folder', async (event, folderPath: string) => {
    try {
      const tree = dirTree(folderPath, {
        exclude: /node_modules|\.git|\.novel-editor|\.vscode|\.DS_Store|dist|build|out/,
        attributes: ['type'],
      });

      return {
        path: folderPath,
        files: tree?.children ? tree?.children?.map(convertTreeFormat) : [],
      };
    } catch (error) {
      console.error('Error refreshing folder:', error);
      throw new Error(`Failed to refresh folder: ${folderPath}`);
    }
  });

  // 窗口控制方法
  ipcMain.handle('window-minimize', () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.minimize();
    }
  });

  ipcMain.handle('window-maximize', () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
    }
  });

  ipcMain.handle('window-close', () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.close();
    }
  });

  ipcMain.handle('window-is-maximized', () => {
    const window = BrowserWindow.getFocusedWindow();
    return window ? window.isMaximized() : false;
  });

  // 键盘快捷键相关的IPC处理
  ipcMain.handle('app-quit', () => {
    app.quit();
  });

  ipcMain.handle('dev-tools-toggle', () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      if (window.webContents.isDevToolsOpened()) {
        window.webContents.closeDevTools();
      } else {
        window.webContents.openDevTools();
      }
    }
  });

  ipcMain.handle('window-toggle-fullscreen', () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.setFullScreen(!window.isFullScreen());
    }
  });

  // 获取所有快捷键列表
  ipcMain.handle('get-shortcuts', () => {
    return getAllShortcuts();
  });

  // 获取应用版本号
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  // 获取设备唯一标识
  ipcMain.handle('get-device-id', () => {
    return getDeviceId();
  });

  // 自动更新相关
  ipcMain.handle('update-download', () => downloadUpdate());

  ipcMain.handle('update-install', () => installUpdate());

  ipcMain.handle('update-check', () => checkForUpdatesManually());

  ipcMain.handle('update-status', () => getUpdateStatus());

  ipcMain.handle('update-set-channel', (_event, channel: UpdateChannel) =>
    setUpdateChannel(channel)
  );

  ipcMain.handle('update-rollback', () => rollbackToPreviousVersion());

  // 删除文件
  ipcMain.handle('delete-file', async (event, filePath: string) => {
    try {
      const { unlink } = await import('fs/promises');
      await unlink(filePath);
      return { success: true };
    } catch (error) {
      console.error('Error deleting file:', error);
      throw new Error(`Failed to delete file: ${filePath}`);
    }
  });

  // 删除目录
  ipcMain.handle('delete-directory', async (event, dirPath: string) => {
    try {
      const { rm } = await import('fs/promises');
      await rm(dirPath, { recursive: true });
      return { success: true };
    } catch (error) {
      console.error('Error deleting directory:', error);
      throw new Error(`Failed to delete directory: ${dirPath}`);
    }
  });

  // 重命名文件或目录
  ipcMain.handle('rename-file', async (event, oldPath: string, newPath: string) => {
    try {
      const { rename } = await import('fs/promises');
      await rename(oldPath, newPath);
      return { success: true, newPath };
    } catch (error) {
      console.error('Error renaming:', error);
      throw new Error(`Failed to rename: ${oldPath}`);
    }
  });

  // ========== SQLite 数据库 IPC ==========

  // 初始化数据库
  ipcMain.handle('db-init', (_event, dbDir: string) => {
    try {
      initDatabase(dbDir, 'novel-editor.db', getNativeBinding());
      return { success: true };
    } catch (error) {
      console.error('Error initializing database:', error);
      throw error;
    }
  });

  // 初始化默认数据库（开箱即用模式，无需打开目录）
  ipcMain.handle('db-init-default', () => {
    try {
      const defaultDbDir = path.join(app.getPath('userData'), '.novel-editor');
      initDatabase(defaultDbDir, 'novel-editor.db', getNativeBinding());
      return { success: true, dbDir: defaultDbDir };
    } catch (error) {
      console.error('Error initializing default database:', error);
      throw error;
    }
  });

  // 关闭数据库
  ipcMain.handle('db-close', () => {
    closeDatabase();
    return { success: true };
  });

  // 小说 CRUD
  ipcMain.handle(
    'db-novel-create',
    (_event, name: string, folderPath: string, description?: string) => {
      return novelOps.create(name, folderPath, description);
    }
  );
  ipcMain.handle('db-novel-list', () => novelOps.getAll());
  ipcMain.handle('db-novel-get', (_event, id: number) => novelOps.getById(id));
  ipcMain.handle('db-novel-get-by-folder', (_event, folderPath: string) =>
    novelOps.getByFolder(folderPath)
  );
  ipcMain.handle(
    'db-novel-update',
    (_event, id: number, fields: { name?: string; description?: string }) =>
      novelOps.update(id, fields)
  );
  ipcMain.handle('db-novel-delete', (_event, id: number) => novelOps.delete(id));

  // 角色 CRUD
  ipcMain.handle(
    'db-character-create',
    (
      _event,
      novelId: number,
      name: string,
      role?: string,
      description?: string,
      attributes?: string
    ) => characterOps.create(novelId, name, role, description, attributes)
  );
  ipcMain.handle('db-character-list', (_event, novelId: number) =>
    characterOps.getByNovel(novelId)
  );
  ipcMain.handle(
    'db-character-update',
    (
      _event,
      id: number,
      fields: { name?: string; role?: string; description?: string; attributes?: string }
    ) => characterOps.update(id, fields)
  );
  ipcMain.handle('db-character-reorder', (_event, ids: number[]) => characterOps.reorder(ids));
  ipcMain.handle('db-character-delete', (_event, id: number) => characterOps.delete(id));

  // 写作统计
  ipcMain.handle(
    'db-stats-record',
    (_event, novelId: number, date: string, wordCount: number, durationSeconds: number) =>
      statsOps.record(novelId, date, wordCount, durationSeconds)
  );
  ipcMain.handle('db-stats-range', (_event, novelId: number, startDate: string, endDate: string) =>
    statsOps.getByNovelAndRange(novelId, startDate, endDate)
  );
  ipcMain.handle('db-stats-today', (_event, novelId: number) => statsOps.getToday(novelId));

  // 设置
  ipcMain.handle('db-settings-get', (_event, key: string) => settingsOps.get(key));
  ipcMain.handle('db-settings-set', (_event, key: string, value: string) =>
    settingsOps.set(key, value)
  );
  ipcMain.handle('db-settings-all', () => settingsOps.getAll());

  // 数据导出/导入
  ipcMain.handle('db-export', () => exportAllData());
  ipcMain.handle('db-import', (_event, data: ExportData) => {
    importData(data);
    return { success: true };
  });

  // 导出到文件
  ipcMain.handle('db-export-to-file', async () => {
    const result = await dialog.showSaveDialog({
      title: '导出数据',
      defaultPath: `novel-editor-export-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const data = exportAllData();
    await writeFile(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
    return result.filePath;
  });

  // 从文件导入
  ipcMain.handle('db-import-from-file', async () => {
    const result = await dialog.showOpenDialog({
      title: '导入数据',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const content = await readFile(result.filePaths[0], 'utf-8');
    const data = JSON.parse(content) as ExportData;
    importData(data);
    return { success: true, filePath: result.filePaths[0] };
  });

  // ========== SQLite 版本快照 IPC ==========

  ipcMain.handle('db-version-create', async (_event, folderPath: string, message?: string) => {
    return versionOps.createSnapshot(folderPath, message);
  });

  ipcMain.handle('db-version-start-create', (_event, folderPath: string, message?: string) => {
    return createSnapshotJob(folderPath, message);
  });

  ipcMain.handle('db-version-job-status', (_event, jobId: string) => {
    return snapshotJobs.get(jobId) || null;
  });

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

  // ========== 文件导入（Word / Excel → Markdown） ==========

  ipcMain.handle('import-file', async () => {
    const result = await dialog.showOpenDialog({
      title: '导入文件',
      filters: [
        { name: 'Word / Excel', extensions: SUPPORTED_IMPORT_EXTENSIONS.map((e) => e.slice(1)) },
      ],
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const previews: { fileName: string; content: string; sourcePath: string }[] = [];
    const errors: { filePath: string; error: string }[] = [];

    for (const srcPath of result.filePaths) {
      try {
        const { fileName, content } = await importFile(srcPath);
        previews.push({ fileName, content, sourcePath: srcPath });
      } catch (error) {
        errors.push({
          filePath: srcPath,
          error: error instanceof Error ? error.message : '未知错误',
        });
      }
    }

    return { previews, errors };
  });
}
