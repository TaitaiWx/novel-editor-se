import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import dirTree from 'directory-tree';
import { readFile, writeFile, mkdir, access } from 'fs/promises';
import path from 'path';
import { getAllShortcuts } from './shortcuts/getAllShortcuts';
import { downloadUpdate, installUpdate } from './auto-updater';
import {
  initDatabase,
  closeDatabase,
  novelOps,
  characterOps,
  statsOps,
  settingsOps,
  exportAllData,
  importData,
  type ExportData,
} from '@novel-editor/store';

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
      const tree = dirTree(folderPath, {
        exclude: /node_modules|\.git|\.vscode|\.DS_Store|dist|build|out/,
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

  // 获取默认示例数据目录
  ipcMain.handle('get-default-data-path', async () => {
    try {
      let sampleDataPath: string;

      if (app.isPackaged) {
        // 打包后: resources 目录
        sampleDataPath = path.join(
          path.dirname(app.getPath('exe')),
          '..',
          'Resources',
          'sample-data'
        );
      } else {
        // 开发模式: app.getAppPath() 指向 apps/pc，向上两级到 monorepo root
        const monorepoRoot = path.resolve(app.getAppPath(), '..', '..');
        sampleDataPath = path.join(monorepoRoot, 'sample-data');
      }

      // 如果 sample-data 目录不存在，创建它
      try {
        await access(sampleDataPath);
      } catch {
        await mkdir(sampleDataPath, { recursive: true });
      }

      return sampleDataPath;
    } catch (error) {
      console.error('Error creating/getting sample-data path:', error);
      throw new Error('Failed to get default data path');
    }
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
        exclude: /node_modules|\.git|\.vscode|\.DS_Store|dist|build|out/,
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

  // 自动更新相关
  ipcMain.handle('update-download', () => {
    downloadUpdate();
  });

  ipcMain.handle('update-install', () => {
    installUpdate();
  });

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
      initDatabase(dbDir);
      return { success: true };
    } catch (error) {
      console.error('Error initializing database:', error);
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
    (_event, novelId: number, name: string, role?: string, description?: string) =>
      characterOps.create(novelId, name, role, description)
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
}
