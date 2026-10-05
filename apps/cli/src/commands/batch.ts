/**
 * 批量操作命令：ne batch export|convert|find-replace
 */
import path from 'node:path';
import {
  EXPORT_FORMATS,
  batchConvert,
  batchExport,
  findReplace,
  parseExportFormat,
} from '@novel-editor/core';
import { displayPath } from '../output';
import type { CommandSpec } from '../types';
import { bool, requireStr, resolvePath, str } from './util';

export const batchCommands: CommandSpec[] = [
  {
    path: ['batch', 'export'],
    summary: '批量导出目录下的正文文件为指定格式（保留目录结构）',
    positionals: [{ name: 'path', description: '源目录或文件', required: true }],
    options: [
      {
        name: 'format',
        short: 'f',
        type: 'string',
        choices: EXPORT_FORMATS,
        description: '导出格式',
        default: 'txt',
      },
      {
        name: 'out',
        short: 'o',
        type: 'string',
        valueName: 'dir',
        description: '输出目录（默认 <path>-export-<format>）',
      },
    ],
    examples: ['ne batch export novels/书名 --format=docx --out ./exports'],
    async run(ctx, args) {
      const source = resolvePath(ctx, requireStr(args, 'path'));
      const format = parseExportFormat(str(args, 'format'));
      const outDir = str(args, 'out')
        ? resolvePath(ctx, str(args, 'out') as string)
        : path.join(path.dirname(source), `${path.basename(source)}-export-${format}`);
      const files = await batchExport(source, format, outDir);
      return {
        data: { format, outDir, count: files.length, files },
        text: `已导出 ${files.length} 个文件到 ${displayPath(outDir, ctx.cwd)}`,
      };
    },
  },
  {
    path: ['batch', 'convert'],
    summary: '批量格式转换（例如 md → txt），默认输出到源文件旁',
    positionals: [{ name: 'path', description: '源目录或文件', required: true }],
    options: [
      {
        name: 'from',
        type: 'string',
        choices: ['md', 'txt'],
        description: '源格式',
        default: 'md',
      },
      {
        name: 'to',
        type: 'string',
        choices: EXPORT_FORMATS,
        description: '目标格式',
        default: 'txt',
      },
      { name: 'out', short: 'o', type: 'string', valueName: 'dir', description: '输出目录' },
      { name: 'delete-source', type: 'boolean', description: '转换后删除源文件' },
    ],
    examples: ['ne batch convert drafts --from=md --to=txt'],
    async run(ctx, args) {
      const source = resolvePath(ctx, requireStr(args, 'path'));
      const from = parseExportFormat(str(args, 'from'));
      const to = parseExportFormat(str(args, 'to'));
      const out = str(args, 'out');
      const files = await batchConvert(source, from, to, {
        outDir: out ? resolvePath(ctx, out) : undefined,
        deleteSource: bool(args, 'delete-source'),
      });
      return {
        data: { from, to, count: files.length, files },
        text: `已转换 ${files.length} 个文件（${from} → ${to}）`,
      };
    },
  },
  {
    path: ['batch', 'find-replace'],
    summary: '批量查找替换（字面量或 --regex，支持 $1 反向引用）',
    positionals: [
      { name: 'pattern', description: '查找内容', required: true },
      { name: 'replacement', description: '替换为', required: true },
      { name: 'path', description: '目录或文件（默认当前目录）' },
    ],
    options: [
      { name: 'regex', short: 'E', type: 'boolean', description: '把 pattern 当作正则表达式' },
      { name: 'ignore-case', short: 'i', type: 'boolean', description: '忽略大小写' },
      {
        name: 'glob',
        short: 'g',
        type: 'string',
        valueName: 'glob',
        description: '只处理匹配的文件，例如 "*.md"',
      },
      { name: 'dry-run', short: 'n', type: 'boolean', description: '只预览，不写入' },
    ],
    examples: [
      'ne batch find-replace 张三 李四 novels --dry-run',
      'ne batch find-replace "第(\\d+)章" "Chapter $1" -E',
    ],
    async run(ctx, args) {
      const root = resolvePath(ctx, str(args, 'path') ?? '.');
      const result = await findReplace(
        requireStr(args, 'pattern'),
        requireStr(args, 'replacement'),
        root,
        {
          regex: bool(args, 'regex'),
          ignoreCase: bool(args, 'ignore-case'),
          glob: str(args, 'glob'),
          dryRun: bool(args, 'dry-run'),
        }
      );
      if (!result.dryRun) {
        await ctx.recordWrites(
          result.files.map((file) => ({
            path: file.path,
            previousChars: file.previousChars,
            chars: file.chars,
          }))
        );
      }
      const lines = result.files.map(
        (file) => `${displayPath(file.path, ctx.cwd)}: ${file.replacements} 处`
      );
      lines.push(
        `${result.dryRun ? '[预览] 将' : '已'}替换 ${result.totalReplacements} 处，涉及 ${result.filesChanged} 个文件（扫描 ${result.filesScanned} 个）`
      );
      return { data: result, text: lines.join('\n') };
    },
  },
];
