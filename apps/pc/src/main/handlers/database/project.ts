import { ipcMain, app } from 'electron';
import path from 'path';
import { initDatabase, closeDatabase, novelOps, characterOps } from '@novel-editor/store';
import { getNativeBinding } from '../../native-binding';

/** 数据库初始化 / 关闭、作品与角色 CRUD */
export function registerProjectHandlers(): void {
  // ─── Init / Close ──────────────────────────────────────────────────────────

  ipcMain.handle('db-init', (_event, dbDir: string) => {
    initDatabase(dbDir, 'novel-editor.db', getNativeBinding());
    return { success: true };
  });

  ipcMain.handle('db-init-default', () => {
    const defaultDbDir = path.join(app.getPath('userData'), '.novel-editor');
    initDatabase(defaultDbDir, 'novel-editor.db', getNativeBinding());
    return { success: true, dbDir: defaultDbDir };
  });

  ipcMain.handle('db-close', () => {
    closeDatabase();
    return { success: true };
  });

  // ─── Novel CRUD ────────────────────────────────────────────────────────────

  ipcMain.handle(
    'db-novel-create',
    (_event, name: string, folderPath: string, description?: string) =>
      novelOps.create(name, folderPath, description)
  );
  ipcMain.handle('db-novel-list', () => novelOps.getAll());
  ipcMain.handle('db-novel-get', (_event, id: number) => novelOps.getById(id));
  ipcMain.handle('db-novel-get-by-folder', (_event, folderPath: string) =>
    novelOps.getByFolder(folderPath)
  );
  ipcMain.handle(
    'db-novel-update',
    (_event, id: number, fields: { name?: string; description?: string }) =>
      novelOps.update(id, fields)
  );
  ipcMain.handle('db-novel-delete', (_event, id: number) => novelOps.delete(id));

  // ─── Character CRUD ────────────────────────────────────────────────────────

  ipcMain.handle(
    'db-character-create',
    (
      _event,
      novelId: number,
      name: string,
      role?: string,
      description?: string,
      attributes?: string
    ) => characterOps.create(novelId, name, role, description, attributes)
  );
  ipcMain.handle('db-character-list', (_event, novelId: number) =>
    characterOps.getByNovel(novelId)
  );
  ipcMain.handle(
    'db-character-update',
    (
      _event,
      id: number,
      fields: { name?: string; role?: string; description?: string; attributes?: string }
    ) => characterOps.update(id, fields)
  );
  ipcMain.handle('db-character-reorder', (_event, ids: number[]) => characterOps.reorder(ids));
  ipcMain.handle('db-character-delete', (_event, id: number) => characterOps.delete(id));
  ipcMain.handle('db-character-clear-by-novel', (_event, novelId: number) =>
    characterOps.clearByNovel(novelId)
  );
}
