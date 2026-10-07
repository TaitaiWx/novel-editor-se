import { ipcMain, BrowserWindow } from 'electron';
import { isDatabaseReady, statsOps, settingsOps, aiCacheOps } from '@novel-editor/store';
import { getCredentialStore } from '../../ai/runtime';
import {
  DEFAULT_TEXT_PROVIDER_ID,
  interceptSettingsWrite,
  sanitizeSettingsForRenderer,
  SETTINGS_CENTER_KEY,
} from '../../ai/settings-secrets';

/** 写作统计、应用设置与 AI 缓存 */
export function registerSettingsAndCacheHandlers(): void {
  // ─── Writing Stats ────────────────────────────────────────────────────────

  ipcMain.handle(
    'db-stats-record',
    (_event, novelId: number, date: string, wordCount: number, durationSeconds: number) =>
      statsOps.record(novelId, date, wordCount, durationSeconds)
  );
  ipcMain.handle('db-stats-range', (_event, novelId: number, startDate: string, endDate: string) =>
    statsOps.getByNovelAndRange(novelId, startDate, endDate)
  );
  ipcMain.handle('db-stats-today', (_event, novelId: number) => statsOps.getToday(novelId));

  // ─── Settings ─────────────────────────────────────────────────────────────

  ipcMain.handle('db-settings-get', (_event, key: string) => {
    if (!isDatabaseReady()) return undefined;
    const value = settingsOps.get(key);
    // AI Key 只写不读：去掉明文，只告诉渲染进程是否已配置
    if (key === SETTINGS_CENTER_KEY) {
      return sanitizeSettingsForRenderer(value, getCredentialStore().has(DEFAULT_TEXT_PROVIDER_ID));
    }
    return value;
  });
  ipcMain.handle('db-settings-set', (_event, key: string, value: string) => {
    // 渲染进程写入的 apiKey 转存到 safeStorage，数据库里不再保存明文
    const stored =
      key === SETTINGS_CENTER_KEY && typeof value === 'string'
        ? interceptSettingsWrite(value, getCredentialStore())
        : value;
    settingsOps.set(key, stored);
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('settings-updated', key);
      }
    }
  });
  ipcMain.handle('db-settings-delete-prefixes', (_event, prefixes: string[]) => {
    const normalized = prefixes.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0
    );
    const removed = settingsOps.deleteByPrefixes(normalized);
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        normalized.forEach((prefix) => win.webContents.send('settings-updated', prefix));
      }
    }
    return { removed };
  });
  ipcMain.handle('db-settings-all', () => settingsOps.getAll());

  // ─── AI Cache ─────────────────────────────────────────────────────────────

  ipcMain.handle('ai-cache-get', (_event, cacheKey: string, type: string) =>
    aiCacheOps.get(cacheKey, type)
  );
  ipcMain.handle('ai-cache-set', (_event, cacheKey: string, type: string, value: string) =>
    aiCacheOps.set(cacheKey, type, value)
  );
  ipcMain.handle('ai-cache-delete', (_event, cacheKey: string, type: string) =>
    aiCacheOps.delete(cacheKey, type)
  );
  ipcMain.handle('ai-cache-get-by-type', (_event, type: string) => aiCacheOps.getByType(type));
  ipcMain.handle('ai-cache-clear-by-type', (_event, type: string) => aiCacheOps.clearByType(type));
  ipcMain.handle('ai-cache-cleanup', (_event, maxAgeDays: number) =>
    aiCacheOps.cleanup(maxAgeDays)
  );
  ipcMain.handle('ai-cache-touch-keys', (_event, keys: Array<{ cacheKey: string; type: string }>) =>
    aiCacheOps.touchKeys(keys)
  );
}
