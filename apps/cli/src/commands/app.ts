/**
 * 应用控制命令：ne version|update|serve|ping|shutdown
 */
import os from 'node:os';
import { CliError } from '../errors';
import { daemonRequest, getDaemonStatePath, getRunningDaemon, startDaemon } from '../daemon';
import { CLI_VERSION } from '../version';
import type { CommandSpec } from '../types';
import { bool, num } from './util';

export function createAppCommands(describe: () => unknown): CommandSpec[] {
  return [
    {
      path: ['version'],
      summary: '输出版本信息',
      async run() {
        const data = {
          version: CLI_VERSION,
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          os: os.release(),
        };
        return {
          data,
          text: `novel-editor ${CLI_VERSION} (node ${process.version}, ${process.platform}-${process.arch})`,
        };
      },
    },
    {
      path: ['update'],
      summary: '检查/安装更新（CLI 不支持，请在 GUI 中更新）',
      options: [
        { name: 'check', type: 'boolean', description: '检查更新' },
        { name: 'install', type: 'boolean', description: '安装更新' },
      ],
      async run(_ctx, args) {
        const action = bool(args, 'install') ? '安装' : '检查';
        throw new CliError(
          'UNSUPPORTED',
          `CLI 暂不支持${action}更新（当前版本 ${CLI_VERSION}）`,
          '自动更新（含金丝雀/灰度通道）由桌面应用负责：打开 GUI 的「设置 → 更新」'
        );
      },
    },
    {
      path: ['serve'],
      summary: '启动 headless daemon（127.0.0.1 HTTP 接口，供 AI 调用）',
      description: [
        '启动 headless daemon（前台运行，Ctrl+C 退出）。',
        `状态文件: ${getDaemonStatePath()}（含 pid / port / token，可用 NE_DAEMON_DIR 修改目录）`,
        '接口（需 Authorization: Bearer <token>）:',
        '  GET  /ping       健康检查',
        '  GET  /commands   机器可读的命令清单',
        '  POST /rpc        {"argv":["novel","list"],"cwd":"/path","stdin":"..."} → { ok, data|error, exitCode }',
        '  POST /shutdown   关闭 daemon',
      ].join('\n'),
      options: [
        {
          name: 'port',
          short: 'p',
          type: 'number',
          valueName: 'port',
          description: '监听端口（默认随机）',
        },
      ],
      rpc: false,
      async run(ctx, args) {
        const daemon = await startDaemon({ port: num(args, 'port'), invoke: ctx.invoke, describe });
        ctx.logger.notice(`daemon 已启动: ${daemon.state.url} (pid ${daemon.state.pid})`);
        ctx.logger.notice(`状态文件: ${getDaemonStatePath()}`);
        const stop = () => void daemon.close();
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
        await daemon.closed;
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
        return {
          data: { stopped: true, url: daemon.state.url, pid: daemon.state.pid },
          text: 'daemon 已停止',
        };
      },
    },
    {
      path: ['ping'],
      summary: '检查 daemon 是否在运行',
      async run() {
        const running = await getRunningDaemon();
        if (!running) {
          throw new CliError('DAEMON_NOT_RUNNING', 'daemon 未运行', '使用 `ne serve` 启动');
        }
        const { token: _token, ...publicState } = running.state;
        return {
          data: { running: true, ...publicState },
          text: `daemon 运行中: ${running.state.url} (pid ${running.state.pid})`,
        };
      },
    },
    {
      path: ['shutdown'],
      summary: '关闭 daemon',
      rpc: false,
      async run() {
        const running = await getRunningDaemon();
        if (!running) {
          throw new CliError('DAEMON_NOT_RUNNING', 'daemon 未运行');
        }
        await daemonRequest(running.state, 'POST', '/shutdown');
        return {
          data: { stopped: true, pid: running.state.pid },
          text: `已关闭 daemon (pid ${running.state.pid})`,
        };
      },
    },
  ];
}
