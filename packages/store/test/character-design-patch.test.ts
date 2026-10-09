import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('better-sqlite3', async () => ({
  default: (await import('./helpers/sqlite-shim')).SqliteShim,
}));
import { initDatabase, closeDatabase, getDatabase } from '../src/db/connection';
import { characterOps } from '../src/db/characters';
let root: string;
let id: number;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ne-design-patch-'));
  const db = initDatabase(root);
  const novel = db
    .prepare('INSERT INTO novels (name, folder_path) VALUES (?, ?)')
    .run('作品', root);
  id = Number(
    characterOps.create(
      Number(novel.lastInsertRowid),
      '人物',
      '',
      '',
      JSON.stringify({ avatar: 'portrait.png', design: { appearance: '旧外貌', outfit: '旧衣服' } })
    ).lastInsertRowid
  );
});
afterEach(async () => {
  closeDatabase();
  await rm(root, { recursive: true, force: true });
});
it('merges disjoint field edits into the current persisted attributes, rejecting same-field stale edits', () => {
  characterOps.patchAttributeFields(id, 'design', { outfit: '蓝衣' }, { outfit: '旧衣服' });
  characterOps.patchAttributeFields(id, 'design', { appearance: '黑发' }, { appearance: '旧外貌' });
  expect(() =>
    characterOps.patchAttributeFields(
      id,
      'design',
      { appearance: '覆盖' },
      { appearance: '旧外貌' }
    )
  ).toThrow('已被修改');
  const row = getDatabase().prepare('SELECT attributes FROM characters WHERE id = ?').get(id) as {
    attributes: string;
  };
  expect(JSON.parse(row.attributes)).toEqual({
    avatar: 'portrait.png',
    design: { appearance: '黑发', outfit: '蓝衣' },
  });
});

it('merges avatar, category and added AI aliases against current attributes without reverting design', () => {
  characterOps.patchAttributeFields(id, 'design', { outfit: '最新衣服' }, { outfit: '旧衣服' });
  characterOps.update(id, { attributePatch: { avatar: 'new.png' } });
  characterOps.update(id, {
    attributePatch: { category: 'major', media: [{ id: 'saved-media' }] },
  });
  characterOps.update(id, { appendAliases: ['作者刚补的别名'] });
  characterOps.update(id, { role: '主角', appendAliases: ['AI 别名'] });
  const row = getDatabase()
    .prepare('SELECT role, attributes FROM characters WHERE id = ?')
    .get(id) as { role: string; attributes: string };
  expect(row.role).toBe('主角');
  expect(JSON.parse(row.attributes)).toEqual({
    avatar: 'new.png',
    category: 'major',
    media: [{ id: 'saved-media' }],
    design: { appearance: '旧外貌', outfit: '最新衣服' },
    aliases: ['作者刚补的别名', 'AI 别名'],
  });
});

it('keeps explicit raw replacement compatible but rejects ambiguous replacement plus patch', () => {
  characterOps.update(id, { attributes: '{"custom":true}' });
  expect(() =>
    characterOps.update(id, {
      name: '不该更名',
      attributes: '{}',
      attributePatch: { avatar: 'a.png' },
    })
  ).toThrow();
  const row = getDatabase()
    .prepare('SELECT name, attributes FROM characters WHERE id = ?')
    .get(id) as { name: string; attributes: string };
  expect(row).toEqual({ name: '人物', attributes: '{"custom":true}' });
});
