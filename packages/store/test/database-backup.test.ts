import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SqliteShim } from './helpers/sqlite-shim';
vi.mock('better-sqlite3', async () => ({
  default: (await import('./helpers/sqlite-shim')).SqliteShim,
}));
import { backupDatabaseFile, closeDatabase, initDatabase, getDatabase } from '../src/db/connection';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ne-db-backup-'));
});
afterEach(async () => {
  closeDatabase();
  await rm(dir, { recursive: true, force: true });
});

it('restores committed WAL content from an open database without its WAL or SHM files', async () => {
  const db = initDatabase(dir);
  db.pragma('wal_autocheckpoint = 0');
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('draft', '最新设定');
  expect((await readFile(path.join(dir, 'novel-editor.db-wal'))).length).toBeGreaterThan(0);
  const destination = path.join(dir, 'snapshot.db');
  await backupDatabaseFile(path.join(dir, 'novel-editor.db'), destination);
  db.prepare('UPDATE settings SET value = ?').run('导出之后');
  const restored = new SqliteShim(destination);
  try {
    expect(restored.prepare('SELECT value FROM settings WHERE key = ?').get('draft')).toEqual({
      value: '最新设定',
    });
    expect(restored.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
  } finally {
    restored.close();
  }
  expect(getDatabase()).toBe(db);
});

it('backs up an inactive project without replacing or migrating the currently open database', async () => {
  const active = initDatabase(path.join(dir, 'active'));
  const inactiveDir = path.join(dir, 'inactive');
  await mkdir(inactiveDir);
  const source = path.join(inactiveDir, 'legacy.db');
  const inactive = new SqliteShim(source);
  inactive.exec("CREATE TABLE legacy (value TEXT); INSERT INTO legacy VALUES ('原始项目');");
  inactive.close();
  const destination = path.join(dir, 'snapshot.db');
  await backupDatabaseFile(source, destination);
  const restored = new SqliteShim(destination);
  try {
    expect(restored.prepare('SELECT value FROM legacy').get()).toEqual({ value: '原始项目' });
  } finally {
    restored.close();
  }
  expect(getDatabase()).toBe(active);
});

it('reopens the exported project with the same novel, chapter outline and scoped settings bound to its new root', async () => {
  const source = path.join(dir, 'source');
  const target = path.join(dir, 'export');
  const chapter = path.join(source, 'novels/book/01.md');
  const targetChapter = path.join(target, 'novels/book/01.md');
  const db = initDatabase(path.join(source, '.novel-editor'));
  db.prepare('INSERT INTO novels (id, name, folder_path) VALUES (?, ?, ?)').run(
    7,
    '作品',
    path.join(source, 'novels/book')
  );
  db.prepare('INSERT INTO characters (novel_id, name, description) VALUES (?, ?, ?)').run(
    7,
    '主角',
    source
  );
  db.prepare(
    'INSERT INTO outlines (novel_id, scope_kind, scope_path, title, content) VALUES (?, ?, ?, ?, ?)'
  ).run(7, 'chapter', chapter, '章纲', chapter);
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
    `novel-editor:chapter-materials:${chapter}`,
    JSON.stringify([path.join(source, '资料/rules.md')])
  );
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
    `novel-editor:volume-plan:${source}`,
    JSON.stringify({
      intent: chapter,
      suggestions: { [chapter]: [chapter] },
      beatOrder: { [chapter]: [`${chapter}:beat:0`] },
    })
  );
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
    `custom:${source}`,
    JSON.stringify({ content: chapter })
  );
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
    `novel-editor:editor-session:${source}`,
    '{"activeTab":"old"}'
  );
  await mkdir(path.join(target, '.novel-editor'), { recursive: true });
  await backupDatabaseFile(
    path.join(source, '.novel-editor/novel-editor.db'),
    path.join(target, '.novel-editor/novel-editor.db'),
    undefined,
    { sourceRoot: source, destinationRoot: target }
  );
  expect(db.prepare('SELECT folder_path FROM novels WHERE id=7').get()).toEqual({
    folder_path: path.join(source, 'novels/book'),
  });
  closeDatabase();
  const restored = initDatabase(path.join(target, '.novel-editor'));
  expect(
    restored
      .prepare('SELECT id FROM novels WHERE folder_path=?')
      .get(path.join(target, 'novels/book'))
  ).toEqual({ id: 7 });
  expect(
    restored
      .prepare('SELECT title, content FROM outlines WHERE novel_id=7 AND scope_path=?')
      .get(targetChapter)
  ).toEqual({ title: '章纲', content: chapter });
  expect(restored.prepare('SELECT description FROM characters WHERE novel_id=7').get()).toEqual({
    description: source,
  });
  expect(
    restored
      .prepare('SELECT value FROM settings WHERE key=?')
      .get(`novel-editor:chapter-materials:${targetChapter}`)
  ).toEqual({ value: JSON.stringify([path.join(target, '资料/rules.md')]) });
  const plan = restored
    .prepare('SELECT value FROM settings WHERE key=?')
    .get(`novel-editor:volume-plan:${target}`) as { value: string };
  expect(JSON.parse(plan.value)).toEqual({
    intent: chapter,
    suggestions: { [targetChapter]: [chapter] },
    beatOrder: { [targetChapter]: [`${targetChapter}:beat:0`] },
  });
  expect(
    restored.prepare('SELECT value FROM settings WHERE key=?').get(`custom:${source}`)
  ).toEqual({ value: JSON.stringify({ content: chapter }) });
  expect(
    restored
      .prepare("SELECT key FROM settings WHERE key LIKE 'novel-editor:editor-session:%'")
      .all()
  ).toEqual([]);
});
