import { app, BrowserWindow, nativeImage } from 'electron';
import { existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { closeSplashWindow } from './static/splash/splash-window';
import { isRendererDevServerEnabled, loadRendererPage } from './renderer-entry';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
let mainWindowRef: BrowserWindow | null = null;
let mainWindowReadyToShow = false;
let mainWindowRendererReady = false;
let splashFailsafeTimer: NodeJS.Timeout | null = null;

/** Splash 最大等待时间（秒）。超时后强制显示主窗口，避免卡死 */
const SPLASH_FAILSAFE_TIMEOUT_MS = 15_000;

function clearSplashFailsafe() {
  if (splashFailsafeTimer) {
    clearTimeout(splashFailsafeTimer);
    splashFailsafeTimer = null;
  }
}

function revealMainWindowIfReady() {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
  if (!mainWindowReadyToShow || !mainWindowRendererReady) return;

  clearSplashFailsafe();

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

/**
 * 强制显示主窗口并关闭 splash（超时兜底）。
 * 即使渲染进程未报告 ready，也要让用户看到窗口，避免永远卡在启动画面。
 */
function forceRevealMainWindow(reason: string) {
  clearSplashFailsafe();
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return;

  console.warn(`强制显示主窗口: ${reason}`);
  mainWindowReadyToShow = true;
  mainWindowRendererReady = true;

  if (!mainWindowRef.isVisible()) {
    mainWindowRef.show();
  }
  closeSplashWindow();
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
  const baseConfig = {
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
  void loadRendererPage(mainWindow, __dirname);

  // 启动 splash 超时兜底：如果渲染进程在规定时间内未 ready，强制显示主窗口
  splashFailsafeTimer = setTimeout(() => {
    splashFailsafeTimer = null;
    if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
    if (mainWindowRef.isVisible()) return;
    forceRevealMainWindow(`渲染进程 ${SPLASH_FAILSAFE_TIMEOUT_MS / 1000}s 内未就绪，超时兜底`);
  }, SPLASH_FAILSAFE_TIMEOUT_MS);

  // 页面加载失败时强制显示窗口，避免永远卡在 splash
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`页面加载失败 (code=${errorCode}): ${errorDescription}`);
    forceRevealMainWindow(`页面加载失败: ${errorDescription}`);
  });

  // 渲染进程崩溃时强制显示窗口
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`渲染进程异常退出: ${details.reason}`);
    forceRevealMainWindow(`渲染进程异常: ${details.reason}`);
  });

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
