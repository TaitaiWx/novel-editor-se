import { app, BrowserWindow, nativeImage } from 'electron';
import { existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { closeSplashWindow } from './static/splash/splash-window';
import { isRendererDevServerEnabled, loadRendererPage } from './renderer-entry';
import { getCurrentRuntimeDistDir } from './runtime-context';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
let mainWindowRef: BrowserWindow | null = null;
let mainWindowReadyToShow = false;
let mainWindowRendererReady = false;

function revealMainWindowIfReady() {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
  if (!mainWindowReadyToShow || !mainWindowRendererReady) return;

  if (!mainWindowRef.isVisible()) {
    mainWindowRef.show();
  }
  closeSplashWindow();

  if (
    (isRendererDevServerEnabled() || process.env.NODE_ENV === 'development') &&
    !mainWindowRef.webContents.isDevToolsOpened()
  ) {
    mainWindowRef.webContents.openDevTools();
  }
}

function resolveBrandingIconPath() {
  const candidatePaths = [
    join(__dirname, '..', 'resources', 'icon.png'),
    join(__dirname, '..', 'resources', 'branding', 'app-badge.png'),
    join(process.resourcesPath, 'icon.png'),
    join(process.resourcesPath, 'branding', 'app-badge.png'),
  ];

  return candidatePaths.find((candidatePath) => existsSync(candidatePath)) ?? null;
}

// 根据平台获取窗口配置
function getWindowConfig() {
  const iconPath = resolveBrandingIconPath();
  const runtimeDistDir = getCurrentRuntimeDistDir();
  const baseConfig = {
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(runtimeDistDir, 'preload.js'),
      webSecurity: true,
    },
    show: false, // 等待页面加载完成后再显示
    backgroundColor: '#1e1e1e', // 避免窗口创建时白色闪烁
    title: '小说编辑器',
    autoHideMenuBar: true, // 自动隐藏菜单栏（Windows/Linux）
    icon: iconPath ?? undefined,
  };

  // 根据平台设置特定配置
  if (process.platform === 'darwin') {
    // macOS 配置
    return {
      ...baseConfig,
      frame: false,
      titleBarStyle: 'hiddenInset' as const,
      titleBarOverlay: false,
      trafficLightPosition: { x: -100, y: -100 }, // 将系统按钮移出可见区域
    };
  } else {
    // Windows/Linux 配置
    return {
      ...baseConfig,
      frame: false,
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: false,
    };
  }
}

// 创建主窗口
export function createMainWindow(): BrowserWindow {
  const windowConfig = getWindowConfig();
  const mainWindow = new BrowserWindow(windowConfig);
  mainWindowRef = mainWindow;
  mainWindowReadyToShow = false;
  mainWindowRendererReady = false;
  const iconPath = resolveBrandingIconPath();

  if (process.platform === 'darwin' && iconPath) {
    const appIcon = nativeImage.createFromPath(iconPath);
    if (!appIcon.isEmpty()) {
      app.dock?.setIcon(appIcon);
    }
  }

  // 加载应用页面
  void loadRendererPage(mainWindow, getCurrentRuntimeDistDir());

  // 窗口准备好后，等待渲染进程显式 ready 再显示，避免与 splash 同时出现
  mainWindow.once('ready-to-show', () => {
    mainWindowReadyToShow = true;
    revealMainWindowIfReady();
  });

  mainWindow.on('closed', () => {
    if (mainWindowRef === mainWindow) {
      mainWindowRef = null;
      mainWindowReadyToShow = false;
      mainWindowRendererReady = false;
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

export function notifyMainWindowRendererReady() {
  mainWindowRendererReady = true;
  revealMainWindowIfReady();
}

export function getMainWindow() {
  return mainWindowRef;
}
