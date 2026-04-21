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
let mainFrameLoadRetryCount = 0;

/** Splash 最大等待时间（秒）。超时后强制显示主窗口，避免卡死 */
const SPLASH_FAILSAFE_TIMEOUT_MS = 15_000;
/** 主帧加载失败时的最大重试次数 */
const MAIN_FRAME_LOAD_MAX_RETRIES = 2;

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

function renderStartupErrorPage(reason: string) {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return;

  const escapedReason = reason
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>小说编辑器启动失败</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #171a21;
        color: #e6e8ef;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .card {
        width: min(680px, calc(100vw - 48px));
        background: #1f2430;
        border: 1px solid #343b4f;
        border-radius: 14px;
        padding: 24px;
        box-sizing: border-box;
      }
      h1 { margin: 0 0 12px; font-size: 22px; }
      p { margin: 0 0 10px; line-height: 1.6; color: #c8cfde; }
      code {
        display: block;
        margin-top: 8px;
        padding: 10px 12px;
        border-radius: 8px;
        background: #131722;
        color: #9bb2ff;
        word-break: break-word;
      }
      button {
        margin-top: 16px;
        border: 0;
        border-radius: 8px;
        padding: 10px 14px;
        background: #3b82f6;
        color: #fff;
        font-size: 14px;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <section class="card">
      <h1>启动失败，已进入安全模式</h1>
      <p>渲染界面加载异常，应用已自动重试但未恢复。</p>
      <p>你可以点击“重试启动”，或重启应用后再次尝试更新。</p>
      <code>${escapedReason}</code>
      <button onclick="location.reload()">重试启动</button>
    </section>
  </body>
</html>`;

  void mainWindowRef.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
}

function recoverMainFrameLoad(reason: string) {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return;

  if (mainFrameLoadRetryCount < MAIN_FRAME_LOAD_MAX_RETRIES) {
    mainFrameLoadRetryCount += 1;
    console.warn(
      `主帧加载恢复尝试 ${mainFrameLoadRetryCount}/${MAIN_FRAME_LOAD_MAX_RETRIES}: ${reason}`
    );
    // 重试时追加 query，避免命中损坏缓存
    void loadRendererPage(mainWindowRef, __dirname, {
      recover: String(Date.now()),
      retry: String(mainFrameLoadRetryCount),
    });
    return;
  }

  forceRevealMainWindow(`启动恢复失败，进入安全模式: ${reason}`);
  renderStartupErrorPage(reason);
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
  mainFrameLoadRetryCount = 0;
  const iconPath = resolveBrandingIconPath();

  if (process.platform === 'darwin' && iconPath) {
    const appIcon = nativeImage.createFromPath(iconPath);
    if (!appIcon.isEmpty()) {
      app.dock?.setIcon(appIcon);
    }
  }

  // 加载应用页面
  void loadRendererPage(mainWindow, __dirname);

  // 启动 splash 超时兜底：如果渲染进程在规定时间内未 ready，先尝试恢复加载
  splashFailsafeTimer = setTimeout(() => {
    splashFailsafeTimer = null;
    if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
    if (mainWindowRendererReady) return;
    recoverMainFrameLoad(`渲染进程 ${SPLASH_FAILSAFE_TIMEOUT_MS / 1000}s 内未就绪`);
  }, SPLASH_FAILSAFE_TIMEOUT_MS);

  // 仅主帧加载失败时触发恢复，避免子资源失败导致误判
  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, _url, isMainFrame) => {
      if (!isMainFrame) return;
      console.error(`主帧加载失败 (code=${errorCode}): ${errorDescription}`);
      recoverMainFrameLoad(`页面加载失败: ${errorDescription}`);
    }
  );

  // 渲染进程崩溃时触发恢复加载
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`渲染进程异常退出: ${details.reason}`);
    recoverMainFrameLoad(`渲染进程异常: ${details.reason}`);
  });

  // 窗口准备好后，等待渲染进程显式 ready 再显示，避免与 splash 同时出现
  mainWindow.once('ready-to-show', () => {
    mainWindowReadyToShow = true;
    revealMainWindowIfReady();
  });

  mainWindow.on('closed', () => {
    if (mainWindowRef === mainWindow) {
      clearSplashFailsafe();
      mainWindowRef = null;
      mainWindowReadyToShow = false;
      mainWindowRendererReady = false;
      mainFrameLoadRetryCount = 0;
    }
  });

  // 阻止新窗口打开
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  // 阻止导航到外部URL
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    const isLocalFile = parsedUrl.protocol === 'file:';
    const isDevServerNav =
      isRendererDevServerEnabled() &&
      process.env.VITE_DEV_SERVER_URL &&
      parsedUrl.origin === new URL(process.env.VITE_DEV_SERVER_URL).origin;
    const isSafeInternalNav = parsedUrl.protocol === 'about:' || parsedUrl.protocol === 'data:';

    if (!isLocalFile && !isDevServerNav && !isSafeInternalNav) {
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
