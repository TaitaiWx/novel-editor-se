/**
 * Window & App IPC Handlers
 *
 * Handles: window controls, shortcuts, app version, updates, recent folders, cache
 */
import { ipcMain, BrowserWindow, app } from 'electron';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { getAllShortcuts } from '../shortcuts/getAllShortcuts';
import { getDeviceId } from '../device-id';
import {
  addRecentFolder,
  clearRecentFolders,
  getLastFolder,
  getRecentFolders,
} from '../recent-folders';
import {
  checkForUpdatesManually,
  downloadUpdate,
  getUpdateStatus,
  installUpdate,
  noteUpdaterRendererHealthy,
  noteUpdaterRendererReady,
  rollbackToPreviousVersion,
  setUpdateChannel,
} from '../auto-updater';
import type { UpdateChannel } from '../auto-updater';
import { settingsOps } from '@novel-editor/store';
import { notifyMainWindowRendererReady } from '../window';
import { isSmokeTestMode } from '../launch-mode';

const DOCUMENT_CACHE_PREFIXES = [
  'novel-editor:lore:',
  'novel-editor:character-relations:',
  'novel-editor:plot-board:',
  'novel-editor:graph-layout:',
];

export function registerWindowAppHandlers(): void {
  // ─── Window Controls ──────────────────────────────────────────────────────

  ipcMain.handle('window-minimize', () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) window.minimize();
  });

  ipcMain.handle('window-maximize', () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
    }
  });

  ipcMain.handle('window-close', () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) window.close();
  });

  ipcMain.handle('window-is-maximized', () => {
    const window = BrowserWindow.getFocusedWindow();
    return window ? window.isMaximized() : false;
  });

  ipcMain.handle('app-quit', () => {
    app.quit();
  });

  ipcMain.handle('dev-tools-toggle', () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      if (window.webContents.isDevToolsOpened()) window.webContents.closeDevTools();
      else window.webContents.openDevTools();
    }
  });

  ipcMain.handle('window-toggle-fullscreen', () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) window.setFullScreen(!window.isFullScreen());
  });

  ipcMain.handle('app-renderer-ready', () => {
    notifyMainWindowRendererReady();
    noteUpdaterRendererReady();
    return { success: true };
  });

  ipcMain.handle('app-renderer-health-ready', () => {
    noteUpdaterRendererHealthy();
    if (isSmokeTestMode()) {
      setTimeout(() => app.exit(0), 300);
    }
    return { success: true };
  });

  // ─── App Info ─────────────────────────────────────────────────────────────

  ipcMain.handle('get-shortcuts', () => getAllShortcuts());
  ipcMain.handle('get-app-version', () => app.getVersion());
  ipcMain.handle('get-device-id', () => getDeviceId());

  // ─── Updates ──────────────────────────────────────────────────────────────

  ipcMain.handle('update-download', () => downloadUpdate());
  ipcMain.handle('update-install', () => installUpdate());
  ipcMain.handle('update-check', () => checkForUpdatesManually());
  ipcMain.handle('update-status', () => getUpdateStatus());
  ipcMain.handle('update-set-channel', (_event, channel: UpdateChannel) =>
    setUpdateChannel(channel)
  );
  ipcMain.handle('update-rollback', () => rollbackToPreviousVersion());

  // ─── Recent Folders ───────────────────────────────────────────────────────

  ipcMain.handle('get-recent-folders', () => getRecentFolders());
  ipcMain.handle('get-last-folder', () => getLastFolder());
  ipcMain.handle('add-recent-folder', (_event, folderPath: string) => {
    addRecentFolder(folderPath);
  });

  // ─── Cache ────────────────────────────────────────────────────────────────

  ipcMain.handle('app-cache-clear', (_event, scope: 'document-data') => {
    if (scope !== 'document-data') {
      throw new Error(`Unsupported cache clear scope: ${scope}`);
    }
    const removedSettingRows = settingsOps.deleteByPrefixes(DOCUMENT_CACHE_PREFIXES);
    const recentFolderCount = getRecentFolders().length;
    clearRecentFolders();
    return { scope, removedSettingRows, clearedRecentFolders: recentFolderCount };
  });

  // ─── Changelog ────────────────────────────────────────────────────────────

  ipcMain.handle('get-changelog', async () => {
    const baseDir = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), '..');
    const releaseNotesPath = path.join(baseDir, 'release-notes.json');
    const normalizeVersion = (v: string) => v.trim().replace(/^v/i, '').toLowerCase();

    try {
      const currentVersion = app.getVersion();
      const raw = await readFile(releaseNotesPath, 'utf-8');
      const parsed = JSON.parse(raw) as {
        versions?: Record<string, { markdown: string }>;
      };
      const versions = parsed.versions ?? {};
      const hit = Object.entries(versions).find(
        ([version]) => normalizeVersion(version) === normalizeVersion(currentVersion)
      );
      if (hit && hit[1]?.markdown) return hit[1].markdown;
      return `# 更新日志\n\n当前版本 ${currentVersion} 暂无发布说明。`;
    } catch {
      return '# 更新日志\n\n发布说明不可用，请检查 release-notes.json。';
    }
  });

  ipcMain.handle('check-just-updated', async () => {
    const versionFilePath = path.join(app.getPath('userData'), 'changelog-last-seen-version');
    const currentVersion = app.getVersion();
    let previousVersion: string | null = null;
    try {
      previousVersion = (await readFile(versionFilePath, 'utf-8')).trim();
    } catch {
      // 首次启动
    }
    await writeFile(versionFilePath, currentVersion, 'utf-8');
    if (!previousVersion || previousVersion !== currentVersion) {
      return { updated: true, fromVersion: previousVersion, toVersion: currentVersion };
    }
    return { updated: false, fromVersion: null, toVersion: currentVersion };
  });
}
