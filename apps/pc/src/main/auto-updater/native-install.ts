import { app, autoUpdater as nativeUpdater } from 'electron';
import type { AppUpdater } from 'electron-updater';

/** Finish native preparation before freezing editors; Squirrel errors must leave them usable. */
export async function prepareNativeUpdate() {
  if (process.platform !== 'darwin') return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      nativeUpdater.removeListener('update-downloaded', ready);
      nativeUpdater.removeListener('error', failed);
    };
    const ready = () => {
      cleanup();
      resolve();
    };
    const failed = (error: Error) => {
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => failed(new Error('原生安装器准备超时')), 60_000);
    nativeUpdater.once('update-downloaded', ready);
    nativeUpdater.once('error', failed);
    try {
      nativeUpdater.checkForUpdates();
    } catch (error) {
      failed(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** Native quitAndInstall returns void, including on failure. Wait for the real quit/error. */
export function handoffNativeUpdate(updater: AppUpdater): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      updater.removeListener('error', failed);
      app.removeListener('will-quit', quitting);
    };
    const quitting = () => {
      cleanup();
      resolve();
    };
    const failed = (error: Error) => {
      cleanup();
      // The exit coordinator restores its save barrier when this promise rejects.
      // A later BaseUpdater app.quit must pass that ordinary barrier; its event carries
      // no request identity, so do not guess whether it belongs to this failed install.
      reject(error);
    };
    const timer = setTimeout(() => failed(new Error('原生安装器未完成退出交接')), 30_000);
    updater.on('error', failed);
    app.once('will-quit', quitting);
    try {
      updater.quitAndInstall(true, true);
    } catch (error) {
      failed(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
