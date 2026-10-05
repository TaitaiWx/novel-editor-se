/**
 * 作品与章节命令：ne novel list|info|create|export、ne chapter list|create|reorder|merge
 */
import path from 'node:path';
import {
  EXPORT_FORMATS,
  createChapter,
  createNovel,
  exportNovel,
  getNovelInfo,
  listChapters,
  listNovels,
  mergeChapters,
  parseExportFormat,
  reorderChapters,
  type ChapterInfo,
} from '@novel-editor/core';
import { CliError } from '../errors';
import { displayPath, formatNumber, renderStats, renderTable } from '../output';
import type { CommandSpec } from '../types';
import { bool, num, requireStr, resolvePath, str } from './util';

function renderChapters(chapters: ChapterInfo[]): string {
  if (chapters.length === 0) return '（还没有章节，使用 `ne chapter create <novel> <title>` 新建）';
  return renderTable(
    ['#', '标题', '卷', '字数', '文件'],
    chapters.map((chapter) => [
      chapter.index,
      chapter.title,
      chapter.volume || '-',
      formatNumber(chapter.stats.chars),
      chapter.file,
    ])
  );
}

export const novelCommands: CommandSpec[] = [
  {
    path: ['novel', 'list'],
    summary: '列出所有作品',
    async run(ctx) {
      const project = await ctx.requireProject();
      const novels = await listNovels(project);
      const text = novels.length
        ? renderTable(
            ['作品', '章节', '字数'],
            novels.map((novel) => [novel.name, novel.chapterCount, formatNumber(novel.chars)])
          )
        : '（还没有作品，使用 `ne novel create <name>` 新建）';
      return { data: { project: project.root, novels }, text };
    },
  },
  {
    path: ['novel', 'info'],
    summary: '查看作品详情（章节数、总字数等）',
    positionals: [{ name: 'name', description: '作品名', required: true }],
    async run(ctx, args) {
      const project = await ctx.requireProject();
      const info = await getNovelInfo(project, requireStr(args, 'name'));
      const text = [
        `作品: ${info.name}`,
        `路径: ${displayPath(info.path, ctx.cwd)}`,
        `章节: ${info.chapterCount}${info.volumes.length ? `（${info.volumes.length} 卷）` : ''}`,
        '',
        renderStats(info.stats),
        '',
        renderChapters(info.chapters),
      ].join('\n');
      return { data: info, text };
    },
  },
  {
    path: ['novel', 'create'],
    summary: '创建新作品',
    positionals: [{ name: 'name', description: '作品名（即目录名）', required: true }],
    async run(ctx, args) {
      const project = await ctx.requireProject();
      const novel = await createNovel(project, requireStr(args, 'name'));
      return {
        data: novel,
        text: `已创建作品「${novel.name}」: ${displayPath(novel.path, ctx.cwd)}`,
      };
    },
  },
  {
    path: ['novel', 'export'],
    summary: '导出整部作品为单个文件',
    positionals: [{ name: 'name', description: '作品名', required: true }],
    options: [
      {
        name: 'format',
        short: 'f',
        type: 'string',
        choices: EXPORT_FORMATS,
        default: 'md',
        description: '导出格式',
      },
      {
        name: 'out',
        short: 'o',
        type: 'string',
        valueName: 'file',
        description: '输出文件（默认 <project>/exports/<name>.<format>）',
      },
    ],
    examples: ['ne novel export 我的小说 --format=docx'],
    async run(ctx, args) {
      const project = await ctx.requireProject();
      const name = requireStr(args, 'name');
      const format = parseExportFormat(str(args, 'format'));
      const out = str(args, 'out');
      const output = out
        ? resolvePath(ctx, out)
        : path.join(project.root, 'exports', `${name}.${format}`);
      const result = await exportNovel(project, name, format, output);
      return {
        data: result,
        text: `已导出「${name}」${result.chapterCount} 章 → ${displayPath(result.output, ctx.cwd)}`,
      };
    },
  },
];

export const chapterCommands: CommandSpec[] = [
  {
    path: ['chapter', 'list'],
    summary: '列出作品的所有章节',
    positionals: [{ name: 'novel', description: '作品名', required: true }],
    async run(ctx, args) {
      const project = await ctx.requireProject();
      const chapters = await listChapters(project, requireStr(args, 'novel'));
      return { data: { novel: str(args, 'novel'), chapters }, text: renderChapters(chapters) };
    },
  },
  {
    path: ['chapter', 'create'],
    summary: '新建章节（自动编号为 NNN-标题.md）',
    positionals: [
      { name: 'novel', description: '作品名', required: true },
      { name: 'title', description: '章节标题', required: true },
    ],
    options: [
      {
        name: 'volume',
        type: 'string',
        valueName: 'dir',
        description: '放入指定卷（作品下的子目录）',
      },
      { name: 'content', type: 'string', valueName: 'text', description: '初始正文' },
      { name: 'stdin', type: 'boolean', description: '从标准输入读取初始正文' },
    ],
    examples: [
      'ne chapter create 我的小说 "第一章 开端"',
      'ne chapter create 我的小说 序章 --volume 第1卷',
    ],
    async run(ctx, args) {
      const project = await ctx.requireProject();
      const title = requireStr(args, 'title');
      let content = str(args, 'content');
      if (bool(args, 'stdin')) content = await ctx.readStdin();
      const { chapter, write } = await createChapter(project, requireStr(args, 'novel'), title, {
        volume: str(args, 'volume'),
        content:
          content === undefined
            ? undefined
            : `# ${title}\n\n${content}${content.endsWith('\n') ? '' : '\n'}`,
      });
      await ctx.recordWrites([write]);
      return {
        data: chapter,
        text: `已创建第 ${chapter.index} 章「${chapter.title}」: ${chapter.file}`,
      };
    },
  },
  {
    path: ['chapter', 'reorder'],
    summary: '调整章节顺序（不带选项时整理编号，填补空缺）',
    positionals: [{ name: 'novel', description: '作品名', required: true }],
    options: [
      {
        name: 'order',
        type: 'string',
        valueName: 'refs',
        description: '新顺序，逗号分隔的章节引用（序号/文件名/标题），如 "3,1,2"',
      },
      { name: 'move', type: 'string', valueName: 'ref', description: '要移动的章节' },
      {
        name: 'to',
        type: 'number',
        valueName: 'n',
        description: '与 --move 配合：移动到所在卷的第 n 位',
      },
    ],
    examples: [
      'ne chapter reorder 我的小说',
      'ne chapter reorder 我的小说 --order 3,1,2',
      'ne chapter reorder 我的小说 --move 序章 --to 1',
    ],
    async run(ctx, args) {
      const project = await ctx.requireProject();
      const move = str(args, 'move');
      const to = num(args, 'to');
      if ((move === undefined) !== (to === undefined)) {
        throw new CliError('USAGE', '--move 与 --to 必须同时使用');
      }
      if (move !== undefined && str(args, 'order')) {
        throw new CliError('USAGE', '--order 与 --move 不能同时使用');
      }
      const order = str(args, 'order')
        ?.split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      const result = await reorderChapters(project, requireStr(args, 'novel'), {
        order,
        move: move !== undefined && to !== undefined ? { ref: move, to } : undefined,
      });
      const lines = result.renamed.map((item) => `${item.from} → ${item.to}`);
      lines.push(result.renamed.length ? `已重命名 ${result.renamed.length} 个文件` : '顺序无变化');
      return { data: result, text: lines.join('\n') };
    },
  },
  {
    path: ['chapter', 'merge'],
    summary: '合并章节：把 <from> 的正文追加到 <to> 末尾并删除 <from>',
    positionals: [
      { name: 'novel', description: '作品名', required: true },
      { name: 'from', description: '被合并的章节（序号/文件名/标题）', required: true },
      { name: 'to', description: '合并目标章节', required: true },
    ],
    async run(ctx, args) {
      const project = await ctx.requireProject();
      const result = await mergeChapters(
        project,
        requireStr(args, 'novel'),
        requireStr(args, 'from'),
        requireStr(args, 'to')
      );
      // 合并只是移动正文，目标文件增长的字数不计入写作量：按删除 + 新增分别记录会重复计数，这里抵消
      await ctx.recordWrites([
        { path: result.write.path, previousChars: result.write.chars, chars: result.write.chars },
      ]);
      return {
        data: result,
        text: `已将「${result.from.title}」合并到「${result.into.title}」（${formatNumber(result.into.stats.chars)} 字）`,
      };
    },
  },
];
