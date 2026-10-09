/**
 * CLI 执行入口：解析参数 → 执行命令 → 按 --json / 人类可读格式输出
 *
 * runCli 不直接访问 process.stdout，便于测试与 daemon 复用（daemon 中强制 JSON 且不输出）。
 */
import path from 'node:path';
import {
  recordProjectWrites,
  withWorkspaceLease,
  resolveProject,
  type Project,
  type WriteEvent,
} from '@novel-editor/core';
import { stat } from 'node:fs/promises';
import { commands as defaultCommands } from './commands';
import { commandWorkspaceResources } from './workspace-resources';
import { CliError, exitCodeFor, normalizeError } from './errors';
import { describeCommands, renderHelp } from './help';
import { createDefaultGlobals, extractGlobals, parseArgv } from './parser';
import type {
  CliContext,
  CommandSpec,
  Envelope,
  GlobalOptions,
  Logger,
  RpcRequest,
  RpcResponse,
} from './types';

export interface CliIO {
  stdout(text: string): void;
  stderr(text: string): void;
  readStdin(): Promise<string>;
}

export interface RunCliOptions {
  io: CliIO;
  /** 基准工作目录（--cwd 相对它解析），默认 process.cwd() */
  cwd?: string;
  inDaemon?: boolean;
  /** 强制 JSON 输出（daemon 使用） */
  forceJson?: boolean;
  commands?: readonly CommandSpec[];
  /** 环境变量（默认 process.env），例如 AI 命令读取 NOVEL_EDITOR_<PROVIDER>_API_KEY */
  env?: Readonly<Record<string, string | undefined>>;
}

function createLogger(io: CliIO, globals: GlobalOptions, silent: boolean): Logger {
  return {
    info(message) {
      if (!silent && !globals.quiet && !globals.json) io.stderr(`${message}\n`);
    },
    debug(message) {
      if (!silent && globals.verbose) io.stderr(`[debug] ${message}\n`);
    },
    warn(message) {
      if (!silent) io.stderr(`警告: ${message}\n`);
    },
    notice(message) {
      if (!silent && !globals.quiet) io.stderr(`${message}\n`);
    },
  };
}

/** 把写入事件按所属项目分组后写入各自的写作日志（分组/过滤逻辑与 GUI 共用 core 实现） */
async function recordCliWrites(events: WriteEvent[], logger: Logger): Promise<void> {
  for (const result of await recordProjectWrites(events)) {
    if (result.error) {
      // 统计失败不影响主操作
      logger.warn(`写作日志更新失败: ${result.error.message}`);
    } else {
      logger.debug(`写作日志已更新: ${result.root} (+${result.count})`);
    }
  }
}

function toErrorEnvelope(error: CliError): Envelope {
  return {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.hint ? { hint: error.hint } : {}),
    },
  };
}

export async function runCli(
  argv: readonly string[],
  options: RunCliOptions
): Promise<RpcResponse> {
  const { io } = options;
  const commandList = options.commands ?? defaultCommands;
  const baseCwd = options.cwd ?? process.cwd();
  let globals: GlobalOptions = createDefaultGlobals();
  try {
    globals = extractGlobals(argv).globals;
  } catch {
    // 忽略，使用默认全局选项
  }
  if (options.forceJson) globals.json = true;
  const silent = Boolean(options.inDaemon);

  const emit = (envelope: Envelope, exitCode: number, text?: string, raw?: boolean) => {
    if (!silent) {
      if (globals.json) io.stdout(`${JSON.stringify(envelope, null, 2)}\n`);
      else if (text) io.stdout(raw || text.endsWith('\n') ? text : `${text}\n`);
    }
    return { exitCode, envelope };
  };

  try {
    const outcome = parseArgv(argv, commandList);
    globals = { ...outcome.globals, json: globals.json };

    if (outcome.kind === 'help') {
      const text = renderHelp(outcome.topic, commandList);
      const topicCommands = commandList.filter((command) =>
        outcome.topic.every((part, i) => command.path[i] === part)
      );
      if (outcome.missingSubcommand) {
        if (!globals.json && !silent) io.stderr(`${text}\n\n`);
        const subs = topicCommands.map((command) => command.path[1]).filter(Boolean);
        throw new CliError(
          'USAGE',
          `缺少子命令: ne ${outcome.topic.join(' ')} <subcommand>`,
          `可用子命令: ${subs.join(', ')}`
        );
      }
      return emit(
        { ok: true, data: { help: text, commands: describeCommands(topicCommands) } },
        0,
        text
      );
    }

    const command =
      outcome.kind === 'version'
        ? commandList.find((item) => item.path.join(' ') === 'version')
        : outcome.command;
    if (!command) throw new CliError('INTERNAL', '版本命令未注册');
    const args = outcome.kind === 'command' ? outcome.args : { positionals: {}, options: {} };
    if (options.inDaemon && command.rpc === false) {
      throw new CliError('USAGE', `daemon 中不能调用 \`${command.path.join(' ')}\``);
    }

    const cwd = path.resolve(baseCwd, globals.cwd ?? '.');
    try {
      if (!(await stat(cwd)).isDirectory()) throw new Error('not dir');
    } catch {
      throw new CliError('NOT_FOUND', `工作目录不存在: ${cwd}`);
    }

    const logger = createLogger(io, globals, silent);
    let projectCache: Promise<Project | null> | null = null;
    const getProject = () => {
      projectCache ??= resolveProject({ cwd, configPath: globals.config });
      return projectCache;
    };
    const ctx: CliContext = {
      cwd,
      globals,
      logger,
      inDaemon: Boolean(options.inDaemon),
      readStdin: () => io.readStdin(),
      getProject,
      async requireProject() {
        const project = await getProject();
        if (!project) {
          throw new CliError(
            'NOT_A_PROJECT',
            `当前目录不在 Novel Editor 项目中: ${cwd}`,
            '先运行 `ne init`，或使用 --cwd <项目目录> / --config <配置文件>'
          );
        }
        return project;
      },
      recordWrites: (events) => recordCliWrites(events, logger),
      env: options.env ?? process.env,
      stream: silent || globals.json ? undefined : (chunk: string) => io.stdout(chunk),
      invoke: (request: RpcRequest) =>
        runCli(request.argv, {
          io: {
            stdout: () => undefined,
            stderr: () => undefined,
            readStdin: async () => {
              if (request.stdin === undefined) {
                throw new CliError('USAGE', 'RPC 请求未提供 stdin 字段');
              }
              return request.stdin;
            },
          },
          cwd: request.cwd ? path.resolve(cwd, request.cwd) : cwd,
          inDaemon: true,
          forceJson: true,
          commands: commandList,
          env: options.env,
        }),
    };

    logger.debug(`命令: ${command.path.join(' ')}，cwd: ${cwd}`);
    // Network commands take short input/output leases themselves. Extension commands are
    // wildcard unless their own implementation takes a complete operation boundary lease.
    const control = new Set(['serve', 'ping', 'shutdown', 'version', 'update', 'open']);
    const builtin = defaultCommands.includes(command);
    const phased = builtin && (command.path[0] === 'ai' || command.path[0] === 'video');
    const resources =
      builtin && !phased && !control.has(command.path[0])
        ? await commandWorkspaceResources(command, ctx, args)
        : undefined;
    const result = await (builtin && (control.has(command.path[0]) || phased)
      ? command.run(ctx, args)
      : withWorkspaceLease(() => command.run(ctx, args), { resources }));
    return emit({ ok: true, data: result.data }, 0, result.text, result.raw);
  } catch (rawError) {
    const error = normalizeError(rawError);
    const exitCode = exitCodeFor(error.code);
    if (!globals.json && !silent) {
      io.stderr(`错误: ${error.message}\n`);
      if (error.hint) io.stderr(`提示: ${error.hint}\n`);
      if (globals.verbose && rawError instanceof Error && rawError.stack) {
        io.stderr(`${rawError.stack}\n`);
      }
    }
    return emit(toErrorEnvelope(error), exitCode);
  }
}
