import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import { BrowserWindow } from 'electron';

// 初始化自动更新
export function setupAutoUpdater() {
  // 静默自动下载，下载完成后提示用户重启
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.webContents.send('update-available', info);
    }
  });

  autoUpdater.on('update-not-available', () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.webContents.send('update-not-available');
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.webContents.send('update-download-progress', progress);
    }
  });

  autoUpdater.on('update-downloaded', () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.webContents.send('update-downloaded');
    }
  });

  autoUpdater.on('error', (error) => {
    console.error('自动更新错误:', error);
  });

  // 检查更新
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('检查更新失败:', err);
  });
}

// 开始下载更新
export function downloadUpdate() {
  autoUpdater.downloadUpdate().catch((err) => {
    console.error('下载更新失败:', err);
  });
}

// 安装更新并重启
export function installUpdate() {
  autoUpdater.quitAndInstall();
}
