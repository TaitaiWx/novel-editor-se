import { ipcMain, app } from 'electron';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import {
  initDatabase,
  closeDatabase,
  novelOps,
  characterOps,
  seedProjectData,
  PROJECT_SEED_FILE,
  type SeedProjectResult,
} from '@novel-editor/store';
import { getNativeBinding } from '../../native-binding';
import { prepareProjectWorkScopes } from '../work-scope';
import { handleDatabaseOpened } from '../../ai/runtime';

/**
 * 项目数据库初始化后，若 `<项目>/.novel-editor/seed.json` 存在，按作品写入其中的人物 / 设定 / 大纲
 * （示例作品集首次打开时使用；每部作品写到自己的作品记录，见 store seed.ts）。
 * 播种失败只记日志，不影响打开项目；已有作品记录的作品不做任何改动。
 */
export function seedProjectFromDbDir(dbDir: string): SeedProjectResult | null {
  const seedFile = path.join(dbDir, PROJECT_SEED_FILE);
  if (!existsSync(seedFile)) return null;
  const folderPath = path.dirname(dbDir);
  try {
    const raw = JSON.parse(readFileSync(seedFile, 'utf-8').replace(/^\uFEFF/, '')) as unknown;
    return seedProjectData(folderPath, raw);
  } catch (error) {
    console.warn('[seed] 写入项目种子数据失败:', error);
    return null;
  }
}

/** 数据库初始化 / 关闭、作品与角色 CRUD */
export function registerProjectHandlers(): void {
  // ─── Init / Close ──────────────────────────────────────────────────────────

  ipcMain.handle('db-init', async (_event, dbDir: string) => {
    initDatabase(dbDir, 'novel-editor.db', getNativeBinding());
    seedProjectFromDbDir(dbDir);
    // 明文 AI Key 迁移到安全存储、恢复视频任务轮询
    handleDatabaseOpened();
    // 人物 / 设定 / 大纲跟随作品：确保每部作品有记录，并迁移旧版项目级数据
    const scopes = await prepareProjectWorkScopes(path.dirname(dbDir)).catch((error: unknown) => {
      console.warn('[work-scope] 准备作品作用域失败:', error);
      return null;
    });
    return { success: true, unassignedRecords: scopes?.unassignedRecords ?? false };
  });

  ipcMain.handle('db-init-default', () => {
    const defaultDbDir = path.join(app.getPath('userData'), '.novel-editor');
    initDatabase(defaultDbDir, 'novel-editor.db', getNativeBinding());
    handleDatabaseOpened();
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
