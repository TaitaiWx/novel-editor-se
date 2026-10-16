import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DevelopmentEntry } from '@novel-editor/core/character-development';

const { handlers, send, destroyedSend } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  send: vi.fn(),
  destroyedSend: vi.fn(),
}));
// Exercise the handlers, real path authorization and SQL; admission is covered separately.
vi.mock('../../src/main/workspace-ipc', () => ({
  registerWorkspaceHandler: (channel: string, handler: never) => handlers.set(channel, handler),
}));
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      { isDestroyed: () => false, webContents: { send } },
      { isDestroyed: () => true, webContents: { send: destroyedSend } },
    ],
  },
}));
vi.mock('better-sqlite3', async () => ({
  default: (await import('../../../../packages/store/test/helpers/sqlite-shim')).SqliteShim,
}));
import { characterOps, closeDatabase, initDatabase, novelOps } from '@novel-editor/store';
import { grantPathAccess, resetPathAccessForTest } from '../../src/main/path-access';
import { registerCharacterDevelopmentHandlers } from '../../src/main/handlers/database/character-development';

let root: string;
let work: string;
let novelId: number;
let id: number;
let foreignId: number;
const event = { sender: { id: 41 } };
const entry: DevelopmentEntry = {
  id: 'skill:1',
  kind: 'skill',
  name: '剑术',
  description: '基础剑术',
  stage: '初入门',
  status: 'active',
  chapter: '第一章.md',
  quote: '他拔剑',
  relatedIds: [],
  growthEventId: '',
  events: [],
};
async function invoke(channel: string, ...args: unknown[]) {
  return handlers.get(channel)!(event, ...args);
}
function attributes(characterId = id) {
  const row = (characterOps.getByNovel(novelId) as { id: number; attributes: string }[]).find(
    (character) => character.id === characterId
  )!;
  return JSON.parse(row.attributes);
}
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ne-character-development-'));
  work = path.join(root, '作品');
  await mkdir(work);
  initDatabase(root);
  novelId = Number(novelOps.create('作品', work).lastInsertRowid);
  id = Number(
    characterOps.create(
      novelId,
      '林舟',
      '',
      '',
      JSON.stringify({
        avatar: 'portrait.png',
        design: { appearance: '黑发' },
        voice: { age: '20' },
      })
    ).lastInsertRowid
  );
  const otherNovelId = Number(
    novelOps.create('另一作品', path.join(root, '另一作品')).lastInsertRowid
  );
  foreignId = Number(characterOps.create(otherNovelId, '别的人').lastInsertRowid);
  await grantPathAccess(event.sender, work, true);
  registerCharacterDevelopmentHandlers();
  send.mockClear();
  destroyedSend.mockClear();
});
afterEach(async () => {
  closeDatabase();
  resetPathAccessForTest();
  await rm(root, { recursive: true, force: true });
});

it('lists only the authorized work and rejects paths outside its grant', async () => {
  expect(await invoke('db-character-list-by-folder', work)).toMatchObject([{ id, name: '林舟' }]);
  await expect(invoke('db-character-list-by-folder', root)).rejects.toThrow('未授权');
  await expect(invoke('db-character-list-by-folder', 'relative')).rejects.toThrow('绝对路径');
  const empty = path.join(work, '没有登记');
  await mkdir(empty);
  expect(await invoke('db-character-list-by-folder', empty)).toEqual([]);
});

it('persists a normalized entry, broadcasts its work and preserves deletion tombstones', async () => {
  const saved = await invoke('db-character-patch-development', work, id, [
    { id: entry.id, expected: '', entry: { ...entry, name: ' 剑术 ', unexpected: true } },
  ]);
  const serialized = JSON.stringify(entry);
  expect(saved).toEqual({ 'skill:1': serialized });
  expect(attributes().development).toEqual({ 'skill:1': serialized });
  expect(send).toHaveBeenCalledWith('character-development-updated', work, id);
  expect(destroyedSend).not.toHaveBeenCalled();
  await invoke('db-character-patch-development', work, id, [
    { id: entry.id, expected: serialized, entry: null },
  ]);
  expect(attributes()).toEqual({
    avatar: 'portrait.png',
    design: { appearance: '黑发' },
    voice: { age: '20' },
    development: { 'skill:1': '' },
  });
});

it.each([
  ['empty changes', []],
  ['oversized batch', Array.from({ length: 301 }, () => ({ id: entry.id, expected: '', entry }))],
  [
    'duplicate entry',
    [
      { id: entry.id, expected: '', entry },
      { id: entry.id, expected: '', entry },
    ],
  ],
  ['invalid id', [{ id: '../escape', expected: '', entry }]],
  ['mismatched entry', [{ id: 'other', expected: '', entry }]],
  ['invalid kind', [{ id: entry.id, expected: '', entry: { ...entry, kind: 'unknown' } }]],
  ['non-string expected', [{ id: entry.id, expected: 1, entry }]],
])('rejects %s without any write or notification', async (_label, changes) => {
  const before = attributes();
  await expect(invoke('db-character-patch-development', work, id, changes)).rejects.toThrow();
  expect(attributes()).toEqual(before);
  expect(send).not.toHaveBeenCalled();
});

it('rejects a character from another work and read-only directory capabilities', async () => {
  const changes = [{ id: entry.id, expected: '', entry }];
  await expect(invoke('db-character-patch-development', work, foreignId, changes)).rejects.toThrow(
    '已切换'
  );
  resetPathAccessForTest();
  await grantPathAccess(event.sender, work, true, false);
  await expect(invoke('db-character-patch-development', work, id, changes)).rejects.toThrow(
    '未授权'
  );
  expect(attributes().development).toBeUndefined();
  expect(send).not.toHaveBeenCalled();
});

it('rejects stale development batches atomically while allowing independent entry additions', async () => {
  const original = JSON.stringify(entry);
  characterOps.update(id, { attributePatch: { development: { 'skill:1': original } } });
  const second = { ...entry, id: 'skill:2', name: '轻功' };
  await expect(
    invoke('db-character-patch-development', work, id, [
      { id: second.id, expected: '', entry: second },
      { id: entry.id, expected: '', entry: { ...entry, stage: '进阶' } },
    ])
  ).rejects.toThrow('已被修改');
  expect(attributes().development).toEqual({ 'skill:1': original });
  expect(send).not.toHaveBeenCalled();
  await invoke('db-character-patch-development', work, id, [
    { id: second.id, expected: '', entry: second },
  ]);
  expect(attributes().development).toEqual({
    'skill:1': original,
    'skill:2': JSON.stringify(second),
  });
});

it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null])(
  'rejects invalid character id %s without writing a development entry',
  async (invalidId) => {
    await expect(
      invoke('db-character-patch-development', work, invalidId, [
        { id: entry.id, expected: '', entry },
      ])
    ).rejects.toThrow('参数无效');
    expect(attributes().development).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  }
);

it('rolls back the whole profile draft when development conflicts after design and voice', async () => {
  characterOps.update(id, {
    attributePatch: { development: { 'skill:1': JSON.stringify(entry) } },
  });
  const before = attributes();
  await expect(
    invoke(
      'db-character-patch-profile-draft',
      work,
      id,
      { appearance: '白发' },
      { appearance: '黑发' },
      {
        voice: { age: '21' },
        voiceExpected: { age: '20' },
        development: { 'skill:1': JSON.stringify({ ...entry, stage: '进阶' }) },
        developmentExpected: { 'skill:1': '' },
      }
    )
  ).rejects.toThrow('已被修改');
  expect(attributes()).toEqual(before);
  expect(send).not.toHaveBeenCalled();
});

it('saves design, voice and development as one profile draft', async () => {
  await invoke(
    'db-character-patch-profile-draft',
    work,
    id,
    { appearance: '白发' },
    { appearance: '黑发' },
    {
      voice: { age: '21', gender: 'neutral' },
      voiceExpected: { age: '20', gender: '' },
      development: { 'skill:1': JSON.stringify(entry) },
      developmentExpected: { 'skill:1': '' },
    }
  );
  expect(attributes()).toEqual({
    avatar: 'portrait.png',
    design: { appearance: '白发' },
    voice: { age: '21', gender: 'neutral' },
    development: { 'skill:1': JSON.stringify(entry) },
  });
  expect(send).toHaveBeenCalledTimes(1);
});

it.each([
  [{ unknown: 'x' }, { unknown: '' }, {}],
  [{ appearance: 'x'.repeat(801) }, { appearance: '黑发' }, {}],
  [{ appearance: '白发' }, {}, {}],
  [{}, {}, { voice: { gender: 'invalid' }, voiceExpected: { gender: '' } }],
  [{}, {}, { voice: { age: '21' } }],
  [{}, {}, { development: { 'skill:1': 'broken JSON' }, developmentExpected: { 'skill:1': '' } }],
])(
  'rejects malformed profile groups before changing the character %#',
  async (patch, expected, extras) => {
    const before = attributes();
    await expect(
      invoke('db-character-patch-profile-draft', work, id, patch, expected, extras)
    ).rejects.toThrow();
    expect(attributes()).toEqual(before);
    expect(send).not.toHaveBeenCalled();
  }
);

it('validates suggestion fields and prevents a foreign character update', async () => {
  const input = {
    characterId: id,
    name: '林舟',
    summary: '',
    chapter: '第一章.md',
    quote: '白发',
    source: 'text',
    changes: [{ key: 'appearance', value: '白发', expected: '黑发', quote: '白发' }],
  };
  for (const invalid of [
    { ...input, changes: [...input.changes, ...input.changes] },
    { ...input, changes: [{ ...input.changes[0], key: 'unknown' }] },
    { ...input, characterId: foreignId },
    { ...input, source: 'unknown' },
  ])
    await expect(invoke('db-character-apply-profile', work, invalid)).rejects.toThrow();
  expect(attributes().design).toEqual({ appearance: '黑发' });
  expect(send).not.toHaveBeenCalled();
  expect(await invoke('db-character-apply-profile', work, input)).toEqual({
    characterId: id,
    created: false,
  });
  expect(attributes().profileEvidence.appearance).toMatchObject({
    source: 'text',
    chapter: '第一章.md',
    quote: '白发',
  });
  expect(send).toHaveBeenCalledWith('character-development-updated', work, id);
});
