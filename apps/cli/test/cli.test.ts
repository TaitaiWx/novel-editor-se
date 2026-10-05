import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { commands } from '../src/commands';
import { daemonRequest, startDaemon } from '../src/daemon';
import { exitCodeFor } from '../src/errors';
import { describeCommands } from '../src/help';
import { extractGlobals, parseArgv } from '../src/parser';
import { runCli } from '../src/run';
import { suggest } from '../src/suggest';

interface RunOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
  json: { ok: boolean; data?: unknown; error?: { code: string; message: string } };
}

let dir: string;

async function ne(argv: string[], stdin?: string): Promise<RunOutput> {
  let stdout = '';
  let stderr = '';
  const { exitCode, envelope } = await runCli(argv, {
    cwd: dir,
    io: {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
      readStdin: async () => stdin ?? '',
    },
  });
  return { exitCode, stdout, stderr, json: envelope as RunOutput['json'] };
}

function data<T>(output: RunOutput): T {
  return output.json.data as T;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'ne-cli-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('parser', () => {
  it('全局选项可以出现在任意位置', () => {
    const { globals, rest } = extractGlobals([
      '--json',
      'file',
      'list',
      '-v',
      '--cwd',
      '/tmp',
      'x',
    ]);
    expect(globals).toMatchObject({ json: true, verbose: true, cwd: '/tmp' });
    expect(rest).toEqual(['file', 'list', 'x']);
  });

  it('解析子命令、选项（=、空格、短选项、--no-）和位置参数', () => {
    const outcome = parseArgv(
      ['file', 'search', 'foo', 'dir', '-E', '--glob=*.md', '--max', '5'],
      commands
    );
    expect(outcome.kind).toBe('command');
    if (outcome.kind !== 'command') return;
    expect(outcome.command.path).toEqual(['file', 'search']);
    expect(outcome.args.positionals).toEqual({ pattern: 'foo', path: 'dir' });
    expect(outcome.args.options).toMatchObject({ regex: true, glob: '*.md', max: 5 });
  });

  it('stats 与 stats today 同时存在时正确区分', () => {
    const a = parseArgv(['stats', 'today'], commands);
    const b = parseArgv(['stats', 'book.md'], commands);
    expect(a.kind === 'command' && a.command.path).toEqual(['stats', 'today']);
    expect(b.kind === 'command' && b.args.positionals.target).toBe('book.md');
  });

  it('未知命令 / 子命令 / 选项给出拼写建议', () => {
    expect(() => parseArgv(['fiel', 'list'], commands)).toThrow(/未知命令/);
    try {
      parseArgv(['novel', 'craete', 'x'], commands);
    } catch (error) {
      expect((error as { hint?: string }).hint).toContain('create');
    }
    try {
      parseArgv(['file', 'list', '--dept', '1'], commands);
    } catch (error) {
      expect((error as { code?: string }).code).toBe('UNKNOWN_OPTION');
      expect((error as { hint?: string }).hint).toContain('--depth');
    }
    expect(suggest('chaptr', ['chapter', 'novel'])).toEqual(['chapter']);
  });

  it('缺少参数、多余参数、非法选项值', () => {
    expect(() => parseArgv(['file', 'read'], commands)).toThrow(/缺少参数 <file>/);
    expect(() => parseArgv(['file', 'read', 'a', 'b'], commands)).toThrow(/多余的参数/);
    expect(() => parseArgv(['novel', 'export', 'x', '--format', 'pdf'], commands)).toThrow(
      /值无效/
    );
    expect(() => parseArgv(['file', 'list', '--depth', 'abc'], commands)).toThrow(/需要数字/);
  });

  it('help 与 --version', () => {
    expect(parseArgv([], commands).kind).toBe('help');
    expect(parseArgv(['--version'], commands).kind).toBe('version');
    const help = parseArgv(['chapter', 'merge', '--help'], commands);
    expect(help.kind === 'help' && help.topic).toEqual(['chapter', 'merge']);
  });

  it('退出码映射与命令清单', () => {
    expect(exitCodeFor('USAGE')).toBe(2);
    expect(exitCodeFor('NOT_FOUND')).toBe(3);
    expect(describeCommands(commands).map((item) => item.command)).toContain('batch find-replace');
  });
});

describe('runCli end-to-end', () => {
  it('init → novel → chapter → write → stats → export', async () => {
    expect((await ne(['init', 'book', '--json'])).exitCode).toBe(0);
    const cwd = ['--cwd', 'book', '--json'];
    expect((await ne(['novel', 'create', '小说', ...cwd])).exitCode).toBe(0);
    const chapter = await ne(['chapter', 'create', '小说', '开端', ...cwd]);
    expect(data<{ file: string }>(chapter).file).toBe('001-开端.md');

    const write = await ne(
      ['file', 'write', 'novels/小说/001-开端.md', '--stdin', ...cwd],
      '# 开端\n\n很久很久以前。\n'
    );
    expect(write.json.ok).toBe(true);

    const stats = await ne(['stats', '小说', ...cwd]);
    expect(data<{ kind: string; stats: { chars: number } }>(stats)).toMatchObject({
      kind: 'novel',
      stats: { chars: 10 },
    });

    const today = await ne(['stats', 'today', ...cwd]);
    expect(data<{ writes: number; net: number }>(today)).toMatchObject({ writes: 2, net: 10 });

    const exported = await ne(['novel', 'export', '小说', '--format', 'txt', ...cwd]);
    const output = data<{ output: string }>(exported).output;
    expect(await readFile(output, 'utf-8')).toContain('很久很久以前。');

    const read = await ne(['file', 'read', 'novels/小说/001-开端.md', '--cwd', 'book']);
    expect(read.stdout).toBe('# 开端\n\n很久很久以前。\n');
  });

  it('错误使用稳定 JSON 结构并返回非零退出码', async () => {
    const missing = await ne(['file', 'read', 'nope.md', '--json']);
    expect(missing.exitCode).toBe(3);
    expect(JSON.parse(missing.stdout)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });

    const notProject = await ne(['novel', 'list']);
    expect(notProject.exitCode).toBe(5);
    expect(notProject.stderr).toContain('ne init');

    const unknown = await ne(['batch', 'exprot', '.', '--json']);
    expect(unknown.exitCode).toBe(2);
    expect(unknown.json).toMatchObject({ ok: false, error: { code: 'UNKNOWN_COMMAND' } });

    const update = await ne(['update', '--check', '--json']);
    expect(update.exitCode).toBe(6);
    expect(update.json).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED' } });
  });

  it('--quiet 抑制提示信息，--json 帮助返回命令清单', async () => {
    await ne(['file', 'write', 'a.md', '张三']);
    const quiet = await ne(['file', 'search', '张三', '-q']);
    expect(quiet.stderr).toBe('');
    expect(quiet.stdout).toContain('a.md:1:1');

    const help = await ne(['--json']);
    expect(help.exitCode).toBe(0);
    expect(data<{ commands: unknown[] }>(help).commands.length).toBe(commands.length);
  });
});

describe('daemon', () => {
  const stateDir = path.join(os.tmpdir(), `ne-daemon-test-${process.pid}`);
  beforeAll(() => {
    process.env.NE_DAEMON_DIR = stateDir;
  });
  afterAll(async () => {
    delete process.env.NE_DAEMON_DIR;
    await rm(stateDir, { recursive: true, force: true });
  });

  it('serve → ping → rpc → shutdown', async () => {
    const daemon = await startDaemon({
      describe: () => describeCommands(commands),
      invoke: (request) =>
        runCli(request.argv, {
          cwd: request.cwd ?? dir,
          inDaemon: true,
          forceJson: true,
          io: {
            stdout: () => undefined,
            stderr: () => undefined,
            readStdin: async () => request.stdin ?? '',
          },
        }),
    });
    try {
      const ping = await ne(['ping', '--json']);
      expect(ping.json).toMatchObject({
        ok: true,
        data: { running: true, port: daemon.state.port },
      });
      expect(JSON.stringify(ping.json)).not.toContain(daemon.state.token);

      const rpc = (await daemonRequest(daemon.state, 'POST', '/rpc', {
        argv: ['file', 'write', 'x.md', '--stdin'],
        cwd: dir,
        stdin: '来自 AI',
      })) as { ok: boolean; exitCode: number };
      expect(rpc).toMatchObject({ ok: true, exitCode: 0 });
      expect(await readFile(path.join(dir, 'x.md'), 'utf-8')).toBe('来自 AI');

      const blocked = (await daemonRequest(daemon.state, 'POST', '/rpc', { argv: ['serve'] })) as {
        exitCode: number;
      };
      expect(blocked.exitCode).toBe(2);

      const unauthorized = await fetch(`${daemon.state.url}/ping`);
      expect(unauthorized.status).toBe(401);

      const shutdown = await ne(['shutdown', '--json']);
      expect(shutdown.json.ok).toBe(true);
      await daemon.closed;
      expect((await ne(['ping'])).exitCode).toBe(7);
    } finally {
      await daemon.close();
    }
  });
});
