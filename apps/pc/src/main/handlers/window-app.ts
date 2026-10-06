/**
 * Window & App IPC Handlers
 *
 * Handles: window controls, shortcuts, app version, updates, recent folders, cache
 */
import { ipcMain, BrowserWindow, app } from 'electron';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { getAllShortcuts } from '../shortcuts/getAllShortcuts';
import { syncMenuShortcuts } from '../shortcuts/registerAllShortcuts';
import { MENU_SYNC_SHORTCUTS_CHANNEL } from '../../shared/app-menu';
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
import { isE2ETestMode, isSmokeTestMode } from '../launch-mode';
import { getReleaseNotesCandidates, isJustUpdated } from '../changelog';
import { detectSystemProfile } from '../system-profile';
import { getWebAuthnSupportInfo } from '../webauthn';
import { syncSampleData } from '../sample-data';

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
    // 主窗口显示时机由 Electron `ready-to-show` 事件决定，这里只通知自动更新模块
    noteUpdaterRendererReady();
    return { success: true };
  });

  ipcMain.handle('app-renderer-health-ready', () => {
    noteUpdaterRendererHealthy();
    // 烟雾测试只验证能启动到健康状态即退出；E2E 测试需要保持应用运行
    if (isSmokeTestMode() && !isE2ETestMode()) {
      setTimeout(() => app.exit(0), 300);
    }
    return { success: true };
  });

  // ─── App Info ─────────────────────────────────────────────────────────────

  ipcMain.handle('get-shortcuts', () => getAllShortcuts());
  // 设置中心自定义快捷键后同步到应用菜单（入参在 syncMenuShortcuts 内校验）
  ipcMain.handle(MENU_SYNC_SHORTCUTS_CHANNEL, (_event, bindings: unknown) =>
    syncMenuShortcuts(bindings)
  );
  ipcMain.handle('get-app-version', () => app.getVersion());
  ipcMain.handle('get-device-id', () => getDeviceId());
  // 系统能力探测：返回是否处于自动低配模式，渲染端据此延迟非关键工作
  ipcMain.handle('get-system-profile', () => detectSystemProfile());
  ipcMain.handle('get-webauthn-support', () => getWebAuthnSupportInfo());

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
  // 上次目录可能就是示例作品集：等启动时的示例版本同步完成，避免读到正在被替换的旧副本
  ipcMain.handle('get-last-folder', async () => {
    await syncSampleData();
    return getLastFolder();
  });
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

  /** 依次尝试候选路径，返回第一个可读文件的内容 */
  const readFirstExisting = async (candidates: string[]): Promise<string> => {
    let lastError: unknown = new Error('没有候选路径');
    for (const candidate of candidates) {
      try {
        return await readFile(candidate, 'utf-8');
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  };

  ipcMain.handle('get-changelog', async () => {
    const candidates = getReleaseNotesCandidates({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
    });
    const normalizeVersion = (v: string) => v.trim().replace(/^v/i, '').toLowerCase();

    try {
      const currentVersion = app.getVersion();
      const raw = await readFirstExisting(candidates);
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
    if (isJustUpdated(previousVersion, currentVersion)) {
      return { updated: true, fromVersion: previousVersion, toVersion: currentVersion };
    }
    return { updated: false, fromVersion: null, toVersion: currentVersion };
  });
}
