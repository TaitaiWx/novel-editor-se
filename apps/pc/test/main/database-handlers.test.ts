import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sqliteAvailable } from '../../../../packages/store/test/helpers/sqlite-shim';

// better-sqlite3 针对 Electron ABI 编译，纯 Node 下无法加载，用 node:sqlite shim 替代以跑真实 SQL
vi.mock('better-sqlite3', async () => {
  const { SqliteShim } = await import('../../../../packages/store/test/helpers/sqlite-shim');
  return { default: SqliteShim };
});

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();

interface FakeWindow {
  isDestroyed: () => boolean;
  webContents: { send: ReturnType<typeof vi.fn> };
}

const electronState = {
  userData: '',
  windows: [] as FakeWindow[],
  saveResult: { canceled: true, filePath: undefined } as { canceled: boolean; filePath?: string },
  openResult: { canceled: true, filePaths: [] } as { canceled: boolean; filePaths: string[] },
};
const showSaveDialog = vi.fn(async () => electronState.saveResult);
const showOpenDialog = vi.fn(async () => electronState.openResult);

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
  },
  dialog: {
    showSaveDialog: (...args: unknown[]) => showSaveDialog(...(args as [])),
    showOpenDialog: (...args: unknown[]) => showOpenDialog(...(args as [])),
  },
  BrowserWindow: { getAllWindows: () => electronState.windows },
  app: {
    isPackaged: false,
    getPath: () => electronState.userData,
    getAppPath: () => electronState.userData,
  },
}));

const { registerDatabaseHandlers } = await import('../../src/main/handlers/database');
const store = await import('@novel-editor/store');
registerDatabaseHandlers();

async function call<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`未注册: ${channel}`);
  return (await handler({}, ...args)) as T;
}

type Row = Record<string, unknown>;
interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

const tmpDirs: string[] = [];
function tmp(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function fakeWindow(destroyed = false): FakeWindow {
  return { isDestroyed: () => destroyed, webContents: { send: vi.fn() } };
}

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!sqliteAvailable)('database IPC handlers（node:sqlite shim）', () => {
  const FOLDER = '/Users/me/Novels/星河';
  let dbDir = '';
  let novelId = 0;

  beforeEach(async () => {
    dbDir = tmp('ne-db-handlers-');
    electronState.userData = tmp('ne-db-userdata-');
    electronState.windows = [];
    electronState.saveResult = { canceled: true };
    electronState.openResult = { canceled: true, filePaths: [] };
    showSaveDialog.mockClear();
    showOpenDialog.mockClear();
    await expect(call('db-init', dbDir)).resolves.toEqual({ success: true });
    const created = await call<RunResult>('db-novel-create', '星河', FOLDER, '科幻长篇');
    novelId = Number(created.lastInsertRowid);
  });

  afterEach(async () => {
    await call('db-close');
  });

  it('注册了全部关键通道', () => {
    for (const channel of [
      'db-init',
      'db-init-default',
      'db-close',
      'db-novel-create',
      'db-outline-version-apply-by-folder',
      'db-export-knowledge-text',
      'db-import-from-file',
      'ai-cache-touch-keys',
    ]) {
      expect(handlers.has(channel)).toBe(true);
    }
  });

  describe('初始化 / 关闭', () => {
    it('db-init-default 在 userData/.novel-editor 下建库', async () => {
      await call('db-close');
      const result = await call<{ success: boolean; dbDir: string }>('db-init-default');
      expect(result.success).toBe(true);
      expect(result.dbDir).toBe(path.join(electronState.userData, '.novel-editor'));
      expect(store.isDatabaseReady()).toBe(true);
    });

    it('db-close 后 settings-get 返回 undefined 而不是抛错', async () => {
      await call('db-settings-set', 'k', 'v');
      await expect(call('db-settings-get', 'k')).resolves.toBe('v');
      await expect(call('db-close')).resolves.toEqual({ success: true });
      await expect(call('db-settings-get', 'k')).resolves.toBeUndefined();
      // 其它操作在未初始化时应抛错
      await expect(call('db-novel-list')).rejects.toThrow('Database not initialized');
      await call('db-init', dbDir);
    });
  });

  describe('作品 CRUD', () => {
    it('创建 / 查询 / 更新 / 删除', async () => {
      const list = await call<Row[]>('db-novel-list');
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ name: '星河', folder_path: FOLDER, description: '科幻长篇' });

      await expect(call<Row>('db-novel-get', novelId)).resolves.toMatchObject({ name: '星河' });
      await expect(call<Row>('db-novel-get-by-folder', FOLDER)).resolves.toMatchObject({
        id: novelId,
      });
      await expect(call('db-novel-get-by-folder', '/nope')).resolves.toBeUndefined();

      await call('db-novel-update', novelId, { name: '星河2', description: '改' });
      await expect(call<Row>('db-novel-get', novelId)).resolves.toMatchObject({
        name: '星河2',
        description: '改',
      });

      await call('db-novel-delete', novelId);
      await expect(call<Row[]>('db-novel-list')).resolves.toEqual([]);
    });

    it('同一目录重复创建作品被唯一约束拒绝', async () => {
      await expect(call('db-novel-create', '重复', FOLDER)).rejects.toThrow();
    });
  });

  describe('角色 CRUD', () => {
    it('创建 / 列表 / 更新 / 排序 / 删除 / 清空', async () => {
      const a = await call<RunResult>('db-character-create', novelId, '林舟', '主角', '少年');
      const b = await call<RunResult>(
        'db-character-create',
        novelId,
        '白鹤',
        '配角',
        '剑客',
        '{"aliases":["鹤"]}'
      );
      const idA = Number(a.lastInsertRowid);
      const idB = Number(b.lastInsertRowid);

      let list = await call<Row[]>('db-character-list', novelId);
      expect(list.map((r) => r.name)).toEqual(['林舟', '白鹤']);

      await call('db-character-update', idA, { role: '男主' });
      await call('db-character-reorder', [idB, idA]);
      list = await call<Row[]>('db-character-list', novelId);
      expect(list.map((r) => r.name)).toEqual(['白鹤', '林舟']);
      expect(list[1].role).toBe('男主');

      await call('db-character-delete', idB);
      list = await call<Row[]>('db-character-list', novelId);
      expect(list).toHaveLength(1);

      await call('db-character-clear-by-novel', novelId);
      await expect(call<Row[]>('db-character-list', novelId)).resolves.toEqual([]);
    });
  });

  describe('大纲（按目录）', () => {
    const tree = [
      { title: '第一幕', children: [{ title: '场景一', content: '开场' }] },
      { title: '第二幕' },
    ];

    it('项目不存在时：列表为空，写入/排序抛错，清空返回 0', async () => {
      await expect(call('db-outline-list-by-folder', '/missing')).resolves.toEqual([]);
      await expect(call('db-outline-replace-by-folder', '/missing', tree)).rejects.toThrow(
        '项目不存在，无法写入大纲'
      );
      await expect(call('db-outline-reorder-by-folder', '/missing', [1])).rejects.toThrow(
        '项目不存在，无法排序大纲'
      );
      await expect(call('db-outline-clear-by-folder', '/missing')).resolves.toEqual({
        changes: 0,
      });
    });

    it('按项目作用域写入、读取、排序与清空', async () => {
      await expect(call('db-outline-replace-by-folder', FOLDER, tree)).resolves.toEqual({
        changes: 2,
      });
      const rows = await call<Row[]>('db-outline-list-by-folder', FOLDER);
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.scope_kind === 'project' && r.scope_path === FOLDER)).toBe(true);
      const child = rows.find((r) => r.title === '场景一');
      const act1 = rows.find((r) => r.title === '第一幕');
      expect(child?.parent_id).toBe(act1?.id);

      const roots = rows.filter((r) => r.parent_id === null).map((r) => Number(r.id));
      await expect(
        call('db-outline-reorder-by-folder', FOLDER, [...roots].reverse())
      ).resolves.toEqual({ changes: 2 });
      const reordered = await call<Row[]>('db-outline-list-by-folder', FOLDER);
      const act2 = reordered.find((r) => r.title === '第二幕');
      expect(act2?.sort_order).toBe(0);

      const cleared = await call<RunResult>('db-outline-clear-by-folder', FOLDER);
      expect(cleared.changes).toBe(3);
      await expect(call('db-outline-list-by-folder', FOLDER)).resolves.toEqual([]);
    });

    it('章节 / 卷作用域相互隔离；缺少 path 的 scope 回落到项目级', async () => {
      const chapter = { kind: 'chapter', path: `${FOLDER}/第1章.md` };
      const volume = { kind: 'volume', path: `${FOLDER}/卷一` };
      await call('db-outline-replace-by-folder', FOLDER, [{ title: '章节大纲' }], chapter);
      await call('db-outline-replace-by-folder', FOLDER, [{ title: '卷大纲' }], volume);
      await call('db-outline-replace-by-folder', FOLDER, [{ title: '项目大纲' }], {
        kind: 'chapter',
      });

      const chapterRows = await call<Row[]>('db-outline-list-by-folder', FOLDER, chapter);
      expect(chapterRows.map((r) => r.title)).toEqual(['章节大纲']);
      expect(chapterRows[0].scope_kind).toBe('chapter');
      const volumeRows = await call<Row[]>('db-outline-list-by-folder', FOLDER, volume);
      expect(volumeRows.map((r) => r.title)).toEqual(['卷大纲']);
      const projectRows = await call<Row[]>('db-outline-list-by-folder', FOLDER);
      expect(projectRows.map((r) => r.title)).toEqual(['项目大纲']);
    });
  });

  describe('大纲版本', () => {
    const payload = {
      name: 'v1',
      source: 'manual',
      entries: [{ title: '第一幕', children: [{ title: '场景' }] }],
    };

    it('项目不存在时：列表为空，创建/应用抛错', async () => {
      await expect(call('db-outline-version-list-by-folder', '/missing')).resolves.toEqual([]);
      await expect(
        call('db-outline-version-create-by-folder', '/missing', payload)
      ).rejects.toThrow('项目不存在，无法保存大纲版本');
      await expect(call('db-outline-version-apply-by-folder', '/missing', 1)).rejects.toThrow(
        '项目不存在，无法应用大纲版本'
      );
    });

    it('创建、列出、更新、应用、删除', async () => {
      const created = await call<RunResult>('db-outline-version-create-by-folder', FOLDER, payload);
      const versionId = Number(created.lastInsertRowid);
      const list = await call<Row[]>('db-outline-version-list-by-folder', FOLDER);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ name: 'v1', source: 'manual', note: '' });

      await call('db-outline-version-update', versionId, { name: '定稿', note: '备注' });
      const updated = await call<Row[]>('db-outline-version-list-by-folder', FOLDER);
      expect(updated[0]).toMatchObject({ name: '定稿', note: '备注' });

      await expect(call('db-outline-version-apply-by-folder', FOLDER, versionId)).resolves.toEqual({
        changes: 1,
      });
      const rows = await call<Row[]>('db-outline-list-by-folder', FOLDER);
      expect(rows.map((r) => r.title).sort()).toEqual(['场景', '第一幕']);

      await call('db-outline-version-delete', versionId);
      await expect(call('db-outline-version-list-by-folder', FOLDER)).resolves.toEqual([]);
    });

    it('非法 source 被拒绝', async () => {
      await expect(
        call('db-outline-version-create-by-folder', FOLDER, { ...payload, source: 'hack' })
      ).rejects.toThrow('Unsupported outline version source');
    });

    it('拒绝应用不存在 / 其它作用域 / 其它项目的版本', async () => {
      await expect(call('db-outline-version-apply-by-folder', FOLDER, 9999)).rejects.toThrow(
        '大纲版本不存在或不属于当前项目'
      );

      const chapter = { kind: 'chapter', path: `${FOLDER}/第1章.md` };
      const chapterVersion = await call<RunResult>(
        'db-outline-version-create-by-folder',
        FOLDER,
        payload,
        chapter
      );
      // 章节版本不能被应用到项目级
      await expect(
        call('db-outline-version-apply-by-folder', FOLDER, Number(chapterVersion.lastInsertRowid))
      ).rejects.toThrow('大纲版本不存在或不属于当前项目');
      // 同作用域可以应用
      await expect(
        call(
          'db-outline-version-apply-by-folder',
          FOLDER,
          Number(chapterVersion.lastInsertRowid),
          chapter
        )
      ).resolves.toEqual({ changes: 1 });

      const OTHER = '/Users/me/Novels/别的书';
      await call('db-novel-create', '别的书', OTHER);
      const otherVersion = await call<RunResult>(
        'db-outline-version-create-by-folder',
        OTHER,
        payload
      );
      await expect(
        call('db-outline-version-apply-by-folder', FOLDER, Number(otherVersion.lastInsertRowid))
      ).rejects.toThrow('大纲版本不存在或不属于当前项目');
    });

    // BUG（database.ts:464-468）：项目级旧数据的 scope_path 为 ''，store 的
    // buildOutlineScopeWhere 专门兼容了它，所以 db-outline-version-list-by-folder 会把它列出来；
    // 但 apply 时严格比较 version.scope_path !== folderPath，导致列表里能看到的旧版本无法应用。
    it('项目级旧版本（scope_path 为空）出现在列表中，也应能被应用', async () => {
      const legacy = store.outlineVersionOps.create(novelId, '旧版本', 'import', '', [
        { title: '旧大纲' },
      ]);
      const list = await call<Row[]>('db-outline-version-list-by-folder', FOLDER);
      expect(list.map((r) => r.name)).toContain('旧版本');
      await expect(
        call('db-outline-version-apply-by-folder', FOLDER, Number(legacy.lastInsertRowid))
      ).resolves.toEqual({ changes: 1 });
    });
  });

  describe('三签创意卡', () => {
    it('项目不存在时：列表为空，创建卡片与保存候选抛错', async () => {
      await expect(call('db-story-idea-card-list-by-folder', '/missing')).resolves.toEqual([]);
      await expect(
        call('db-story-idea-card-create-by-folder', '/missing', { title: 'x' })
      ).rejects.toThrow('项目不存在，无法创建三签创意卡');
      await expect(
        call('db-story-idea-output-replace-by-folder', '/missing', 1, 'logline', [])
      ).rejects.toThrow('项目不存在，无法保存三签候选');
    });

    it('卡片与候选的完整流程', async () => {
      const card = await call<RunResult>('db-story-idea-card-create-by-folder', FOLDER, {
        title: '时间小偷',
        premise: '偷时间的人',
        themeSeed: '代价',
      });
      const cardId = Number(card.lastInsertRowid);
      const cards = await call<Row[]>('db-story-idea-card-list-by-folder', FOLDER);
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({
        title: '时间小偷',
        source: 'manual',
        status: 'draft',
        theme_seed: '代价',
      });

      await call('db-story-idea-card-update', cardId, { status: 'exploring', note: '想法' });
      const afterUpdate = await call<Row[]>('db-story-idea-card-list-by-folder', FOLDER);
      expect(afterUpdate[0]).toMatchObject({ status: 'exploring', note: '想法' });

      await expect(
        call('db-story-idea-output-replace-by-folder', FOLDER, cardId, 'logline', [
          { content: 'A' },
          { content: 'B', isSelected: true },
        ])
      ).resolves.toEqual({ changes: 2 });
      let outputs = await call<Row[]>('db-story-idea-output-list', cardId);
      expect(outputs.map((o) => [o.content, o.is_selected])).toEqual([
        ['A', 0],
        ['B', 1],
      ]);

      const idA = Number(outputs[0].id);
      await expect(call('db-story-idea-output-select', idA)).resolves.toEqual({ changes: 1 });
      outputs = await call<Row[]>('db-story-idea-output-list', cardId);
      expect(outputs.map((o) => o.is_selected)).toEqual([1, 0]);
      await expect(call('db-story-idea-output-select', 9999)).resolves.toEqual({ changes: 0 });

      await call('db-story-idea-output-update', idA, { content: 'A+' });
      outputs = await call<Row[]>('db-story-idea-output-list', cardId);
      expect(outputs[0].content).toBe('A+');

      await call('db-story-idea-output-delete', idA);
      await expect(call<Row[]>('db-story-idea-output-list', cardId)).resolves.toHaveLength(1);

      await call('db-story-idea-card-delete', cardId);
      await expect(call('db-story-idea-card-list-by-folder', FOLDER)).resolves.toEqual([]);
    });

    it('非法状态 / 候选类型被拒绝', async () => {
      await expect(
        call('db-story-idea-card-create-by-folder', FOLDER, { title: 'x', status: 'bogus' })
      ).rejects.toThrow('Unsupported story idea status');
      const card = await call<RunResult>('db-story-idea-card-create-by-folder', FOLDER, {
        title: 'ok',
      });
      await expect(
        call(
          'db-story-idea-output-replace-by-folder',
          FOLDER,
          Number(card.lastInsertRowid),
          'bogus',
          []
        )
      ).rejects.toThrow('Unsupported story idea output type');
    });
  });

  describe('世界设定', () => {
    it('项目不存在时：列表为空，创建/批量创建抛错，清空返回 0', async () => {
      await expect(call('db-world-setting-list-by-folder', '/missing')).resolves.toEqual([]);
      await expect(
        call('db-world-setting-create-by-folder', '/missing', 'world', 't')
      ).rejects.toThrow('项目不存在，无法创建设定条目');
      await expect(call('db-world-setting-bulk-create-by-folder', '/missing', [])).rejects.toThrow(
        '项目不存在，无法导入设定条目'
      );
      await expect(call('db-world-setting-clear-by-folder', '/missing')).resolves.toEqual({
        changes: 0,
      });
    });

    it('创建（默认 content/tags）、批量创建、更新、删除、清空', async () => {
      const created = await call<RunResult>(
        'db-world-setting-create-by-folder',
        FOLDER,
        'magic',
        '魔法体系'
      );
      const id = Number(created.lastInsertRowid);
      let list = await call<Row[]>('db-world-setting-list-by-folder', FOLDER);
      expect(list[0]).toMatchObject({
        category: 'magic',
        title: '魔法体系',
        content: '',
        tags: '[]',
      });

      await call('db-world-setting-bulk-create-by-folder', FOLDER, [
        { category: 'map', title: '北境' },
        { category: 'map', title: '南海', content: '海', tags: '["海"]' },
      ]);
      list = await call<Row[]>('db-world-setting-list-by-folder', FOLDER);
      expect(list).toHaveLength(3);

      await call('db-world-setting-update', id, { content: '元素魔法' });
      list = await call<Row[]>('db-world-setting-list-by-folder', FOLDER);
      expect(list.find((r) => Number(r.id) === id)?.content).toBe('元素魔法');

      await call('db-world-setting-delete', id);
      list = await call<Row[]>('db-world-setting-list-by-folder', FOLDER);
      expect(list).toHaveLength(2);

      const cleared = await call<RunResult>('db-world-setting-clear-by-folder', FOLDER);
      expect(cleared.changes).toBe(2);
    });
  });

  describe('写作统计', () => {
    it('记录、按区间查询、今日统计', async () => {
      const today = new Date().toISOString().slice(0, 10);
      await call('db-stats-record', novelId, '2026-01-01', 100, 60);
      await call('db-stats-record', novelId, today, 500, 120);
      const range = await call<Row[]>('db-stats-range', novelId, '2026-01-01', '2026-01-31');
      expect(range).toHaveLength(1);
      expect(range[0]).toMatchObject({ word_count: 100, duration_seconds: 60 });
      const todayRow = await call<Row | undefined>('db-stats-today', novelId);
      expect(todayRow).toBeDefined();
    });
  });

  describe('设置', () => {
    it('set 后广播 settings-updated 给未销毁的窗口', async () => {
      const alive = fakeWindow();
      const dead = fakeWindow(true);
      electronState.windows = [alive, dead];
      await call('db-settings-set', 'theme', 'dark');
      expect(alive.webContents.send).toHaveBeenCalledWith('settings-updated', 'theme');
      expect(dead.webContents.send).not.toHaveBeenCalled();
      await expect(call('db-settings-get', 'theme')).resolves.toBe('dark');
      const all = await call<Array<{ key: string; value: string }>>('db-settings-all');
      expect(all).toContainEqual(expect.objectContaining({ key: 'theme', value: 'dark' }));
    });

    it('按前缀删除时过滤空白/非字符串前缀并逐个广播', async () => {
      await call('db-settings-set', 'ai:a', '1');
      await call('db-settings-set', 'ai:b', '2');
      await call('db-settings-set', 'ui:c', '3');
      const win = fakeWindow();
      electronState.windows = [win, fakeWindow(true)];
      const result = await call<{ removed: number }>('db-settings-delete-prefixes', [
        'ai:',
        '  ',
        42,
        '',
      ]);
      expect(result.removed).toBe(2);
      expect(win.webContents.send).toHaveBeenCalledTimes(1);
      expect(win.webContents.send).toHaveBeenCalledWith('settings-updated', 'ai:');
      await expect(call('db-settings-get', 'ui:c')).resolves.toBe('3');
      await expect(call('db-settings-get', 'ai:a')).resolves.toBeUndefined();
    });
  });

  describe('AI 缓存', () => {
    it('get/set/delete/getByType/clearByType/cleanup/touchKeys', async () => {
      await call('ai-cache-set', 'k1', 'summary', 'v1');
      await call('ai-cache-set', 'k2', 'summary', 'v2');
      await call('ai-cache-set', 'k3', 'other', 'v3');
      await expect(call('ai-cache-get', 'k1', 'summary')).resolves.toBe('v1');
      await expect(call('ai-cache-get', 'k1', 'other')).resolves.toBeUndefined();

      const byType = await call<Array<{ cache_key: string }>>('ai-cache-get-by-type', 'summary');
      expect(byType.map((r) => r.cache_key).sort()).toEqual(['k1', 'k2']);

      await call('ai-cache-delete', 'k1', 'summary');
      await expect(call('ai-cache-get', 'k1', 'summary')).resolves.toBeUndefined();

      await call('ai-cache-touch-keys', [{ cacheKey: 'k2', type: 'summary' }]);
      await expect(call('ai-cache-cleanup', 30)).resolves.toBe(0);

      await call('ai-cache-clear-by-type', 'summary');
      await expect(call('ai-cache-get-by-type', 'summary')).resolves.toEqual([]);
      await expect(call('ai-cache-get', 'k3', 'other')).resolves.toBe('v3');
    });
  });

  describe('导入 / 导出', () => {
    it('db-export 与 db-import 往返', async () => {
      await call('db-character-create', novelId, '林舟');
      const data = await call<{ novels: Row[]; characters: Row[] }>('db-export');
      expect(data.novels).toHaveLength(1);
      expect(data.characters).toHaveLength(1);

      await call('db-novel-delete', novelId);
      await expect(call('db-novel-list')).resolves.toEqual([]);
      await expect(call('db-import', data)).resolves.toEqual({ success: true });
      const novels = await call<Row[]>('db-novel-list');
      expect(novels.map((n) => n.name)).toEqual(['星河']);
    });

    it('db-export-to-file：取消返回 null，确认后写出 JSON', async () => {
      await expect(call('db-export-to-file')).resolves.toBeNull();
      electronState.saveResult = { canceled: false };
      await expect(call('db-export-to-file')).resolves.toBeNull();

      const out = path.join(tmp('ne-db-export-'), 'out.json');
      electronState.saveResult = { canceled: false, filePath: out };
      await expect(call('db-export-to-file')).resolves.toBe(out);
      const parsed = JSON.parse(await readFile(out, 'utf-8')) as { novels: Row[] };
      expect(parsed.novels[0].name).toBe('星河');
      const opts = showSaveDialog.mock.calls.at(-1) as unknown[] | undefined;
      expect(JSON.stringify(opts)).toMatch(/novel-editor-export-\d{4}-\d{2}-\d{2}\.json/);
    });

    it('db-import-from-file：取消返回 null，确认后导入；坏 JSON 抛错', async () => {
      await expect(call('db-import-from-file')).resolves.toBeNull();

      const exported = await call('db-export');
      await call('db-novel-delete', novelId);
      const file = path.join(tmp('ne-db-import-'), 'in.json');
      await writeFile(file, JSON.stringify(exported), 'utf-8');
      electronState.openResult = { canceled: false, filePaths: [file] };
      await expect(call('db-import-from-file')).resolves.toEqual({
        success: true,
        filePath: file,
      });
      await expect(call<Row[]>('db-novel-list')).resolves.toHaveLength(1);

      const bad = path.join(path.dirname(file), 'bad.json');
      await writeFile(bad, '{not json', 'utf-8');
      electronState.openResult = { canceled: false, filePaths: [bad] };
      await expect(call('db-import-from-file')).rejects.toThrow();
      // 坏文件不应破坏已有数据
      await expect(call<Row[]>('db-novel-list')).resolves.toHaveLength(1);
    });
  });

  describe('db-export-knowledge-text', () => {
    const MAT = 'novel-editor:assistant-artifact:materials:';

    async function seedKnowledge() {
      await call(
        'db-character-create',
        novelId,
        '白鹤',
        '配角',
        '剑客',
        '{"aliases":[" 鹤 ", 1, ""]}'
      );
      await call('db-character-create', novelId, '林舟', '男主', '', 'not-json');
      await call(
        'db-character-create',
        novelId,
        '阿九',
        '路人',
        '小贩',
        '{"category":"major","aliases":"x"}'
      );
      await call(
        'db-world-setting-create-by-folder',
        FOLDER,
        'magic',
        '魔法',
        '元素',
        '["火"," 水 ",3]'
      );
      await call('db-world-setting-create-by-folder', FOLDER, '', '', '', 'broken');
      await call(
        'db-settings-set',
        `${MAT}chapter:${FOLDER}/第1章.md`,
        JSON.stringify([
          { title: ' 古剑图谱 ', summary: ' 记载 ', kind: '', relatedChapter: '第1章' },
          { title: '   ' },
          { summary: 'no title' },
        ])
      );
      await call(
        'db-settings-set',
        `${MAT}project:${FOLDER.toUpperCase()}`,
        JSON.stringify([{ title: '大小写不敏感匹配' }])
      );
      await call(
        'db-settings-set',
        `${MAT}volume:${FOLDER}/卷一`,
        JSON.stringify([{ title: '卷资料', kind: 'map' }])
      );
      // 以下都应被忽略
      await call(
        'db-settings-set',
        `${MAT}chapter:/Users/me/Novels/星河外传/a.md`,
        '[{"title":"外部"}]'
      );
      await call('db-settings-set', `${MAT}weird:${FOLDER}/x`, '[{"title":"未知作用域"}]');
      await call('db-settings-set', `${MAT}:${FOLDER}`, '[{"title":"空作用域"}]');
      await call('db-settings-set', `${MAT}chapter:`, '[{"title":"空路径"}]');
      await call('db-settings-set', `${MAT}chapter:${FOLDER}/b.md`, '{bad');
      await call('db-settings-set', `${MAT}chapter:${FOLDER}/c.md`, '{"title":"不是数组"}');
    }

    it('项目不存在时抛错；全部取消勾选时抛错', async () => {
      await expect(call('db-export-knowledge-text', '/missing')).rejects.toThrow(
        '项目不存在，无法导出角色卡、设定与资料'
      );
      await expect(
        call('db-export-knowledge-text', FOLDER, {
          includeCharacters: false,
          includeLore: false,
          includeMaterials: false,
        })
      ).rejects.toThrow('请至少选择一种导出内容');
      expect(showSaveDialog).not.toHaveBeenCalled();
    });

    it('取消保存对话框返回 null 且不写文件', async () => {
      await expect(call('db-export-knowledge-text', FOLDER)).resolves.toBeNull();
      const opts = JSON.stringify(showSaveDialog.mock.calls[0]);
      expect(opts).toContain('星河-角色设定资料导出-');
    });

    it('导出完整的角色卡 / 设定 / 资料 Markdown', async () => {
      await seedKnowledge();
      const out = path.join(tmp('ne-knowledge-'), 'k.md');
      electronState.saveResult = { canceled: false, filePath: out };
      await expect(call('db-export-knowledge-text', FOLDER)).resolves.toBe(out);
      const md = await readFile(out, 'utf-8');

      expect(md.startsWith('# 星河 - 创作资料导出\n')).toBe(true);
      expect(md).toContain(`项目目录：${FOLDER}`);
      expect(md).toContain('导出范围：角色卡 / 设定资料 / 资料卡');
      expect(md.endsWith('\n')).toBe(true);
      expect(md.endsWith('\n\n')).toBe(false);

      // 角色：主要角色优先（role 推断 + category 显式），然后按名字排序
      const charSection = md.slice(md.indexOf('## 角色卡'), md.indexOf('## 设定资料'));
      const names = [...charSection.matchAll(/### \d+\. (.+)/g)].map((m) => m[1]);
      expect(names.slice(0, 2).sort()).toEqual(['林舟', '阿九'].sort());
      expect(names[2]).toBe('白鹤');
      expect(charSection).toMatch(/白鹤\n- 分类：次要角色\n- 定位：配角\n- 描述：剑客\n- 别名：鹤/);
      expect(charSection).toMatch(
        /林舟\n- 分类：主要角色\n- 定位：男主\n- 描述：未填写\n- 别名：无/
      );
      expect(charSection).toMatch(/阿九\n- 分类：主要角色\n- 定位：路人/);

      const loreSection = md.slice(md.indexOf('## 设定资料'), md.indexOf('## 资料卡'));
      expect(loreSection).toMatch(/### \d\. 魔法\n/);
      expect(loreSection).toContain('魔法\n- 分类：magic\n- 标签：火、水\n- 内容：元素');
      expect(loreSection).toContain('未命名设定\n- 分类：world\n- 标签：无\n- 内容：未填写');

      const matSection = md.slice(md.indexOf('## 资料卡'));
      expect(matSection).toContain('古剑图谱\n- 类型：reference\n- 作用域：章节');
      expect(matSection).toContain('- 关联章节：第1章\n- 内容：记载');
      expect(matSection).toContain('大小写不敏感匹配\n- 类型：reference\n- 作用域：项目');
      expect(matSection).toContain('卷资料\n- 类型：map\n- 作用域：卷');
      expect(matSection).toContain('- 关联章节：未填写\n- 内容：未填写');
      for (const ignored of ['外部', '未知作用域', '空作用域', '空路径', '不是数组', 'no title']) {
        expect(md).not.toContain(ignored);
      }
      expect([...matSection.matchAll(/### \d+\./g)]).toHaveLength(3);
    });

    it('只导出选中的部分；空数据时给出占位', async () => {
      const out = path.join(tmp('ne-knowledge-'), 'k.md');
      electronState.saveResult = { canceled: false, filePath: out };
      await call('db-export-knowledge-text', FOLDER, { includeLore: false });
      const md = await readFile(out, 'utf-8');
      expect(md).toContain('导出范围：角色卡 / 资料卡');
      expect(md).toContain('（暂无角色）');
      expect(md).toContain('（暂无资料）');
      expect(md).not.toContain('## 设定资料');

      await call('db-export-knowledge-text', FOLDER, {
        includeCharacters: false,
        includeMaterials: false,
      });
      const loreOnly = await readFile(out, 'utf-8');
      expect(loreOnly).toContain('导出范围：设定资料');
      expect(loreOnly).toContain('（暂无设定）');
      expect(loreOnly).not.toContain('## 角色卡');
    });
  });
});
