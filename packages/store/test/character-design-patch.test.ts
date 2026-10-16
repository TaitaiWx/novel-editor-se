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
let novelId: number;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ne-design-patch-'));
  const db = initDatabase(root);
  const novel = db
    .prepare('INSERT INTO novels (name, folder_path) VALUES (?, ?)')
    .run('作品', root);
  novelId = Number(novel.lastInsertRowid);
  id = Number(
    characterOps.create(
      novelId,
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

function savedAttributes() {
  return JSON.parse(
    (
      getDatabase().prepare('SELECT attributes FROM characters WHERE id = ?').get(id) as {
        attributes: string;
      }
    ).attributes
  );
}

it('rolls back earlier attribute groups when a later group has a stale expected value', () => {
  characterOps.update(id, {
    attributePatch: { voice: { age: '20' }, development: { skill: 'latest' } },
  });
  const before = savedAttributes();
  expect(() =>
    characterOps.patchAttributeGroups(id, [
      { section: 'design', patch: { appearance: '黑发' }, expected: { appearance: '旧外貌' } },
      { section: 'voice', patch: { age: '21' }, expected: { age: '20' } },
      { section: 'development', patch: { skill: 'overwritten' }, expected: { skill: 'stale' } },
    ])
  ).toThrow('已被修改');
  expect(savedAttributes()).toEqual(before);
});

it('commits all groups while retaining independent edits and development deletion markers', () => {
  characterOps.update(id, {
    attributePatch: { voice: { timbre: '低沉' }, development: { skill: 'old', other: 'keep' } },
  });
  characterOps.patchAttributeGroups(id, [
    { section: 'design', patch: { appearance: '黑发' }, expected: { appearance: '旧外貌' } },
    { section: 'voice', patch: { age: '21' }, expected: { age: '' } },
    { section: 'development', patch: { skill: '' }, expected: { skill: 'old' } },
  ]);
  expect(savedAttributes()).toEqual({
    avatar: 'portrait.png',
    design: { appearance: '黑发', outfit: '旧衣服' },
    voice: { timbre: '低沉', age: '21' },
    development: { skill: '', other: 'keep' },
  });
});

const suggestion = () => ({
  characterId: id as number | null,
  name: '人物',
  summary: '建议摘要',
  chapter: '第一章.md',
  source: 'text' as const,
  quote: '他穿着蓝衣',
  changes: [{ key: 'outfit', value: '蓝衣', expected: '旧衣服', quote: '他穿着蓝衣' }],
});

it('applies a profile with evidence atomically, preserving unrelated fields', () => {
  expect(characterOps.applyProfileSuggestion(novelId, suggestion())).toEqual({
    characterId: id,
    created: false,
  });
  expect(savedAttributes()).toEqual({
    avatar: 'portrait.png',
    design: { appearance: '旧外貌', outfit: '蓝衣' },
    profileEvidence: {
      outfit: { source: 'text', chapter: '第一章.md', quote: '他穿着蓝衣', at: expect.any(String) },
    },
  });
  const before = savedAttributes();
  expect(() =>
    characterOps.applyProfileSuggestion(novelId, {
      ...suggestion(),
      changes: [
        { key: 'appearance', value: '黑发', expected: '旧外貌', quote: '黑发' },
        ...suggestion().changes,
      ],
    })
  ).toThrow('已被修改');
  expect(savedAttributes()).toEqual(before);
});

it('rejects cross-novel suggestions and normalized duplicate names or aliases without creating rows', () => {
  const otherNovel = Number(
    getDatabase()
      .prepare('INSERT INTO novels (name, folder_path) VALUES (?, ?)')
      .run('另一部', '/other').lastInsertRowid
  );
  const before = savedAttributes();
  expect(() => characterOps.applyProfileSuggestion(otherNovel, suggestion())).toThrow('不属于');
  characterOps.update(id, { appendAliases: ['ＡＬＩＣＥ'] });
  for (const name of [' 人物 ', ' alice ']) {
    expect(() =>
      characterOps.applyProfileSuggestion(novelId, {
        ...suggestion(),
        characterId: null,
        name,
        changes: [],
      })
    ).toThrow('同名');
  }
  expect(characterOps.getByNovel(novelId)).toHaveLength(1);
  expect(characterOps.getByNovel(otherNovel)).toEqual([]);
  expect(savedAttributes().design).toEqual(before.design);
});

it('creates a discovered character with source evidence in the requested novel', () => {
  const result = characterOps.applyProfileSuggestion(novelId, {
    ...suggestion(),
    characterId: null,
    name: ' 新人物 ',
    changes: [],
  });
  expect(result.created).toBe(true);
  const row = (
    characterOps.getByNovel(novelId) as {
      id: number;
      name: string;
      description: string;
      attributes: string;
    }[]
  ).find((character) => character.id === result.characterId)!;
  expect(row).toMatchObject({ name: '新人物', description: '建议摘要' });
  expect(JSON.parse(row.attributes)).toMatchObject({
    category: 'secondary',
    group: '临时人物',
    discoveredFrom: { chapter: '第一章.md', quote: '他穿着蓝衣' },
  });
});
