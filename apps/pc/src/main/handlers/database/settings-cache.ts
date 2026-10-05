import { ipcMain, BrowserWindow } from 'electron';
import { isDatabaseReady, statsOps, settingsOps, aiCacheOps } from '@novel-editor/store';

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
    return settingsOps.get(key);
  });
  ipcMain.handle('db-settings-set', (_event, key: string, value: string) => {
    settingsOps.set(key, value);
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
