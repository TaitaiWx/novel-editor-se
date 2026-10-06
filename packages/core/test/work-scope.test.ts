import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  UNASSIGNED_WORK_NAME,
  cleanupEmptyWorkMaterialDirectories,
  createNovel,
  ensureSheet,
  getMaterialRootPath,
  initMemory,
  initProject,
  isGeneratedMaterialPath,
  isTrackedStoryPath,
  listChapters,
  listWorkScopes,
  loadMemory,
  migrateLegacyProjectMaterials,
  readProjectLayout,
  resolveWorkScope,
  type Project,
} from '../src';

let dir: string;
let project: Project;

async function touch(relative: string, content = 'x'): Promise<void> {
  const target = path.join(dir, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf-8');
}

const exists = (target: string) =>
  stat(target).then(
    () => true,
    () => false
  );

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'ne-work-scope-'));
  project = (await initProject(dir, { name: '作品集' })).project;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('isGeneratedMaterialPath：资料跟随作品', () => {
  it('项目根资料与作品资料都算生成资料，名为「资料」的作品不算', () => {
    expect(isGeneratedMaterialPath('/p/novels/星河/资料', '/p')).toBe(true);
    expect(isGeneratedMaterialPath('/p/novels/星河/资料/记忆/规则.json', '/p')).toBe(true);
    expect(isGeneratedMaterialPath('/p/novels/星河/第一卷/资料.md', '/p')).toBe(false);
    expect(isGeneratedMaterialPath('/p/novels/资料/001.md', '/p')).toBe(false);
    // 以作品目录为根
    expect(isGeneratedMaterialPath('/p/novels/星河/资料/a.md', '/p/novels/星河')).toBe(true);
    // novelsDir 为项目根
    expect(isGeneratedMaterialPath('/p/星河/资料/a.md', '/p', '.')).toBe(true);
    expect(isGeneratedMaterialPath('/p/星河/资料/a.md', '/p')).toBe(false);
    expect(getMaterialRootPath('/p/novels/星河/')).toBe('/p/novels/星河/资料');
    expect(getMaterialRootPath('C:\\p\\星河')).toBe('C:\\p\\星河\\资料');
  });

  it('作品的 资料/ 不是卷：章节列表、写作日志都排除', async () => {
    await createNovel(project, '星河');
    await touch('novels/星河/001-启程.md', '# 启程');
    await touch('novels/星河/资料/世界观.md', '# 世界观');
    await touch('novels/星河/资料/记忆/README.md', '# 记忆');
    const chapters = await listChapters(project, '星河');
    expect(chapters.map((chapter) => chapter.file)).toEqual(['001-启程.md']);
    expect(isTrackedStoryPath(path.join(dir, 'novels/星河/资料/世界观.md'), dir)).toBe(false);
    expect(isTrackedStoryPath(path.join(dir, 'novels/星河/001-启程.md'), dir)).toBe(true);
  });
});

describe('resolveWorkScope / listWorkScopes', () => {
  it('唯一作品为默认；多部作品必须指定；按文件路径定位作品', async () => {
    await createNovel(project, '星河');
    const only = await resolveWorkScope(dir);
    expect(only).toMatchObject({
      kind: 'work',
      name: '星河',
      root: path.join(dir, 'novels', '星河'),
      projectRoot: dir,
      materialDir: path.join(dir, 'novels', '星河', '资料'),
      memoryDir: path.join(dir, 'novels', '星河', '资料', '记忆'),
    });

    await createNovel(project, '剑与诗');
    await expect(resolveWorkScope(dir)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      hint: expect.stringContaining('--novel'),
    });
    expect((await resolveWorkScope(dir, { workName: '剑与诗' })).name).toBe('剑与诗');
    await expect(resolveWorkScope(dir, { workName: '无' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const byFile = await resolveWorkScope(dir, {
      filePath: path.join(dir, 'novels', '剑与诗', '001-少年.md'),
    });
    expect(byFile.name).toBe('剑与诗');
    expect((await resolveWorkScope(path.join(dir, 'novels', '星河', '第一卷'))).name).toBe('星河');
    // 不属于任何作品的文件 → 未归属（项目根）
    const loose = await resolveWorkScope(dir, { filePath: path.join(dir, '欢迎使用.md') });
    expect(loose).toMatchObject({ kind: 'unassigned', name: UNASSIGNED_WORK_NAME, root: dir });
  });

  it('项目根有旧版 资料/ 时列出「未归属」；没有作品时默认就是它', async () => {
    await touch('资料/记忆/规则.json', '{}');
    expect((await resolveWorkScope(dir)).kind).toBe('unassigned');
    await createNovel(project, '星河');
    await createNovel(project, '剑与诗');
    const scopes = await listWorkScopes(project);
    expect(scopes.map((scope) => [scope.kind, scope.name])).toEqual([
      ['work', '剑与诗'],
      ['work', '星河'],
      ['unassigned', UNASSIGNED_WORK_NAME],
    ]);
    expect((await readProjectLayout(dir))?.hasProjectMaterials).toBe(true);
  });

  it('没有作品也没有旧资料时提示先创建作品；普通文件夹整体是一部作品', async () => {
    await expect(resolveWorkScope(dir)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      hint: expect.stringContaining('ne novel create'),
    });
    const plain = await mkdtemp(path.join(os.tmpdir(), 'ne-plain-'));
    expect(await resolveWorkScope(plain)).toMatchObject({ kind: 'folder', root: plain });
    await expect(resolveWorkScope(plain, { workName: 'x' })).rejects.toMatchObject({
      code: 'NOT_A_PROJECT',
    });
    await rm(plain, { recursive: true, force: true });
  });
});

describe('成长档案按作品保存', () => {
  it('不同作品的记忆库互不影响', async () => {
    await createNovel(project, '星河');
    await createNovel(project, '剑与诗');
    const star = await resolveWorkScope(dir, { workName: '星河' });
    const poem = await resolveWorkScope(dir, { workName: '剑与诗' });
    await initMemory(star.root);
    await initMemory(poem.root, { template: 'blank' });
    await ensureSheet(star.root, '林舟');
    await ensureSheet(poem.root, '沈砚');
    expect((await loadMemory(star.root)).sheets.map((sheet) => sheet.name)).toEqual(['林舟']);
    expect((await loadMemory(poem.root)).sheets.map((sheet) => sheet.name)).toEqual(['沈砚']);
    expect((await loadMemory(star.root)).dir).toBe(star.memoryDir);
    expect(await exists(path.join(dir, '资料'))).toBe(false);
  });
});

describe('migrateLegacyProjectMaterials', () => {
  it('只有一部作品且作品没有资料时整体移入，幂等', async () => {
    await createNovel(project, '星河');
    await touch('资料/世界观.md', '# 世界观');
    await touch('资料/记忆/规则.json', '{}');
    await mkdir(path.join(dir, 'novels', '星河', '资料'));
    const result = await migrateLegacyProjectMaterials(dir);
    expect(result).toMatchObject({ migrated: true, to: path.join(dir, 'novels', '星河', '资料') });
    expect(await exists(path.join(dir, '资料'))).toBe(false);
    expect(await readdir(path.join(dir, 'novels', '星河', '资料'))).toEqual(
      expect.arrayContaining(['世界观.md', '记忆'])
    );
    expect((await migrateLegacyProjectMaterials(dir)).reason).toBe('no-legacy');
  });

  it('多部作品、没有作品或作品已有资料时保留在原处（未归属）', async () => {
    await touch('资料/世界观.md');
    expect((await migrateLegacyProjectMaterials(dir)).reason).toBe('no-work');
    await createNovel(project, '星河');
    await touch('novels/星河/资料/a.md');
    expect((await migrateLegacyProjectMaterials(dir)).reason).toBe('target-exists');
    await createNovel(project, '剑与诗');
    expect((await migrateLegacyProjectMaterials(dir)).reason).toBe('multiple-works');
    expect(await exists(path.join(dir, '资料', '世界观.md'))).toBe(true);
    const plain = await mkdtemp(path.join(os.tmpdir(), 'ne-plain-'));
    expect((await migrateLegacyProjectMaterials(plain)).reason).toBe('not-project');
    await rm(plain, { recursive: true, force: true });
  });

  it('清理空生成资料目录时覆盖每部作品', async () => {
    await createNovel(project, '星河');
    await mkdir(path.join(dir, 'novels', '星河', '资料', 'AI资料'), { recursive: true });
    await mkdir(path.join(dir, '资料', '章上下文'), { recursive: true });
    const removed = await cleanupEmptyWorkMaterialDirectories(dir);
    expect(removed).toEqual(
      expect.arrayContaining([
        path.join(dir, 'novels', '星河', '资料', 'AI资料'),
        path.join(dir, 'novels', '星河', '资料'),
        path.join(dir, '资料'),
      ])
    );
  });
});
