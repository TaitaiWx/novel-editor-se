import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteShim, sqliteAvailable } from './helpers/sqlite-shim';

vi.mock('better-sqlite3', async () => {
  const { SqliteShim } = await import('./helpers/sqlite-shim');
  return { default: SqliteShim };
});

import { closeDatabase, getDatabase, initDatabase, isDatabaseReady } from '../src/db/connection';

describe.skipIf(!sqliteAvailable)('数据库升级的数据保留', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ne-store-migration-'));
    dbPath = join(dir, 'legacy.db');
  });

  afterEach(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it('为缺少作用域列的旧大纲和版本迁移后保留原始数据及关联', () => {
    const legacy = new SqliteShim(dbPath);
    legacy.exec(`
      CREATE TABLE novels (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
        folder_path TEXT NOT NULL UNIQUE, created_at TEXT, updated_at TEXT
      );
      INSERT INTO novels VALUES (7, '旧作品', '不可丢失', '/novels/legacy', '2024-01-01', '2024-01-02');
      CREATE TABLE outlines (
        id INTEGER PRIMARY KEY, novel_id INTEGER NOT NULL, title TEXT NOT NULL,
        content TEXT, parent_id INTEGER, sort_order INTEGER, created_at TEXT, updated_at TEXT
      );
      INSERT INTO outlines VALUES (11, 7, '第一幕', '原大纲内容', NULL, 0, '2024-01-01', '2024-01-02');
      INSERT INTO outlines VALUES (12, 7, '转折', '原子大纲内容', 11, 1, '2024-01-01', '2024-01-02');
      CREATE TABLE outline_versions (
        id INTEGER PRIMARY KEY, novel_id INTEGER NOT NULL, name TEXT NOT NULL,
        source TEXT NOT NULL, note TEXT, tree_json TEXT NOT NULL,
        total_nodes INTEGER, created_at TEXT
      );
      INSERT INTO outline_versions VALUES (21, 7, '初稿', 'manual', '保留备注', '[{"title":"原版本"}]', 1, '2024-01-01');
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO settings VALUES ('author-preference', '{"theme":"dark"}');
    `);
    legacy.close();

    const migrated = initDatabase(dir, 'legacy.db');
    expect(migrated.prepare('SELECT * FROM novels').get()).toMatchObject({
      id: 7,
      name: '旧作品',
      description: '不可丢失',
      folder_path: '/novels/legacy',
    });
    expect(
      migrated
        .prepare(
          'SELECT id, novel_id, title, content, parent_id, scope_kind, scope_path, anchor_text, line_hint FROM outlines ORDER BY id'
        )
        .all()
    ).toEqual([
      {
        id: 11,
        novel_id: 7,
        title: '第一幕',
        content: '原大纲内容',
        parent_id: null,
        scope_kind: 'project',
        scope_path: '',
        anchor_text: '',
        line_hint: null,
      },
      {
        id: 12,
        novel_id: 7,
        title: '转折',
        content: '原子大纲内容',
        parent_id: 11,
        scope_kind: 'project',
        scope_path: '',
        anchor_text: '',
        line_hint: null,
      },
    ]);
    expect(migrated.prepare('SELECT * FROM outline_versions').get()).toMatchObject({
      id: 21,
      novel_id: 7,
      name: '初稿',
      note: '保留备注',
      tree_json: '[{"title":"原版本"}]',
      scope_kind: 'project',
      scope_path: '',
      story_idea_card_id: null,
      story_idea_snapshot_json: '',
    });
    expect(
      migrated.prepare('SELECT value FROM settings WHERE key = ?').get('author-preference')
    ).toEqual({ value: '{"theme":"dark"}' });
    expect(
      migrated
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_outlines_novel_scope', 'idx_outline_versions_novel_scope_created_at')"
        )
        .all()
    ).toHaveLength(2);

    closeDatabase();
    expect(
      initDatabase(dir, 'legacy.db').prepare('SELECT COUNT(*) AS count FROM outlines').get()
    ).toEqual({ count: 2 });
  });

  it('迁移失败时回滚整个建表和迁移，保留旧数据，清除连接状态并允许修复后重试', () => {
    const legacy = new SqliteShim(dbPath);
    legacy.exec(`
      CREATE TABLE outlines (
        id INTEGER PRIMARY KEY, novel_id INTEGER, title TEXT, content TEXT,
        sort_order INTEGER, scope_kind TEXT, scope_path TEXT
      );
      INSERT INTO outlines VALUES (11, 7, '保留大纲', '不可丢失', 0, 'legacy', '');
      CREATE TRIGGER fail_migration BEFORE UPDATE ON outlines
      BEGIN SELECT RAISE(ABORT, 'migration blocked'); END;
    `);
    legacy.close();

    expect(() => initDatabase(dir, 'legacy.db')).toThrow('migration blocked');
    expect(isDatabaseReady()).toBe(false);
    expect(() => getDatabase()).toThrow('Database not initialized');

    const preserved = new SqliteShim(dbPath);
    try {
      expect(preserved.prepare('SELECT title, content, scope_kind FROM outlines').get()).toEqual({
        title: '保留大纲',
        content: '不可丢失',
        scope_kind: 'legacy',
      });
      expect(preserved.pragma('table_info(outlines)').map((column) => column.name)).not.toContain(
        'anchor_text'
      );
      expect(
        preserved.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
      ).toEqual([{ name: 'outlines' }]);
      preserved.exec('DROP TRIGGER fail_migration');
    } finally {
      preserved.close();
    }

    expect(
      initDatabase(dir, 'legacy.db').prepare('SELECT content, scope_kind FROM outlines').get()
    ).toEqual({ content: '不可丢失', scope_kind: 'project' });
    expect(isDatabaseReady()).toBe(true);
  });

  it('数据库文件无法读取时保留原文件且不暴露失败连接', () => {
    const original = Buffer.from('damaged SQLite file containing irreplaceable data');
    writeFileSync(dbPath, original);

    expect(() => initDatabase(dir, 'legacy.db')).toThrow();
    expect(isDatabaseReady()).toBe(false);
    expect(() => getDatabase()).toThrow('Database not initialized');
    expect(readFileSync(dbPath)).toEqual(original);
    expect(() => initDatabase(dir, 'legacy.db')).toThrow();
    expect(isDatabaseReady()).toBe(false);
  });
});
