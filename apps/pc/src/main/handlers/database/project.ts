import { CHARACTER_DESIGN_FIELDS } from '@novel-editor/core/entity-media';
import { registerWorkspaceHandler } from '../../workspace-ipc';
import { app } from 'electron';
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

  registerWorkspaceHandler('db-init', async (_event, dbDir: string) => {
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

  registerWorkspaceHandler('db-init-default', () => {
    const defaultDbDir = path.join(app.getPath('userData'), '.novel-editor');
    initDatabase(defaultDbDir, 'novel-editor.db', getNativeBinding());
    handleDatabaseOpened();
    return { success: true, dbDir: defaultDbDir };
  });

  registerWorkspaceHandler('db-close', () => {
    closeDatabase();
    return { success: true };
  });

  // ─── Novel CRUD ────────────────────────────────────────────────────────────

  registerWorkspaceHandler(
    'db-novel-create',
    (_event, name: string, folderPath: string, description?: string) =>
      novelOps.create(name, folderPath, description)
  );
  registerWorkspaceHandler('db-novel-list', () => novelOps.getAll());
  registerWorkspaceHandler('db-novel-get', (_event, id: number) => novelOps.getById(id));
  registerWorkspaceHandler('db-novel-get-by-folder', (_event, folderPath: string) =>
    novelOps.getByFolder(folderPath)
  );
  registerWorkspaceHandler(
    'db-novel-update',
    (_event, id: number, fields: { name?: string; description?: string }) =>
      novelOps.update(id, fields)
  );
  registerWorkspaceHandler('db-novel-delete', (_event, id: number) => novelOps.delete(id));

  // ─── Character CRUD ────────────────────────────────────────────────────────

  registerWorkspaceHandler(
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
  registerWorkspaceHandler('db-character-list', (_event, novelId: number) =>
    characterOps.getByNovel(novelId)
  );
  registerWorkspaceHandler(
    'db-character-update',
    (_event, id: number, fields: Parameters<typeof characterOps.update>[1]) =>
      characterOps.update(id, fields)
  );
  registerWorkspaceHandler(
    'db-character-patch-design',
    (_event, id: number, patch: unknown, expected: unknown) => {
      if (
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        !patch ||
        typeof patch !== 'object' ||
        Array.isArray(patch) ||
        !expected ||
        typeof expected !== 'object' ||
        Array.isArray(expected)
      )
        throw new Error('人物设计参数无效');
      const fields = patch as Record<string, unknown>;
      const base = expected as Record<string, unknown>;
      const allowed = new Set<string>(CHARACTER_DESIGN_FIELDS.map((field) => field.key));
      if (
        !Object.keys(fields).length ||
        Object.keys(fields).some(
          (key) =>
            !allowed.has(key) ||
            typeof fields[key] !== 'string' ||
            Array.from(fields[key] as string).length > 800 ||
            typeof base[key] !== 'string'
        )
      )
        throw new Error('人物设计字段无效或超过 800 字');
      return characterOps.patchAttributeFields(
        id,
        'design',
        fields as Record<string, string>,
        base as Record<string, string>
      );
    }
  );
  registerWorkspaceHandler('db-character-reorder', (_event, ids: number[]) =>
    characterOps.reorder(ids)
  );
  registerWorkspaceHandler('db-character-delete', (_event, id: number) => characterOps.delete(id));
  registerWorkspaceHandler('db-character-clear-by-novel', (_event, novelId: number) =>
    characterOps.clearByNovel(novelId)
  );
}
