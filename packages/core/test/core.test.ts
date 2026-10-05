import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CoreError,
  analyzeContentStats,
  computeTextStats,
  createChapter,
  createFile,
  createGlobMatcher,
  createNovel,
  deletePath,
  exportNovel,
  findChapter,
  findProjectRoot,
  findReplace,
  getHistoryStats,
  getTodayStats,
  initProject,
  listChapters,
  listNovels,
  listTree,
  markdownToPlainText,
  mergeChapters,
  parseChapterFileName,
  plainTextToMarkdown,
  readTextFile,
  recordWrites,
  renamePath,
  reorderChapters,
  replaceInText,
  requireProject,
  searchContent,
  batchConvert,
  writeTextFile,
  type Project,
} from '../src';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'ne-core-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('text stats', () => {
  it('与 GUI 状态栏口径一致：不计空格/Tab/换行', () => {
    expect(analyzeContentStats('')).toEqual({ lineCount: 0, charCount: 0 });
    expect(analyzeContentStats('你好 世界\n\tab')).toEqual({ lineCount: 2, charCount: 6 });
  });

  it('computeTextStats 统计中文、单词、段落', () => {
    const stats = computeTextStats('第一段，你好。\n\nHello world!\n第三段');
    expect(stats.cjkChars).toBe(8);
    expect(stats.words).toBe(2);
    expect(stats.lines).toBe(4);
    expect(stats.paragraphs).toBe(3);
  });
});

describe('glob', () => {
  it('匹配 ** / * / {a,b}', () => {
    expect(createGlobMatcher('*.md')('a/b/c.md')).toBe(true);
    expect(createGlobMatcher('**/*.md')('c.md')).toBe(true);
    expect(createGlobMatcher('src/**/*.{md,txt}')('src/x/y.txt')).toBe(true);
    expect(createGlobMatcher('src/*.md')('src/x/y.md')).toBe(false);
  });
});

describe('fs ops', () => {
  it('写入、读取、重命名、删除', async () => {
    const file = path.join(dir, 'a', 'b.md');
    const first = await writeTextFile(file, '你好');
    expect(first.created).toBe(true);
    const second = await writeTextFile(file, '世界', { append: true });
    expect(second).toMatchObject({ created: false, previousChars: 2, chars: 4 });
    expect(await readTextFile(file)).toBe('你好世界');

    await expect(createFile(file)).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
    const moved = await renamePath(file, path.join(dir, 'c.md'));
    expect(path.basename(moved.to)).toBe('c.md');

    await expect(deletePath(path.join(dir, 'missing'))).rejects.toBeInstanceOf(CoreError);
    await writeFile(path.join(dir, 'a', 'keep.txt'), 'x');
    await expect(deletePath(path.join(dir, 'a'))).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await deletePath(path.join(dir, 'a'), { recursive: true });
    const tree = await listTree(dir);
    expect(tree.children?.map((node) => node.name)).toEqual(['c.md']);
  });

  it('文件树排除 .novel-editor / node_modules，目录优先自然排序', async () => {
    await mkdir(path.join(dir, '.novel-editor'));
    await mkdir(path.join(dir, 'node_modules'));
    await mkdir(path.join(dir, 'z'));
    await writeFile(path.join(dir, '10.md'), '');
    await writeFile(path.join(dir, '2.md'), '');
    const tree = await listTree(dir);
    expect(tree.children?.map((node) => node.name)).toEqual(['z', '2.md', '10.md']);
  });
});

describe('search & replace', () => {
  beforeEach(async () => {
    await writeFile(path.join(dir, 'a.md'), '张三来了\n李四也来了\n张三走了');
    await writeFile(path.join(dir, 'b.txt'), '张三');
    await writeFile(path.join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 3]));
  });

  it('字面量搜索与 glob 过滤', async () => {
    const result = await searchContent('张三', dir);
    expect(result.matches).toHaveLength(3);
    const onlyMd = await searchContent('张三', dir, { glob: '*.md' });
    expect(onlyMd.matches.map((match) => match.line)).toEqual([1, 3]);
  });

  it('正则搜索，非法正则报 INVALID_ARGUMENT', async () => {
    const result = await searchContent('^李.', dir, { regex: true });
    expect(result.matches).toHaveLength(1);
    await expect(searchContent('(', dir, { regex: true })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('查找替换支持 dry-run 与反向引用', async () => {
    const preview = await findReplace('张三', '王五', dir, { dryRun: true });
    expect(preview.totalReplacements).toBe(3);
    expect(await readFile(path.join(dir, 'a.md'), 'utf-8')).toContain('张三');

    await findReplace('张三', '王五', dir, { glob: '*.md' });
    expect(await readFile(path.join(dir, 'a.md'), 'utf-8')).not.toContain('张三');
    expect(await readFile(path.join(dir, 'b.txt'), 'utf-8')).toBe('张三');

    expect(replaceInText('第12章', '第(\\d+)章', 'Chapter $1', { regex: true }).content).toBe(
      'Chapter 12'
    );
  });
});

describe('project model', () => {
  let project: Project;

  beforeEach(async () => {
    project = (await initProject(path.join(dir, 'book'), { name: '测试' })).project;
    await createNovel(project, '长篇');
  });

  it('init 创建配置，重复 init 报错，可向上查找项目根', async () => {
    expect(project.config).toMatchObject({ name: '测试', novelsDir: 'novels', schemaVersion: 1 });
    await expect(initProject(project.root)).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
    expect(await findProjectRoot(path.join(project.novelsPath, '长篇'))).toBe(project.root);
    await expect(requireProject({ cwd: dir })).rejects.toMatchObject({ code: 'NOT_A_PROJECT' });
  });

  it('章节创建、编号、重排与合并', async () => {
    await createChapter(project, '长篇', '开端', { content: '一二三' });
    await createChapter(project, '长篇', '发展');
    await createChapter(project, '长篇', '高潮');
    let chapters = await listChapters(project, '长篇');
    expect(chapters.map((chapter) => chapter.file)).toEqual([
      '001-开端.md',
      '002-发展.md',
      '003-高潮.md',
    ]);
    expect(findChapter(chapters, '2').title).toBe('发展');
    expect(findChapter(chapters, '高潮').index).toBe(3);

    await reorderChapters(project, '长篇', { order: ['3', '1'] });
    chapters = await listChapters(project, '长篇');
    expect(chapters.map((chapter) => chapter.title)).toEqual(['高潮', '开端', '发展']);

    await reorderChapters(project, '长篇', { move: { ref: '发展', to: 1 } });
    chapters = await listChapters(project, '长篇');
    expect(chapters.map((chapter) => chapter.file)).toEqual([
      '001-发展.md',
      '002-高潮.md',
      '003-开端.md',
    ]);

    const merged = await mergeChapters(project, '长篇', '开端', '发展');
    expect(merged.into.title).toBe('发展');
    chapters = await listChapters(project, '长篇');
    expect(chapters).toHaveLength(2);
    expect(await readFile(chapters[0].path, 'utf-8')).toContain('一二三');

    // 无参数 reorder 填补编号空缺
    const tidy = await reorderChapters(project, '长篇');
    expect(tidy.chapters.map((chapter) => chapter.file)).toEqual(['001-发展.md', '002-高潮.md']);
  });

  it('卷目录与章节文件名解析', async () => {
    await createChapter(project, '长篇', '序', { volume: '第1卷' });
    const chapters = await listChapters(project, '长篇');
    expect(chapters[0]).toMatchObject({ volume: '第1卷', file: '第1卷/001-序.md' });
    expect(parseChapterFileName('012_标题.txt')).toEqual({ order: 12, title: '标题' });
    expect(parseChapterFileName('无编号.md')).toEqual({ order: null, title: '无编号' });
  });

  it('作品列表与导出 txt/md/docx', async () => {
    await createChapter(project, '长篇', '第一章', { content: '# 第一章\n\n**正文**内容\n' });
    await createChapter(project, '长篇', '第二章', { content: '没有标题的正文' });
    const novels = await listNovels(project);
    expect(novels[0]).toMatchObject({ name: '长篇', chapterCount: 2 });

    const md = await exportNovel(project, '长篇', 'md', path.join(dir, 'out.md'));
    const mdText = await readFile(md.output, 'utf-8');
    expect(mdText).toContain('# 第二章\n\n没有标题的正文');

    const txt = await exportNovel(project, '长篇', 'txt', path.join(dir, 'out.txt'));
    const txtText = await readFile(txt.output, 'utf-8');
    expect(txtText.startsWith('长篇')).toBe(true);
    expect(txtText).toContain('正文内容');
    expect(txtText).not.toContain('**');

    const docx = await exportNovel(project, '长篇', 'docx', path.join(dir, 'out.docx'));
    const buffer = await readFile(docx.output);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');

    await expect(
      exportNovel(project, '不存在', 'md', path.join(dir, 'x.md'))
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('批量转换 md → txt', async () => {
    const src = path.join(dir, 'src');
    await mkdir(src);
    await writeFile(path.join(src, 'a.md'), '# 标题\n\n[链接](http://x) 文字');
    const result = await batchConvert(src, 'md', 'txt');
    expect(result).toHaveLength(1);
    expect(await readFile(path.join(src, 'a.txt'), 'utf-8')).toBe('标题\n\n链接 文字');
    expect((await readdir(src)).sort()).toEqual(['a.md', 'a.txt']);
  });

  it('写作日志按天聚合', async () => {
    const at = new Date(2026, 0, 2, 10, 0, 0);
    const file = path.join(project.novelsPath, '长篇', 'x.md');
    await recordWrites(project.root, [
      { path: file, previousChars: 0, chars: 100, at },
      { path: file, previousChars: 100, chars: 80, at: new Date(at.getTime() + 5 * 60000) },
    ]);
    const today = await getTodayStats(project.root, at);
    expect(today).toMatchObject({ added: 100, removed: 20, net: 80, writes: 2, activeMs: 300000 });
    expect(today.files).toEqual(['novels/长篇/x.md']);
    const history = await getHistoryStats(project.root, 3, new Date(2026, 0, 3));
    expect(history.days.map((day) => day.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect(history.totals.net).toBe(80);
  });
});

describe('format conversion', () => {
  it('markdown ↔ plain text', () => {
    expect(markdownToPlainText('## 标题\n> 引用 *强调* `code`')).toBe('标题\n引用 强调 code');
    expect(plainTextToMarkdown('第一行\n第二行\n')).toBe('第一行\n\n第二行\n');
  });
});
