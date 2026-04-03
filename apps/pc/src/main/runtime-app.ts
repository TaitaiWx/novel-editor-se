import { app, BrowserWindow } from 'electron';
import path from 'path';
import { initDatabase } from '@novel-editor/store';
import { setupIPC } from './ipc-handlers';
import { registerAllShortcuts } from './shortcuts/registerAllShortcuts';
import { unregisterAllShortcuts } from './shortcuts/unregisterAllShortcuts';
import { createMainWindow, setupWindowEvents } from './window';
import { setupAutoUpdater } from './auto-updater';
import { getNativeBinding } from './native-binding';
import { markRuntimeGracefulExit } from './runtime-copies';

let runtimeBooted = false;

function ensureDefaultDatabaseReady() {
  const defaultDbDir = path.join(app.getPath('userData'), '.novel-editor');
  initDatabase(defaultDbDir, 'novel-editor.db', getNativeBinding());
}

export async function bootAppRuntime() {
  if (runtimeBooted) {
    return;
  }
  runtimeBooted = true;

  setupIPC();
  setupWindowEvents();
  registerAllShortcuts();
  // 健康判定不能依赖组件 state，默认数据库在主进程启动时先完成初始化。
  ensureDefaultDatabaseReady();
  createMainWindow();

  if (process.env.NODE_ENV !== 'development') {
    await setupAutoUpdater();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  app.on('before-quit', () => {
    void markRuntimeGracefulExit().catch((error) => {
      console.warn('标记运行时优雅退出失败:', error);
    });
    unregisterAllShortcuts();
  });
}
