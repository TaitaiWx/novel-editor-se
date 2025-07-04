import { BrowserWindow } from 'electron';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 窗口配置
const WINDOW_CONFIG = {
  width: 1400,
  height: 900,
  minWidth: 800,
  minHeight: 600,
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    preload: join(__dirname, 'preload.js'),
    webSecurity: true,
  },
  titleBarStyle: 'default' as const,
  show: false, // 等待页面加载完成后再显示
  title: '小说编辑器',
};

// 创建主窗口
export function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow(WINDOW_CONFIG);

  // 加载应用页面
  mainWindow.loadFile(join(__dirname, 'index.html'));

  // 窗口准备好后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    // 只在开发模式下打开开发者工具
    if (process.env.NODE_ENV === 'development') {
      mainWindow.webContents.openDevTools();
    }
  });

  // 阻止新窗口打开
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  // 阻止导航到外部URL
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);

    if (parsedUrl.origin !== 'file://') {
      event.preventDefault();
    }
  });

  return mainWindow;
}

// 设置应用级别的窗口事件
export function setupWindowEvents() {
  // 可以在这里添加全局窗口事件处理
}
