/**
 * 小说格式检查：ne lint [target]（只读）
 *
 * 检查 Novel Markdown 的结构：未闭合的 :::scene、多余的 :::、重复的场景 id（core lintNovelMarkup，与编辑器同一实现）。
 * 目标可以是文件、目录或作品名，范围与 ne stats 相同；--strict 时有问题以退出码 2 结束（适合 CI / AI 校验）。
 */
import { readFile } from 'node:fs/promises';
import { lintNovelMarkup, resolveStatsTargets } from '@novel-editor/core';
import { CliError } from '../errors';
import { displayPath } from '../output';
import type { CommandSpec } from '../types';
import { bool, str } from './util';

export const lintCommands: CommandSpec[] = [
  {
    path: ['lint'],
    summary: '检查小说格式（场景容器是否闭合、场景 id 是否重复）',
    positionals: [
      { name: 'target', description: '文件、目录或作品名（默认当前项目的作品目录或当前目录）' },
    ],
    options: [{ name: 'strict', type: 'boolean', description: '发现问题时以退出码 2 结束' }],
    examples: [
      'ne lint',
      'ne lint 我的小说 --json',
      'ne lint novels/我的小说/001-开端.md --strict',
    ],
    async run(ctx, args) {
      const project = await ctx.getProject();
      const target = str(args, 'target') ?? (project ? project.novelsPath : ctx.cwd);
      const resolved = await resolveStatsTargets(target, ctx.cwd, project);
      const files = [];
      for (const file of resolved.files) {
        const issues = lintNovelMarkup(await readFile(file, 'utf-8'));
        if (issues.length) files.push({ path: file, issues });
      }
      const issueCount = files.reduce((sum, file) => sum + file.issues.length, 0);
      const text =
        issueCount === 0
          ? `检查了 ${resolved.files.length} 个文件，没有发现问题`
          : files
              .flatMap((file) =>
                file.issues.map(
                  (issue) => `${displayPath(file.path, ctx.cwd)}:${issue.line}  ${issue.message}`
                )
              )
              .join('\n');
      if (bool(args, 'strict') && issueCount > 0) {
        throw new CliError('INVALID_ARGUMENT', `发现 ${issueCount} 个小说格式问题`, text);
      }
      return {
        data: { target: resolved.path, fileCount: resolved.files.length, issueCount, files },
        text,
      };
    },
  },
];
