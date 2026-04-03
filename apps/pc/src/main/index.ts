import { app, BrowserWindow } from 'electron';
import { createSplashWindow } from './static/splash/splash-window';
import { pathToFileURL } from 'url';
import { join } from 'path';
import {
  buildAutoRecoveryLaunchArgs,
  handleRuntimeStartupFailure,
  hasAutoRecoveryAttemptFlag,
  prepareRuntimeLaunch,
} from './runtime-copies';
import { setCurrentRuntimeDescriptor } from './runtime-context';

if (process.env.NOVEL_EDITOR_DISABLE_HARDWARE_ACCELERATION === '1') {
  app.disableHardwareAcceleration();
}

// 设置安全恢复状态支持
if (process.platform === 'darwin') {
  (app as any).applicationSupportsSecureRestorableState = true;
}

// 应用准备就绪时创建窗口
app.whenReady().then(() => {
  // 创建 splash 窗口（即时显示加载画面）
  createSplashWindow();

  void (async () => {
    const runtimeDescriptor = await prepareRuntimeLaunch();
    setCurrentRuntimeDescriptor(runtimeDescriptor);

    const runtimeModuleUrl =
      pathToFileURL(join(runtimeDescriptor.distDir, 'main-runtime.mjs')).href +
      `?runtime=${encodeURIComponent(runtimeDescriptor.version)}`;
    const runtimeModule = (await import(runtimeModuleUrl)) as {
      bootAppRuntime?: () => Promise<void> | void;
    };
    if (typeof runtimeModule.bootAppRuntime !== 'function') {
      throw new Error('运行时入口缺少 bootAppRuntime');
    }
    await runtimeModule.bootAppRuntime();
  })().catch((error) => {
    console.error('启动运行时失败:', error);
    const message = error instanceof Error ? error.message : String(error || '未知错误');
    void handleRuntimeStartupFailure(`运行时启动失败：${message}`)
      .then((resolution) => {
        if (resolution.shouldRelaunch && !hasAutoRecoveryAttemptFlag()) {
          app.relaunch({ args: buildAutoRecoveryLaunchArgs() });
          app.exit(0);
          return;
        }
        app.exit(1);
      })
      .catch((recoveryError) => {
        console.error('处理运行时启动失败时又发生异常:', recoveryError);
        app.exit(1);
      });
  });
});

// 所有窗口关闭时退出应用（macOS 除外）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 应用即将退出时的清理工作
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
