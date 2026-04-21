import { app, BrowserWindow } from 'electron';
import { createMainWindow, setupWindowEvents } from './window';
import { createSplashWindow } from './static/splash/splash-window';
import { setupIPC } from './ipc-handlers';
import { registerAllShortcuts } from './shortcuts/registerAllShortcuts';
import { unregisterAllShortcuts } from './shortcuts/unregisterAllShortcuts';
import { setupAutoUpdater } from './auto-updater';
import { applySmokeTestPaths, isAutoUpdaterDisabled } from './launch-mode';
import { ensureWindowsShortcuts } from './windows-shortcut';
import { detectSystemProfile } from './system-profile';

applySmokeTestPaths();

// 在 app.ready 之前完成系统能力探测，便于决定是否关闭 GPU 加速
const systemProfile = detectSystemProfile();

if (
  process.env.NOVEL_EDITOR_DISABLE_HARDWARE_ACCELERATION === '1' ||
  // 自动低配模式：低配设备默认禁用硬件加速，避免集显/旧驱动卡顿
  systemProfile.isLowSpec
) {
  app.disableHardwareAcceleration();
  if (systemProfile.isLowSpec) {
    console.info(`[低配模式] 自动禁用硬件加速；触发原因: ${systemProfile.reasons.join('; ')}`);
  }
}

// 设置安全恢复状态支持
if (process.platform === 'darwin') {
  (app as any).applicationSupportsSecureRestorableState = true;
}

// 应用准备就绪时创建窗口
app.whenReady().then(() => {
  // ── 关键路径：尽快展示窗口 ─────────────────────────────────
  // 1) IPC 注册必须先于窗口（preload 加载需要这些通道）
  setupIPC();
  // 2) 窗口事件
  setupWindowEvents();
  // 3) splash + 主窗口
  createSplashWindow();
  createMainWindow();

  // ── 非关键路径：全部异步后台跑，不阻塞首帧 ────────────────
  // 快捷方式自修复：仅 Windows 用到，且失败不影响主流程
  void ensureWindowsShortcuts().catch((error) => {
    console.warn('快捷方式自修复失败（不影响应用启动）:', error);
  });

  // 全局快捷键注册延后到窗口出现之后
  setImmediate(() => {
    try {
      registerAllShortcuts();
    } catch (error) {
      console.warn('注册全局快捷键失败:', error);
    }
  });

  // 自动更新初始化延后；低配设备再额外延迟，避免与首屏渲染争 CPU/网络
  if (process.env.NODE_ENV !== 'development' && !isAutoUpdaterDisabled()) {
    const updaterStartDelayMs = systemProfile.isLowSpec ? 20_000 : 4_000;
    setTimeout(() => {
      void setupAutoUpdater().catch((error) => {
        console.error('初始化自动更新失败，已降级为无更新模式:', error);
      });
    }, updaterStartDelayMs);
  }

  // macOS 上点击 dock 图标时重新创建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// 所有窗口关闭时退出应用（macOS 除外）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 应用即将退出时的清理工作
app.on('before-quit', () => {
  // 注销所有快捷键
  unregisterAllShortcuts();
});

// 防止多个实例
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 当运行第二个实例时，将会聚焦到主窗口
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      const mainWindow = windows[0];
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}
