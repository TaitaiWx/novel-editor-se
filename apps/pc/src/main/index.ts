import { app, BrowserWindow } from 'electron';
import { createMainWindow, setupWindowEvents } from './window';
import { setupIPC } from './ipc-handlers';
import { registerAllShortcuts } from './shortcuts/registerAllShortcuts';
import { unregisterAllShortcuts } from './shortcuts/unregisterAllShortcuts';
import { setupAutoUpdater } from './auto-updater';

// 设置安全恢复状态支持
if (process.platform === 'darwin') {
  (app as any).applicationSupportsSecureRestorableState = true;
}

// 应用准备就绪时创建窗口
app.whenReady().then(() => {
  // 设置 IPC 通信
  setupIPC();

  // 设置窗口事件
  setupWindowEvents();

  // 注册快捷键（通过 Menu accelerator，仅在应用聚焦时生效）
  registerAllShortcuts();

  // 创建主窗口
  createMainWindow();

  // 生产环境下检查自动更新
  if (process.env.NODE_ENV !== 'development') {
    setupAutoUpdater();
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
