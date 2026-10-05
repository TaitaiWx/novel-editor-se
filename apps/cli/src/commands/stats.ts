/**
 * 统计命令：ne stats [target]、ne stats today、ne stats history
 *
 * today / history 数据来自 <project>/.novel-editor/writing-log.json，
 * 由 CLI（含 daemon）写入类命令与 GUI 保存正文文件共同记录（只统计正文，排除 资料/ 与 .novel-editor/）。
 */
import { readFile } from 'node:fs/promises';
import {
  computeTextStats,
  getHistoryStats,
  getTodayStats,
  resolveStatsTargets,
  sumTextStats,
} from '@novel-editor/core';
import { CliError } from '../errors';
import { displayPath, formatDuration, formatNumber, renderStats, renderTable } from '../output';
import type { CommandSpec } from '../types';
import { bool, num, str } from './util';

const LOG_NOTE =
  '注: 统计包含 CLI 写入与 GUI 保存（只计正文文件）；写作时长按相邻两次写入间隔不超过 10 分钟估算。';

export const statsCommands: CommandSpec[] = [
  {
    path: ['stats'],
    summary: '输出字数、行数、段落数等统计（文件 / 目录 / 作品名）',
    positionals: [
      { name: 'target', description: '文件、目录或作品名（默认当前项目的作品目录或当前目录）' },
    ],
    options: [{ name: 'per-file', type: 'boolean', description: '同时输出每个文件的统计' }],
    examples: ['ne stats', 'ne stats 我的小说 --json', 'ne stats novels/我的小说/001-开端.md'],
    async run(ctx, args) {
      const project = await ctx.getProject();
      const target = str(args, 'target') ?? (project ? project.novelsPath : ctx.cwd);
      const resolved = await resolveStatsTargets(target, ctx.cwd, project);
      const perFile = [];
      for (const file of resolved.files) {
        perFile.push({ path: file, stats: computeTextStats(await readFile(file, 'utf-8')) });
      }
      const stats = sumTextStats(perFile.map((item) => item.stats));
      const data = {
        target: resolved.path,
        kind: resolved.kind,
        fileCount: resolved.files.length,
        stats,
        ...(bool(args, 'per-file') ? { files: perFile } : {}),
      };
      const lines = [
        `${displayPath(resolved.path, ctx.cwd)}（${resolved.kind}，${resolved.files.length} 个文件）`,
        '',
        renderStats(stats),
      ];
      if (bool(args, 'per-file') && perFile.length) {
        lines.push(
          '',
          renderTable(
            ['文件', '字数', '段落'],
            perFile.map((item) => [
              displayPath(item.path, ctx.cwd),
              formatNumber(item.stats.chars),
              item.stats.paragraphs,
            ])
          )
        );
      }
      return { data, text: lines.join('\n') };
    },
  },
  {
    path: ['stats', 'today'],
    summary: '今日写作统计（字数、时间；包含 CLI 写入与 GUI 保存）',
    async run(ctx) {
      const project = await ctx.requireProject();
      const today = await getTodayStats(project.root);
      return {
        data: today,
        text: [
          `${today.date} 写作统计`,
          `新增 ${formatNumber(today.added)} 字，删除 ${formatNumber(today.removed)} 字，净增 ${formatNumber(today.net)} 字`,
          `写入 ${today.writes} 次，涉及 ${today.files.length} 个文件，约 ${formatDuration(today.activeMs)}`,
          LOG_NOTE,
        ].join('\n'),
      };
    },
  },
  {
    path: ['stats', 'history'],
    summary: '历史写作统计（默认最近 7 天）',
    options: [
      { name: 'days', type: 'number', valueName: 'n', default: 7, description: '统计天数' },
    ],
    async run(ctx, args) {
      const days = num(args, 'days') ?? 7;
      if (!Number.isInteger(days) || days < 1 || days > 3660) {
        throw new CliError('INVALID_ARGUMENT', '--days 必须是 1~3660 之间的整数');
      }
      const project = await ctx.requireProject();
      const history = await getHistoryStats(project.root, days);
      return {
        data: history,
        text: [
          renderTable(
            ['日期', '新增', '删除', '净增', '写入', '时长'],
            history.days.map((day) => [
              day.date,
              formatNumber(day.added),
              formatNumber(day.removed),
              formatNumber(day.net),
              day.writes,
              formatDuration(day.activeMs),
            ])
          ),
          '',
          `合计: 净增 ${formatNumber(history.totals.net)} 字，${history.totals.writes} 次写入，约 ${formatDuration(history.totals.activeMs)}`,
          LOG_NOTE,
        ].join('\n'),
      };
    },
  },
];
