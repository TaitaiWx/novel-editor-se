import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  compareChapterFileNames,
  compareVolumeDirNames,
  getConfigPath,
  initProject,
  isChapterLikeFileName,
  isProjectDocumentName,
  isProjectDocumentPath,
  isProjectRootFile,
  isTrackedStoryPath,
  listChapters,
  listNovels,
  loadProjectFromConfig,
  parseChapterOrder,
  readProjectLayout,
  readWritingLog,
  recordStoryFileSave,
  splitNumericPrefix,
} from '../src';

const SAMPLE_DATA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../apps/pc/sample-data'
);

describe('story-layout 命名与排序', () => {
  it('章节序号：数字前缀、第X章（中文数字）、Chapter N', () => {
    expect(parseChapterOrder('001-启程.md')).toBe(1);
    expect(parseChapterOrder('第十二章 风起.md')).toBe(12);
    expect(parseChapterOrder('第一百零三章.md')).toBe(103);
    expect(parseChapterOrder('Chapter 7.md')).toBe(7);
    expect(parseChapterOrder('欢迎使用.md')).toBeNull();
    expect(isChapterLikeFileName('002_迷雾.txt')).toBe(true);
    expect(isChapterLikeFileName('灵感.md')).toBe(false);
  });

  it('排序：章节按序号，卷按中文数字序号，无序号的排在后面', () => {
    expect(['010-c.md', '番外.md', '002-b.md', '第一章.md'].sort(compareChapterFileNames)).toEqual([
      '第一章.md',
      '002-b.md',
      '010-c.md',
      '番外.md',
    ]);
    expect(['第十卷', '外传', '第二卷-星海', '第一卷-离乡'].sort(compareVolumeDirNames)).toEqual([
      '第一卷-离乡',
      '第二卷-星海',
      '第十卷',
      '外传',
    ]);
  });

  it('拆分数字前缀用于弱化显示', () => {
    expect(splitNumericPrefix('001-启程')).toEqual({ prefix: '001-', rest: '启程' });
    expect(splitNumericPrefix('第一卷-离乡')).toEqual({ prefix: '', rest: '第一卷-离乡' });
    expect(splitNumericPrefix('2024')).toEqual({ prefix: '', rest: '2024' });
  });

  it('项目文档：只认项目根目录下的文件', () => {
    expect(isProjectDocumentName('README.md')).toBe(true);
    expect(isProjectDocumentName('欢迎使用.md')).toBe(true);
    expect(isProjectDocumentName('001-启程.md')).toBe(false);
    expect(isProjectRootFile('/p/欢迎使用.md', '/p')).toBe(true);
    expect(isProjectRootFile('/p/novels/a.md', '/p')).toBe(false);
    expect(isProjectRootFile('C:\\p\\a.md', 'C:\\p\\')).toBe(true);

    // ne init 项目：根目录的所有文档都是项目文档
    expect(isProjectDocumentPath('/p/灵感.md', '/p', { configured: true })).toBe(true);
    expect(isProjectDocumentPath('/p/novels/书/001.md', '/p', { configured: true })).toBe(false);
    // 普通文件夹：只有常见说明文档名才算，根目录的章节不受影响
    expect(isProjectDocumentPath('/p/README.md', '/p', { configured: false })).toBe(true);
    expect(isProjectDocumentPath('/p/第一章.md', '/p', { configured: false })).toBe(false);
  });
});

describe('项目结构与写作日志', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'ne-story-layout-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('readProjectLayout：普通文件夹为 null，示例作品集列出两部作品', async () => {
    expect(await readProjectLayout(dir)).toBeNull();
    const layout = await readProjectLayout(SAMPLE_DATA_DIR);
    expect(layout).toMatchObject({ name: '示例作品集', novelsDir: 'novels' });
    expect(layout?.novelsPath).toBe(path.join(SAMPLE_DATA_DIR, 'novels'));
    expect(layout?.novels).toEqual(['剑与诗', '星河旅人']);
  });

  it('示例作品集：欢迎使用.md 不是章节，星河旅人 2 卷 6 章、剑与诗 2 章', async () => {
    const layout = await readProjectLayout(SAMPLE_DATA_DIR);
    expect(layout).not.toBeNull();
    const project = await loadProjectFromConfig(getConfigPath(SAMPLE_DATA_DIR));
    const novels = await listNovels(project);
    expect(novels.map((novel) => [novel.name, novel.chapterCount])).toEqual([
      ['剑与诗', 2],
      ['星河旅人', 6],
    ]);
    const chapters = await listChapters(project, '星河旅人');
    expect(new Set(chapters.map((chapter) => chapter.volume))).toEqual(
      new Set(['第一卷-离乡', '第二卷-星海'])
    );
    expect(chapters.every((chapter) => !chapter.file.includes('欢迎使用'))).toBe(true);
  });

  it('ne init 项目：根目录文档（欢迎使用.md）的保存不计入写作日志，作品章节照常记录', async () => {
    const { project } = await initProject(dir);
    await mkdir(path.join(project.novelsPath, '书'), { recursive: true });
    const welcome = path.join(dir, '欢迎使用.md');
    const chapter = path.join(project.novelsPath, '书', '001-开端.md');
    await writeFile(welcome, '', 'utf-8');

    expect(isTrackedStoryPath(welcome, dir, { configured: true })).toBe(false);
    expect(isTrackedStoryPath(chapter, dir, { configured: true })).toBe(true);

    await recordStoryFileSave({ path: welcome, previousContent: '', content: '项目说明文字' });
    await recordStoryFileSave({ path: chapter, previousContent: null, content: '你好世界' });
    const log = await readWritingLog(dir);
    const day = Object.values(log.days)[0];
    expect(day.files).toEqual(['novels/书/001-开端.md']);
    expect(day.added).toBe(4);
  });

  it('普通文件夹：根目录的 README 不计入，根目录的章节照常计入', async () => {
    await recordStoryFileSave({
      path: path.join(dir, 'README.md'),
      previousContent: null,
      content: '说明',
      workspaceRoot: dir,
    });
    await recordStoryFileSave({
      path: path.join(dir, '第一章.md'),
      previousContent: null,
      content: '正文',
      workspaceRoot: dir,
    });
    const log = await readWritingLog(dir);
    expect(Object.values(log.days)[0].files).toEqual(['第一章.md']);
  });
});
