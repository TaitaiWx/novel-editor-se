/**
 * 文件操作命令：ne file list|read|write|create|delete|search|rename
 */
import path from 'node:path';
import {
  createDirectory,
  createFile,
  createGlobMatcher,
  deletePath,
  listTree,
  readTextFile,
  renamePath,
  searchContent,
  walkFiles,
  writeTextFile,
} from '@novel-editor/core';
import { CliError } from '../errors';
import { displayPath, renderTree } from '../output';
import type { CommandSpec } from '../types';
import { bool, num, requireStr, resolvePath, str } from './util';

export const fileCommands: CommandSpec[] = [
  {
    path: ['file', 'list'],
    summary: '列出目录下的文件树',
    positionals: [{ name: 'path', description: '目录路径（默认当前目录）' }],
    options: [
      { name: 'depth', short: 'd', type: 'number', valueName: 'n', description: '最大递归深度' },
      { name: 'all', short: 'a', type: 'boolean', description: '包含隐藏文件' },
    ],
    examples: ['ne file list', 'ne file list novels --depth 2 --json'],
    async run(ctx, args) {
      const target = resolvePath(ctx, str(args, 'path') ?? '.');
      const tree = await listTree(target, {
        depth: num(args, 'depth'),
        includeHidden: bool(args, 'all'),
      });
      return { data: tree, text: renderTree(tree, displayPath(target, ctx.cwd)) };
    },
  },
  {
    path: ['file', 'read'],
    summary: '读取文件内容输出到 stdout',
    positionals: [{ name: 'file', description: '文件路径', required: true }],
    async run(ctx, args) {
      const file = resolvePath(ctx, requireStr(args, 'file'));
      const content = await readTextFile(file);
      return { data: { path: file, content }, text: content, raw: true };
    },
  },
  {
    path: ['file', 'write'],
    summary: '写入文件（从参数或 stdin），会记录写作统计',
    positionals: [
      { name: 'file', description: '文件路径', required: true },
      { name: 'content', description: '要写入的内容（与 --stdin 二选一）' },
    ],
    options: [
      { name: 'stdin', type: 'boolean', description: '从标准输入读取内容' },
      { name: 'append', type: 'boolean', description: '追加到文件末尾而不是覆盖' },
    ],
    examples: [
      'ne file write notes.md "第一段"',
      'cat draft.txt | ne file write novels/书/001-开端.md --stdin',
    ],
    async run(ctx, args) {
      const file = resolvePath(ctx, requireStr(args, 'file'));
      const inline = str(args, 'content');
      if (bool(args, 'stdin') && inline !== undefined) {
        throw new CliError('USAGE', '不能同时提供 <content> 和 --stdin');
      }
      if (!bool(args, 'stdin') && inline === undefined) {
        throw new CliError(
          'USAGE',
          '缺少写入内容',
          '提供 <content> 参数，或使用 --stdin 从标准输入读取'
        );
      }
      const content = bool(args, 'stdin') ? await ctx.readStdin() : (inline ?? '');
      const result = await writeTextFile(file, content, { append: bool(args, 'append') });
      await ctx.recordWrites([result]);
      return {
        data: result,
        text: `${result.created ? '已创建' : '已写入'} ${displayPath(file, ctx.cwd)}（${result.chars} 字）`,
      };
    },
  },
  {
    path: ['file', 'create'],
    summary: '创建新文件（或用 --dir 创建目录）',
    positionals: [{ name: 'file', description: '文件路径', required: true }],
    options: [
      { name: 'dir', type: 'boolean', description: '创建目录而不是文件' },
      { name: 'content', type: 'string', valueName: 'text', description: '初始内容' },
    ],
    async run(ctx, args) {
      const target = resolvePath(ctx, requireStr(args, 'file'));
      if (bool(args, 'dir')) {
        const dir = await createDirectory(target);
        return {
          data: { path: dir, type: 'directory' },
          text: `已创建目录 ${displayPath(dir, ctx.cwd)}`,
        };
      }
      const result = await createFile(target, str(args, 'content') ?? '');
      await ctx.recordWrites([result]);
      return { data: { ...result, type: 'file' }, text: `已创建 ${displayPath(target, ctx.cwd)}` };
    },
  },
  {
    path: ['file', 'delete'],
    summary: '删除文件或目录',
    positionals: [{ name: 'file', description: '文件或目录路径', required: true }],
    options: [{ name: 'recursive', short: 'r', type: 'boolean', description: '递归删除非空目录' }],
    async run(ctx, args) {
      const target = resolvePath(ctx, requireStr(args, 'file'));
      const result = await deletePath(target, { recursive: bool(args, 'recursive') });
      return { data: result, text: `已删除 ${displayPath(target, ctx.cwd)}` };
    },
  },
  {
    path: ['file', 'search'],
    summary: '在文件中搜索内容（字面量 / --regex），--glob 过滤文件；--files 按 glob 搜文件名',
    positionals: [
      { name: 'pattern', description: '搜索内容；配合 --files 时为文件名 glob', required: true },
      { name: 'path', description: '搜索根目录或文件（默认当前目录）' },
    ],
    options: [
      { name: 'regex', short: 'E', type: 'boolean', description: '把 pattern 当作正则表达式' },
      { name: 'ignore-case', short: 'i', type: 'boolean', description: '忽略大小写' },
      {
        name: 'glob',
        short: 'g',
        type: 'string',
        valueName: 'glob',
        description: '只搜索匹配的文件，例如 "**/*.md"',
      },
      { name: 'files', type: 'boolean', description: '按 glob 匹配文件路径而不是搜索内容' },
      {
        name: 'max',
        type: 'number',
        valueName: 'n',
        default: 1000,
        description: '最多返回的匹配数',
      },
    ],
    examples: [
      'ne file search 林黛玉 novels',
      'ne file search "第.+章" -E --glob "*.md"',
      'ne file search "**/*.txt" --files',
    ],
    async run(ctx, args) {
      const pattern = requireStr(args, 'pattern');
      const root = resolvePath(ctx, str(args, 'path') ?? '.');
      if (bool(args, 'files')) {
        const matcher = createGlobMatcher(pattern);
        const files = (await walkFiles(root)).filter((file) => matcher(path.relative(root, file)));
        return {
          data: { pattern, files },
          text: files.map((file) => displayPath(file, ctx.cwd)).join('\n') || '（没有匹配的文件）',
        };
      }
      const result = await searchContent(pattern, root, {
        regex: bool(args, 'regex'),
        ignoreCase: bool(args, 'ignore-case'),
        glob: str(args, 'glob'),
        maxResults: num(args, 'max'),
      });
      const lines = result.matches.map(
        (match) =>
          `${displayPath(match.file, ctx.cwd)}:${match.line}:${match.column}: ${match.text.trim()}`
      );
      if (result.truncated) lines.push(`…结果已截断（--max ${num(args, 'max')}）`);
      ctx.logger.info(`扫描 ${result.filesScanned} 个文件，匹配 ${result.matches.length} 处`);
      return { data: result, text: lines.join('\n') || '（没有匹配）' };
    },
  },
  {
    path: ['file', 'rename'],
    summary: '重命名/移动文件或目录',
    positionals: [
      { name: 'old', description: '原路径', required: true },
      { name: 'new', description: '新路径', required: true },
    ],
    options: [{ name: 'force', short: 'f', type: 'boolean', description: '目标存在时覆盖' }],
    async run(ctx, args) {
      const result = await renamePath(
        resolvePath(ctx, requireStr(args, 'old')),
        resolvePath(ctx, requireStr(args, 'new')),
        { overwrite: bool(args, 'force') }
      );
      return {
        data: result,
        text: `${displayPath(result.from, ctx.cwd)} → ${displayPath(result.to, ctx.cwd)}`,
      };
    },
  },
];
