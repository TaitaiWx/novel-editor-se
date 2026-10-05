/**
 * 项目/工作区命令：ne init|open|status
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getTodayStats,
  initProject,
  readGuiSession,
  type GuiSessionReadResult,
  listNovels,
  pathExists,
  type InitProjectOptions,
} from '@novel-editor/core';
import { CliError } from '../errors';
import { getRunningDaemon } from '../daemon';
import { displayPath, formatDuration, formatNumber } from '../output';
import type { CommandSpec } from '../types';
import { bool, resolvePath, str } from './util';

/** `ne status` 中 GUI 部分的输出（--json 下的 data.gui） */
export interface GuiStatus {
  /** active：GUI 正在使用该项目；closed：已关闭；stale：进程已退出或长时间未刷新；none：从未打开过 */
  status: GuiSessionReadResult['status'];
  reason?: GuiSessionReadResult['reason'];
  pid: number | null;
  appVersion: string | null;
  updatedAt: string | null;
  activeFile: string | null;
  openFiles: string[];
  /** 有未保存修改的文件（仅 active 时可信） */
  unsavedFiles: string[];
}

export async function readGuiStatus(root: string): Promise<GuiStatus> {
  const { status, reason, session } = await readGuiSession(root);
  const display = (file: { path: string; relativePath: string | null }) =>
    file.relativePath ?? file.path;
  return {
    status,
    ...(reason ? { reason } : {}),
    pid: session?.pid ?? null,
    appVersion: session?.appVersion ?? null,
    updatedAt: session?.updatedAt ?? null,
    activeFile: session?.activeFile
      ? display(
          session.openFiles.find((file) => file.path === session.activeFile) ?? {
            path: session.activeFile,
            relativePath: null,
          }
        )
      : null,
    openFiles: session ? session.openFiles.map(display) : [],
    unsavedFiles: session ? session.openFiles.filter((file) => file.dirty).map(display) : [],
  };
}

function renderGuiStatus(gui: GuiStatus): string[] {
  if (gui.status === 'none') return ['GUI: 未打开该项目'];
  if (gui.status === 'closed') return [`GUI: 已关闭（最后更新 ${gui.updatedAt ?? '未知'}）`];
  if (gui.status === 'stale') {
    const why = gui.reason === 'pid-not-alive' ? '进程已退出' : '长时间未刷新';
    return [`GUI: 会话已失效（${why}，pid ${gui.pid ?? '?'}）`];
  }
  const lines = [
    `GUI: 运行中 (pid ${gui.pid}${gui.appVersion ? `, v${gui.appVersion}` : ''})，打开 ${gui.openFiles.length} 个文件`,
  ];
  if (gui.activeFile) lines.push(`  当前文件: ${gui.activeFile}`);
  lines.push(
    gui.unsavedFiles.length
      ? `  未保存: ${gui.unsavedFiles.join(', ')}`
      : '  未保存: 无（所有修改已写入磁盘）'
  );
  return lines;
}

interface GuiLaunchPlan {
  command: string;
  args: string[];
  source: string;
}

/** 查找已安装的 GUI（尽力而为）；可用 NOVEL_EDITOR_APP 环境变量指定可执行文件或 .app 路径 */
export function findGuiApp(target: string): GuiLaunchPlan | null {
  const override = process.env.NOVEL_EDITOR_APP;
  if (override) {
    if (process.platform === 'darwin' && override.endsWith('.app')) {
      return {
        command: 'open',
        args: ['-a', override, '--args', target],
        source: 'NOVEL_EDITOR_APP',
      };
    }
    return { command: override, args: [target], source: 'NOVEL_EDITOR_APP' };
  }

  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/Novel Editor.app',
      path.join(os.homedir(), 'Applications/Novel Editor.app'),
    ];
    const app = candidates.find((candidate) => existsSync(candidate));
    // -n 强制拉起新进程：应用已运行时由单实例锁把参数转发给已有窗口（second-instance）
    if (app) return { command: 'open', args: ['-n', '-a', app, '--args', target], source: app };
  } else if (process.platform === 'win32') {
    const roots = [
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'),
      process.env.ProgramFiles,
    ].filter((item): item is string => Boolean(item));
    for (const root of roots) {
      const exe = path.join(root, 'Novel Editor', 'Novel Editor.exe');
      if (existsSync(exe)) return { command: exe, args: [target], source: exe };
    }
  } else {
    const candidates = [
      '/opt/Novel Editor/novel-editor',
      '/opt/Novel Editor/pc',
      '/usr/bin/novel-editor-app',
    ];
    const exe = candidates.find((candidate) => existsSync(candidate));
    if (exe) return { command: exe, args: [target], source: exe };
  }

  // 开发环境回退：在仓库中运行时使用 apps/pc 的 electron
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    for (const pcDir of [path.resolve(here, '../../pc'), path.resolve(here, '../../../pc')]) {
      const electronBin = path.join(
        pcDir,
        'node_modules',
        '.bin',
        process.platform === 'win32' ? 'electron.cmd' : 'electron'
      );
      if (existsSync(path.join(pcDir, 'dist', 'main.mjs')) && existsSync(electronBin)) {
        return { command: electronBin, args: [pcDir, target], source: `${pcDir} (dev)` };
      }
    }
  } catch {
    // import.meta.url 不可用时忽略
  }
  return null;
}

export const projectCommands: CommandSpec[] = [
  {
    path: ['init'],
    summary: '初始化新项目（创建 .novel-editor/config.json 与作品目录）',
    positionals: [{ name: 'path', description: '项目目录（默认当前目录，不存在会自动创建）' }],
    options: [
      { name: 'name', type: 'string', valueName: 'name', description: '项目名（默认目录名）' },
      {
        name: 'novels-dir',
        type: 'string',
        valueName: 'dir',
        default: 'novels',
        description: '作品根目录（相对项目根，"." 表示项目根）',
      },
      {
        name: 'ext',
        type: 'string',
        choices: ['md', 'txt'],
        default: 'md',
        description: '新章节文件的扩展名',
      },
    ],
    examples: ['ne init my-book', 'ne init . --novels-dir . --ext txt'],
    async run(ctx, args) {
      const root = resolvePath(ctx, str(args, 'path') ?? '.');
      const options: InitProjectOptions = {
        name: str(args, 'name'),
        novelsDir: str(args, 'novels-dir'),
        chapterExtension: str(args, 'ext') === 'txt' ? '.txt' : '.md',
      };
      const { project, created } = await initProject(root, options);
      return {
        data: {
          root: project.root,
          configPath: project.configPath,
          config: project.config,
          created,
        },
        text: [
          `已初始化项目「${project.config.name}」: ${displayPath(project.root, ctx.cwd)}`,
          `下一步: ne novel create <作品名>${project.root === ctx.cwd ? '' : `  （先 cd ${displayPath(project.root, ctx.cwd)}）`}`,
        ].join('\n'),
      };
    },
  },
  {
    path: ['open'],
    summary: '用 GUI 打开指定文件夹/项目',
    positionals: [{ name: 'path', description: '文件夹路径（默认当前目录）' }],
    options: [
      { name: 'dry-run', short: 'n', type: 'boolean', description: '只输出将要执行的启动命令' },
    ],
    rpc: false,
    async run(ctx, args) {
      const target = resolvePath(ctx, str(args, 'path') ?? '.');
      if (!(await pathExists(target))) throw new CliError('NOT_FOUND', `路径不存在: ${target}`);
      const plan = findGuiApp(target);
      if (!plan) {
        throw new CliError(
          'APP_NOT_FOUND',
          '未找到已安装的 Novel Editor 桌面应用',
          '请先安装桌面版，或设置环境变量 NOVEL_EDITOR_APP 指向应用可执行文件'
        );
      }
      if (!bool(args, 'dry-run')) {
        const child = spawn(plan.command, plan.args, { detached: true, stdio: 'ignore' });
        await new Promise<void>((resolve, reject) => {
          child.once('error', (error) =>
            reject(new CliError('APP_NOT_FOUND', `启动 GUI 失败: ${error.message}`))
          );
          child.once('spawn', () => resolve());
        });
        child.unref();
      }
      return {
        data: { path: target, launched: !bool(args, 'dry-run'), ...plan },
        text: `${bool(args, 'dry-run') ? '[dry-run] ' : ''}已启动 Novel Editor: ${plan.source}`,
      };
    },
  },
  {
    path: ['status'],
    summary: '输出当前项目状态（作品、字数、今日写作、GUI 打开的文件与未保存变更、daemon）',
    description:
      '输出当前项目状态。GUI 打开项目时会把打开的标签、当前文件与未保存文件写入 .novel-editor/session.json，' +
      '这里据此报告 GUI 状态（进程已退出或超过 5 分钟未刷新视为失效）。今日写作统计同时包含 CLI 与 GUI 的保存。',
    async run(ctx) {
      const project = await ctx.getProject();
      const daemon = await getRunningDaemon();
      const daemonInfo = daemon
        ? { running: true, pid: daemon.state.pid, url: daemon.state.url }
        : { running: false };
      if (!project) {
        // 未 `ne init` 的文件夹也可能被 GUI 打开：会话文件位于 <cwd>/.novel-editor/
        const gui = await readGuiStatus(ctx.cwd);
        return {
          data: { cwd: ctx.cwd, project: null, gui, daemon: daemonInfo },
          text: [
            `当前目录不在项目中: ${ctx.cwd}`,
            '运行 `ne init` 初始化项目',
            ...(gui.status === 'none' ? [] : renderGuiStatus(gui)),
            `daemon: ${daemon ? `运行中 (${daemon.state.url})` : '未运行'}`,
          ].join('\n'),
        };
      }
      const novels = await listNovels(project);
      const today = await getTodayStats(project.root);
      const totalChars = novels.reduce((sum, novel) => sum + novel.chars, 0);
      const totalChapters = novels.reduce((sum, novel) => sum + novel.chapterCount, 0);
      const gui = await readGuiStatus(project.root);
      return {
        data: {
          cwd: ctx.cwd,
          project: { root: project.root, configPath: project.configPath, config: project.config },
          novels,
          totals: { novels: novels.length, chapters: totalChapters, chars: totalChars },
          today,
          gui,
          daemon: daemonInfo,
        },
        text: [
          `项目: ${project.config.name} (${project.root})`,
          `作品: ${novels.length} 部 / ${totalChapters} 章 / ${formatNumber(totalChars)} 字`,
          `今日: +${formatNumber(today.added)} / -${formatNumber(today.removed)} 字，${today.writes} 次写入，约 ${formatDuration(today.activeMs)}`,
          ...renderGuiStatus(gui),
          `daemon: ${daemon ? `运行中 (${daemon.state.url})` : '未运行'}`,
        ].join('\n'),
      };
    },
  },
];
