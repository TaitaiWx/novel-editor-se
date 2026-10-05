import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { sqliteAvailable } from './helpers/sqlite-shim';

// better-sqlite3 针对 Electron ABI 编译，纯 Node 下无法加载，用 node:sqlite shim 替代
vi.mock('better-sqlite3', async () => {
  const { SqliteShim } = await import('./helpers/sqlite-shim');
  return { default: SqliteShim };
});

import {
  aiCacheOps,
  characterOps,
  closeDatabase,
  exportAllData,
  getDatabase,
  importData,
  initDatabase,
  isDatabaseReady,
  novelOps,
  outlineOps,
  outlineVersionOps,
  settingsOps,
  statsOps,
  storyIdeaOps,
  worldSettingOps,
} from '../src';
import { hasColumn } from '../src/db/schema';

type Row = Record<string, unknown>;

describe.skipIf(!sqliteAvailable)('store/database（node:sqlite shim）', () => {
  let dir = '';
  let novelId = 0;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ne-store-'));
    initDatabase(dir, 'test.db');
    novelId = Number(novelOps.create('测试小说', '/novels/test').lastInsertRowid);
  });

  afterEach(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it('连接管理：初始化、复用与关闭', () => {
    expect(isDatabaseReady()).toBe(true);
    const db = getDatabase();
    expect(initDatabase(dir, 'test.db')).toBe(db);
    closeDatabase();
    expect(isDatabaseReady()).toBe(false);
    expect(() => getDatabase()).toThrow('Database not initialized');
    initDatabase(dir, 'test.db');
  });

  it('迁移会为旧版 outlines / outline_versions 表补齐新列', () => {
    closeDatabase();
    const legacyDir = mkdtempSync(join(tmpdir(), 'ne-store-legacy-'));
    try {
      const legacy = initDatabase(legacyDir, 'legacy.db');
      legacy.exec('DROP TABLE outlines;');
      legacy.exec(`CREATE TABLE outlines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT DEFAULT '',
        parent_id INTEGER DEFAULT NULL,
        sort_order INTEGER DEFAULT 0
      );`);
      expect(hasColumn(legacy, 'outlines', 'scope_kind')).toBe(false);
      closeDatabase();

      const migrated = initDatabase(legacyDir, 'legacy.db');
      for (const column of ['scope_kind', 'scope_path', 'anchor_text', 'line_hint']) {
        expect(hasColumn(migrated, 'outlines', column)).toBe(true);
      }
      expect(hasColumn(migrated, 'outline_versions', 'story_idea_snapshot_json')).toBe(true);
    } finally {
      closeDatabase();
      rmSync(legacyDir, { recursive: true, force: true });
      initDatabase(dir, 'test.db');
    }
  });

  it('novelOps：增删改查', () => {
    expect((novelOps.getByFolder('/novels/test') as Row).name).toBe('测试小说');
    novelOps.update(novelId, { description: '简介' });
    expect((novelOps.getById(novelId) as Row).description).toBe('简介');
    expect(novelOps.getAll()).toHaveLength(1);
    novelOps.delete(novelId);
    expect(novelOps.getById(novelId)).toBeUndefined();
  });

  it('characterOps：排序号递增、白名单更新、重排', () => {
    const a = Number(characterOps.create(novelId, '林动', '主角').lastInsertRowid);
    const b = Number(characterOps.create(novelId, '绫清竹', '女主').lastInsertRowid);
    let rows = characterOps.getByNovel(novelId) as Row[];
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1]);

    characterOps.update(a, { role: '少年', evil: 'x' } as never);
    characterOps.reorder([b, a]);
    rows = characterOps.getByNovel(novelId) as Row[];
    expect(rows.map((r) => r.name)).toEqual(['绫清竹', '林动']);
    expect(rows[1].role).toBe('少年');

    characterOps.clearByNovel(novelId);
    expect(characterOps.getByNovel(novelId)).toEqual([]);
  });

  it('worldSettingOps：批量创建与更新', () => {
    expect(worldSettingOps.bulkCreate(novelId, [])).toEqual({ changes: 0 });
    worldSettingOps.bulkCreate(novelId, [
      { category: '技能', title: '火球术' },
      { category: '地图', title: '青阳镇', content: '起点', tags: '["城镇"]' },
    ]);
    const rows = worldSettingOps.getByNovel(novelId) as Row[];
    expect(rows).toHaveLength(2);
    const town = rows.find((r) => r.title === '青阳镇') as Row;
    expect(town.tags).toBe('["城镇"]');
    worldSettingOps.update(Number(town.id), { content: '故乡' });
    expect(
      (worldSettingOps.getByNovel(novelId) as Row[]).find((r) => r.id === town.id)?.content
    ).toBe('故乡');
  });

  it('outlineOps：按作用域整树替换', () => {
    outlineOps.replaceTree(novelId, [
      { title: '第一卷', children: [{ title: '第一章', lineHint: 3 }, { title: '第二章' }] },
    ]);
    outlineOps.replaceTree(novelId, [{ title: '章节大纲' }], { kind: 'chapter', path: 'a.md' });

    const project = outlineOps.getByNovel(novelId) as Row[];
    expect(project.map((r) => r.title)).toEqual(['第一卷', '第一章', '第二章']);
    const parentId = project[0].id;
    expect(project[1].parent_id).toBe(parentId);
    expect(project[1].line_hint).toBe(3);

    const chapter = outlineOps.getByScope(novelId, { kind: 'chapter', path: 'a.md' }) as Row[];
    expect(chapter.map((r) => r.title)).toEqual(['章节大纲']);

    outlineOps.clearByNovel(novelId);
    expect(outlineOps.getByNovel(novelId)).toEqual([]);
    expect(outlineOps.getByScope(novelId, { kind: 'chapter', path: 'a.md' })).toHaveLength(1);
  });

  it('outlineVersionOps：快照、解析树、校验来源', () => {
    const tree = [{ title: 'A', children: [{ title: 'A1' }] }];
    const id = Number(
      outlineVersionOps.create(novelId, 'v1', 'manual', '备注', tree).lastInsertRowid
    );
    const version = outlineVersionOps.getById(id);
    expect(version?.total_nodes).toBe(2);
    expect(version?.tree).toEqual(tree);
    expect(outlineVersionOps.listByNovel(novelId)).toHaveLength(1);

    expect(outlineVersionOps.update(id, {})).toEqual({ changes: 0 });
    outlineVersionOps.update(id, { name: 'v1-改' });
    expect(outlineVersionOps.getById(id)?.name).toBe('v1-改');

    expect(() => outlineVersionOps.create(novelId, 'bad', 'oops' as never, '', [])).toThrow(
      'Unsupported outline version source'
    );
    outlineVersionOps.delete(id);
    expect(outlineVersionOps.getById(id)).toBeUndefined();
  });

  it('storyIdeaOps：创意卡与衍生候选', () => {
    const cardId = Number(storyIdeaOps.createCard(novelId, { title: '复仇' }).lastInsertRowid);
    expect(storyIdeaOps.getCardById(cardId)).toMatchObject({ source: 'manual', status: 'draft' });
    expect(() => storyIdeaOps.createCard(novelId, { title: 'x', status: 'bad' as never })).toThrow(
      'Unsupported story idea status'
    );
    expect(() => storyIdeaOps.updateCard(cardId, { source: 'bad' as never })).toThrow(
      'Unsupported story idea source'
    );
    storyIdeaOps.updateCard(cardId, { status: 'exploring', theme_seed: '成长' });
    expect(storyIdeaOps.getCardById(cardId)).toMatchObject({
      status: 'exploring',
      theme_seed: '成长',
    });

    storyIdeaOps.replaceOutputs(novelId, cardId, 'logline', [
      { content: '一句话 A' },
      { content: '一句话 B', isSelected: true },
    ]);
    const outputs = storyIdeaOps.listOutputsByCard(cardId);
    expect(outputs.map((o) => o.is_selected)).toEqual([0, 1]);

    storyIdeaOps.selectOutput(outputs[0].id);
    expect(storyIdeaOps.listOutputsByCard(cardId).map((o) => o.is_selected)).toEqual([1, 0]);
    expect(storyIdeaOps.selectOutput(99999)).toEqual({ changes: 0 });

    storyIdeaOps.clearOutputSelection(cardId, 'logline');
    expect(storyIdeaOps.listOutputsByCard(cardId).every((o) => o.is_selected === 0)).toBe(true);

    storyIdeaOps.deleteCard(cardId);
    expect(storyIdeaOps.listCardsByNovel(novelId)).toEqual([]);
  });

  it('statsOps：同日累计', () => {
    statsOps.record(novelId, '2026-01-01', 100, 60);
    statsOps.record(novelId, '2026-01-01', 50, 30);
    statsOps.record(novelId, '2026-01-02', 10, 5);
    const rows = statsOps.getByNovelAndRange(novelId, '2026-01-01', '2026-01-31') as Row[];
    expect(rows.map((r) => [r.date, r.word_count, r.duration_seconds])).toEqual([
      ['2026-01-01', 150, 90],
      ['2026-01-02', 10, 5],
    ]);
  });

  it('settingsOps：upsert 与按前缀删除', () => {
    settingsOps.set('ai.key', '1');
    settingsOps.set('ai.key', '2');
    settingsOps.set('ai.model', 'm');
    settingsOps.set('theme', 'dark');
    expect(settingsOps.get('ai.key')).toBe('2');
    expect(settingsOps.deleteByPrefixes(['ai.'])).toBe(2);
    expect(settingsOps.getAll()).toEqual([{ key: 'theme', value: 'dark' }]);
  });

  it('aiCacheOps：读写、按类型查询、TTL 清理', () => {
    aiCacheOps.set('k1', 'summary', 'v1');
    aiCacheOps.set('k1', 'summary', 'v2');
    aiCacheOps.set('k2', 'title', 't');
    expect(aiCacheOps.get('k1', 'summary')).toBe('v2');
    expect(aiCacheOps.getByType('summary')).toEqual([{ cache_key: 'k1', value: 'v2' }]);

    getDatabase()
      .prepare("UPDATE ai_cache SET created_at = datetime('now', '-40 days') WHERE cache_key = ?")
      .run('k2');
    aiCacheOps.touchKeys([{ cacheKey: 'k1', type: 'summary' }]);
    expect(aiCacheOps.cleanup(30)).toBe(1);
    expect(aiCacheOps.get('k2', 'title')).toBeUndefined();
  });

  it('exportAllData / importData 往返一致', () => {
    characterOps.create(novelId, '林动');
    settingsOps.set('theme', 'dark');
    outlineOps.replaceTree(novelId, [{ title: '第一卷' }]);
    const snapshot = exportAllData();
    expect(snapshot.novels).toHaveLength(1);

    novelOps.delete(novelId);
    settingsOps.deleteAll();
    importData(snapshot);

    expect((novelOps.getById(novelId) as Row).name).toBe('测试小说');
    expect((characterOps.getByNovel(novelId) as Row[]).map((r) => r.name)).toEqual(['林动']);
    expect(settingsOps.get('theme')).toBe('dark');
    expect(exportAllData().outlines).toEqual(snapshot.outlines);
  });
});
