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
  countNovelContent,
  ensureNovelByFolder,
  hasNovelContentByFolder,
  initDatabase,
  migrateProjectContentToWork,
  novelOps,
  outlineOps,
  settingsOps,
  storyIdeaOps,
  worldSettingOps,
} from '../src';

type Row = Record<string, unknown>;

describe.skipIf(!sqliteAvailable)('store/work-scope：人物 / 设定 / 大纲跟随作品', () => {
  let dir = '';
  const project = path.resolve('/projects/demo');
  const star = path.join(project, 'novels', '星河旅人');
  const poem = path.join(project, 'novels', '剑与诗');

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ne-work-scope-'));
    initDatabase(dir, 'test.db');
  });

  afterEach(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it('同一个数据库中每部作品一条记录，内容互不可见', () => {
    const starId = ensureNovelByFolder(star, '星河旅人');
    const poemId = ensureNovelByFolder(poem, '剑与诗');
    expect(ensureNovelByFolder(star, '改名也不重复创建')).toBe(starId);
    characterOps.create(starId, '林舟');
    characterOps.create(poemId, '沈砚');
    worldSettingOps.create(poemId, 'world', '听雨楼', '');
    expect((characterOps.getByNovel(starId) as Row[]).map((row) => row.name)).toEqual(['林舟']);
    expect((characterOps.getByNovel(poemId) as Row[]).map((row) => row.name)).toEqual(['沈砚']);
    expect(countNovelContent(poemId)).toMatchObject({ characters: 1, world_settings: 1 });
    expect(hasNovelContentByFolder(star)).toBe(true);
    expect(hasNovelContentByFolder(project)).toBe(false);
    expect(novelOps.getAll()).toHaveLength(2);
  });

  it('旧版项目级内容迁移到唯一的作品：主键不变，项目级大纲路径与界面数据键改为作品', () => {
    novelOps.create('旧项目', project);
    const legacyId = Number((novelOps.getByFolder(project) as Row).id);
    settingsOps.set(`novel-editor:character-relations:${project}`, '[1]');
    settingsOps.set(`novel-editor:assistant-artifact:lore:project:${project}`, '[]');
    settingsOps.set(`novel-editor:character-timeline:${legacyId}:9`, '{}');
    const characterId = Number(characterOps.create(legacyId, '林舟').lastInsertRowid);
    worldSettingOps.create(legacyId, 'world', '星河大陆', '');
    outlineOps.replaceTree(legacyId, [{ title: '第一卷' }], { kind: 'project', path: project });
    storyIdeaOps.createCard(legacyId, { title: '灵感', source: 'manual' });

    const result = migrateProjectContentToWork(project, star, '星河旅人');
    expect(result).toMatchObject({ migrated: true, reason: 'migrated' });
    expect(result.counts).toMatchObject({ characters: 1, world_settings: 1, outlines: 1 });
    const workId = result.novelId as number;
    expect((characterOps.getByNovel(workId) as Row[])[0].id).toBe(characterId);
    expect(outlineOps.getByScope(workId, { kind: 'project', path: star })).toHaveLength(1);
    expect(hasNovelContentByFolder(project)).toBe(false);
    expect(settingsOps.get(`novel-editor:character-relations:${star}`)).toBe('[1]');
    expect(settingsOps.get(`novel-editor:character-relations:${project}`)).toBeUndefined();
    expect(settingsOps.get(`novel-editor:assistant-artifact:lore:project:${star}`)).toBe('[]');
    expect(settingsOps.get(`novel-editor:character-timeline:${workId}:9`)).toBe('{}');
    // 项目根记录保留（版本快照、写作统计仍挂在它上面）
    expect(novelOps.getByFolder(project)).toBeDefined();

    // 幂等：再次迁移不做任何事
    expect(migrateProjectContentToWork(project, star, '星河旅人')).toMatchObject({
      migrated: false,
      reason: 'no-project-content',
    });
  });

  it('目标作品已有内容或项目没有旧记录时不迁移，旧内容保留为「未归属」', () => {
    expect(migrateProjectContentToWork(project, star, '星河旅人').reason).toBe('no-project-record');
    novelOps.create('旧项目', project);
    const legacyId = Number((novelOps.getByFolder(project) as Row).id);
    characterOps.create(legacyId, '旧人物');
    const workId = ensureNovelByFolder(star, '星河旅人');
    characterOps.create(workId, '新人物');

    expect(migrateProjectContentToWork(project, star, '星河旅人')).toMatchObject({
      migrated: false,
      reason: 'target-has-content',
    });
    expect((characterOps.getByNovel(legacyId) as Row[]).map((row) => row.name)).toEqual(['旧人物']);
    expect(hasNovelContentByFolder(project)).toBe(true);
  });
});
