import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { sqliteAvailable } from './helpers/sqlite-shim';

// better-sqlite3 针对 Electron ABI 编译，纯 Node 下无法加载，用 node:sqlite shim 替代
vi.mock('better-sqlite3', async () => {
  const { SqliteShim } = await import('./helpers/sqlite-shim');
  return { default: SqliteShim };
});

import {
  characterOps,
  closeDatabase,
  initDatabase,
  novelOps,
  outlineOps,
  seedProjectData,
  validateProjectSeed,
  worldSettingOps,
  type ProjectSeedData,
} from '../src';
import { getDatabase } from '../src/db/connection';

type Row = Record<string, unknown>;

function sampleSeed(): ProjectSeedData {
  return {
    version: '1.0.0',
    novels: [{ id: 1, name: '示例作品集', description: '示例' }],
    characters: [
      { novel_id: 1, name: '林舟', role: '主角', attributes: '{"aliases":["阿舟"]}' },
      { novel_id: 1, name: '苏晴', role: '药师', attributes: { aliases: [] } },
    ],
    world_settings: [
      { novel_id: 1, category: 'world', title: '星河大陆', content: '东西两境', tags: '["地理"]' },
    ],
    outlines: [
      { id: 10, title: '第一卷', scope_kind: 'project', scope_path: '', parent_id: null },
      { id: 11, title: '001 启程', scope_kind: 'project', scope_path: '', parent_id: 10 },
      {
        id: 12,
        title: '第一场',
        scope_kind: 'chapter',
        scope_path: 'novels/星河旅人/001-启程.md',
        parent_id: null,
      },
    ],
    acts: [{ id: 7, title: '第一幕' }],
    scenes: [{ act_id: 7, title: '第一场', file_path: 'novels/星河旅人/001-启程.md' }],
  };
}

describe.skipIf(!sqliteAvailable)('store/seed（node:sqlite shim）', () => {
  let dir = '';
  const folder = path.resolve('/projects/sample');

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ne-seed-'));
    initDatabase(dir, 'test.db');
  });

  afterEach(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it('首次写入作品、人物、设定、大纲与幕，路径解析为项目内绝对路径', () => {
    const result = seedProjectData(folder, sampleSeed());
    expect(result).toMatchObject({
      seeded: true,
      counts: { characters: 2, worldSettings: 1, outlines: 3, acts: 1, scenes: 1 },
    });
    const novel = novelOps.getByFolder(folder) as Row;
    expect(novel).toMatchObject({ id: result.novelId, name: '示例作品集', folder_path: folder });

    const characters = characterOps.getByNovel(result.novelId as number) as Row[];
    expect(characters.map((row) => [row.name, row.sort_order])).toEqual([
      ['林舟', 0],
      ['苏晴', 1],
    ]);
    // 对象形式的 attributes 按 JSON 字符串存储
    expect(characters[1].attributes).toBe('{"aliases":[]}');
    expect(worldSettingOps.getByNovel(result.novelId as number)).toHaveLength(1);

    const project = outlineOps.getByNovel(result.novelId as number) as Row[];
    const parent = project.find((row) => row.title === '第一卷') as Row;
    expect(project.find((row) => row.title === '001 启程')?.parent_id).toBe(parent.id);
    const chapter = outlineOps.getByScope(result.novelId as number, {
      kind: 'chapter',
      path: path.join(folder, 'novels', '星河旅人', '001-启程.md'),
    }) as Row[];
    expect(chapter.map((row) => row.title)).toEqual(['第一场']);

    const scene = getDatabase().prepare('SELECT * FROM scenes').get() as Row;
    expect(scene.file_path).toBe(path.join(folder, 'novels', '星河旅人', '001-启程.md'));
  });

  it('幂等：已有作品记录时不再写入，也不覆盖用户修改', () => {
    const first = seedProjectData(folder, sampleSeed());
    const novelId = first.novelId as number;
    const [linzhou] = characterOps.getByNovel(novelId) as Row[];
    characterOps.update(linzhou.id as number, { description: '用户改过' });
    characterOps.delete((characterOps.getByNovel(novelId) as Row[])[1].id as number);

    const second = seedProjectData(folder, sampleSeed());
    expect(second).toMatchObject({ seeded: false, novelId: null });
    const rows = characterOps.getByNovel(novelId) as Row[];
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe('用户改过');
  });

  it('用户已用其他方式打开过该目录（已有作品记录）时跳过', () => {
    novelOps.create('我的项目', folder);
    expect(seedProjectData(folder, sampleSeed()).seeded).toBe(false);
    const novel = novelOps.getByFolder(folder) as Row;
    expect(characterOps.getByNovel(novel.id as number)).toEqual([]);
  });

  it('不同项目目录互不影响', () => {
    seedProjectData(folder, sampleSeed());
    const other = path.resolve('/projects/other');
    expect(seedProjectData(other, sampleSeed()).seeded).toBe(true);
    expect(novelOps.getAll()).toHaveLength(2);
  });

  it('非法种子：结构错误、路径越界或父节点顺序错误时整体回滚', () => {
    expect(() => validateProjectSeed(null)).toThrow('顶层必须是对象');
    expect(() => validateProjectSeed({ novels: [] })).toThrow('至少包含一部作品');
    expect(() => validateProjectSeed({ novels: [{ name: '' }], characters: [] })).toThrow(
      '缺少 name'
    );
    expect(() =>
      validateProjectSeed({ novels: [{ name: 'x' }], characters: [{ role: 'r' }] })
    ).toThrow('characters[0] 缺少 name');
    expect(() => validateProjectSeed({ novels: [{ name: 'x' }], characters: 'bad' })).toThrow(
      '必须是对象数组'
    );

    const escape = sampleSeed();
    escape.outlines = [{ title: '越界', scope_kind: 'chapter', scope_path: '../outside.md' }];
    expect(() => seedProjectData(folder, escape)).toThrow('超出项目目录');
    expect(novelOps.getByFolder(folder)).toBeUndefined();

    const absolute = sampleSeed();
    absolute.outlines = [{ title: '绝对', scope_kind: 'chapter', scope_path: '/etc/passwd' }];
    expect(() => seedProjectData(folder, absolute)).toThrow('必须是相对路径');

    const orphan = sampleSeed();
    orphan.outlines = [{ id: 2, title: '孤儿', parent_id: 99 }];
    expect(() => seedProjectData(folder, orphan)).toThrow('父节点需要排在它之前');

    const badScene = sampleSeed();
    badScene.scenes = [{ act_id: 404, title: '无主场景' }];
    expect(() => seedProjectData(folder, badScene)).toThrow('不存在的幕');
    expect(novelOps.getAll()).toEqual([]);
  });

  it('多作品种子：内容按 novel_id 写入各自作品目录的记录，按作品幂等', () => {
    const seed: ProjectSeedData = {
      version: '1.0.0',
      novels: [
        { id: 1, name: '星河旅人', folder_path: 'novels/星河旅人' },
        { id: 2, name: '剑与诗', folder_path: 'novels/剑与诗' },
      ],
      characters: [
        { novel_id: 1, name: '林舟' },
        { novel_id: 2, name: '沈砚' },
        { novel_id: 1, name: '苏晴' },
      ],
      world_settings: [{ novel_id: 2, category: 'world', title: '听雨楼' }],
      outlines: [{ id: 5, novel_id: 1, title: '第一卷', scope_kind: 'project', scope_path: '' }],
      acts: [
        { id: 7, novel_id: 1, title: '第一幕' },
        { id: 8, novel_id: 2, title: '雨巷' },
      ],
      scenes: [
        { act_id: 7, title: '启程' },
        { act_id: 8, title: '登楼' },
      ],
    };
    const result = seedProjectData(folder, seed);
    expect(result.novels.map((item) => [item.name, item.folderPath])).toEqual([
      ['星河旅人', path.join(folder, 'novels', '星河旅人')],
      ['剑与诗', path.join(folder, 'novels', '剑与诗')],
    ]);
    expect(result.counts).toMatchObject({ characters: 3, worldSettings: 1, acts: 2, scenes: 2 });
    const star = novelOps.getByFolder(path.join(folder, 'novels', '星河旅人')) as Row;
    const poem = novelOps.getByFolder(path.join(folder, 'novels', '剑与诗')) as Row;
    const names = (id: unknown) =>
      (characterOps.getByNovel(id as number) as Row[]).map((row) => [row.name, row.sort_order]);
    expect(names(star.id)).toEqual([
      ['林舟', 0],
      ['苏晴', 1],
    ]);
    expect(names(poem.id)).toEqual([['沈砚', 0]]);
    expect(worldSettingOps.getByNovel(poem.id as number)).toHaveLength(1);
    expect(worldSettingOps.getByNovel(star.id as number)).toHaveLength(0);
    expect(outlineOps.getByNovel(star.id as number)).toHaveLength(1);
    expect(novelOps.getByFolder(folder)).toBeUndefined();

    // 某部作品已有记录时只跳过它
    characterOps.delete((characterOps.getByNovel(poem.id as number) as Row[])[0].id as number);
    const again = seedProjectData(folder, seed);
    expect(again.seeded).toBe(false);
    expect(characterOps.getByNovel(poem.id as number)).toEqual([]);

    expect(() => validateProjectSeed({ ...seed, characters: [{ name: '无主' }] })).toThrow(
      '缺少 novel_id'
    );
    expect(() =>
      validateProjectSeed({ ...seed, characters: [{ novel_id: 9, name: '错作品' }] })
    ).toThrow('不存在的作品 9');
    expect(() =>
      validateProjectSeed({ ...seed, novels: [seed.novels[0], { ...seed.novels[0], id: 3 }] })
    ).toThrow('作品目录重复');
  });

  it('忽略白名单外的列（种子文件无法借列名注入 SQL）', () => {
    const seed = sampleSeed();
    seed.characters = [{ name: '林舟', 'role) VALUES (1); DROP TABLE novels; --': 'x' }];
    expect(seedProjectData(folder, seed).counts.characters).toBe(1);
    expect(novelOps.getAll()).toHaveLength(1);
  });
});
