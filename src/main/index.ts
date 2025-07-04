import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dirTree from 'directory-tree';
import { readFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 设置安全恢复状态支持
(app as any).applicationSupportsSecureRestorableState = () => true;

// 创建Electron窗口
function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload.mjs'),
      webSecurity: true,
    },
    titleBarStyle: 'default',
    show: false, // 等待页面加载完成后再显示
  });

  // 总是加载本地文件，不使用开发服务器
  mainWindow.loadFile(join(__dirname, 'index.html'));

  // 窗口准备好后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    // 只在开发模式下打开开发者工具
    if (process.env.NODE_ENV === 'development') {
      mainWindow.webContents.openDevTools();
    }
  });

  // 设置IPC通信
  setupIPC();
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

// 设置IPC通信
function setupIPC() {
  // 打开本地文件夹
  ipcMain.handle('open-local-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const folderPath = result.filePaths[0];
      const tree = dirTree(folderPath, {
        exclude: /node_modules|\.git/,
        attributes: ['type'],
      });

      return {
        path: folderPath,
        files: tree?.children ? tree?.children?.map(convertTreeFormat) : [],
      };
    }
    return null;
  });

  // 读取文件内容
  ipcMain.handle('read-file', async (event, filePath) => {
    try {
      const content = await readFile(filePath, 'utf-8');
      return content;
    } catch (error) {
      console.error('Error reading file:', error);
      throw error;
    }
  });
}

// 应用准备就绪时创建窗口
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 所有窗口关闭时退出应用
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 类型定义
interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}
