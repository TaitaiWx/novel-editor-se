/**
 * Headless daemon（ne serve）
 *
 * - 仅监听 127.0.0.1，启动后把 { pid, port, token } 写入状态文件（权限 0600）
 *   状态文件位置：$NE_DAEMON_DIR 或 <os.tmpdir()>/novel-editor-cli/daemon.json
 * - 所有请求需携带 `Authorization: Bearer <token>`（token 从状态文件读取）
 * - 接口：
 *     GET  /ping       → { ok: true, data: { pid, version, uptimeMs, ... } }
 *     GET  /commands   → { ok: true, data: [命令清单] }
 *     POST /rpc        → 请求体 { argv: string[], cwd?: string, stdin?: string }
 *                        响应体 { ok, data | error, exitCode }，与 `ne <argv> --json` 输出一致
 *     POST /shutdown   → 关闭 daemon
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { CliError } from './errors';
import { CLI_VERSION } from './version';
import type { RpcRequest, RpcResponse } from './types';

export interface DaemonState {
  pid: number;
  host: string;
  port: number;
  token: string;
  url: string;
  version: string;
  startedAt: string;
}

const MAX_BODY_BYTES = 50 * 1024 * 1024;

export function getDaemonStateDir(): string {
  return process.env.NE_DAEMON_DIR || path.join(os.tmpdir(), 'novel-editor-cli');
}

export function getDaemonStatePath(): string {
  return path.join(getDaemonStateDir(), 'daemon.json');
}

export async function readDaemonState(): Promise<DaemonState | null> {
  try {
    const raw = JSON.parse(await readFile(getDaemonStatePath(), 'utf-8')) as DaemonState;
    return typeof raw.port === 'number' && typeof raw.token === 'string' ? raw : null;
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** 向 daemon 发送请求，返回解析后的 JSON */
export async function daemonRequest(
  state: DaemonState,
  method: 'GET' | 'POST',
  route: string,
  body?: unknown,
  timeoutMs = 5000
): Promise<unknown> {
  const response = await fetch(`${state.url}${route}`, {
    method,
    headers: {
      authorization: `Bearer ${state.token}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return response.json();
}

/** 读取状态并确认 daemon 存活；未运行时清理残留状态文件并返回 null */
export async function getRunningDaemon(): Promise<{ state: DaemonState; info: unknown } | null> {
  const state = await readDaemonState();
  if (!state) return null;
  if (!isProcessAlive(state.pid)) {
    await rm(getDaemonStatePath(), { force: true });
    return null;
  }
  try {
    const info = await daemonRequest(state, 'GET', '/ping', undefined, 2000);
    return { state, info };
  } catch {
    return null;
  }
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new CliError('INVALID_ARGUMENT', '请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function parseRpcRequest(raw: string): RpcRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch {
    throw new CliError('INVALID_ARGUMENT', '请求体不是合法 JSON');
  }
  const value = parsed as Partial<RpcRequest>;
  if (!Array.isArray(value.argv) || !value.argv.every((item) => typeof item === 'string')) {
    throw new CliError('INVALID_ARGUMENT', '请求体需要 argv: string[]');
  }
  return {
    argv: value.argv,
    cwd: typeof value.cwd === 'string' ? value.cwd : undefined,
    stdin: typeof value.stdin === 'string' ? value.stdin : undefined,
  };
}

export interface StartDaemonOptions {
  port?: number;
  invoke(request: RpcRequest): Promise<RpcResponse>;
  describe(): unknown;
}

export interface RunningDaemon {
  state: DaemonState;
  /** daemon 关闭时 resolve */
  closed: Promise<void>;
  close(): Promise<void>;
}

export async function startDaemon(options: StartDaemonOptions): Promise<RunningDaemon> {
  const existing = await getRunningDaemon();
  if (existing) {
    throw new CliError(
      'ALREADY_EXISTS',
      `daemon 已在运行（pid ${existing.state.pid}，${existing.state.url}）`,
      '使用 `ne shutdown` 关闭后再启动'
    );
  }

  const token = randomBytes(24).toString('hex');
  const startedAt = Date.now();
  let resolveClosed: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const server = http.createServer((req, res) => {
    void (async () => {
      if (req.headers.authorization !== `Bearer ${token}`) {
        sendJson(res, 401, {
          ok: false,
          error: { code: 'UNAUTHORIZED', message: '缺少或错误的 token' },
        });
        return;
      }
      const route = (req.url ?? '/').split('?')[0];
      try {
        if (req.method === 'GET' && route === '/ping') {
          sendJson(res, 200, {
            ok: true,
            data: {
              pid: process.pid,
              version: CLI_VERSION,
              uptimeMs: Date.now() - startedAt,
              url: state.url,
            },
          });
        } else if (req.method === 'GET' && route === '/commands') {
          sendJson(res, 200, { ok: true, data: options.describe() });
        } else if (req.method === 'POST' && route === '/rpc') {
          const request = parseRpcRequest(await readBody(req));
          const result = await options.invoke(request);
          sendJson(res, 200, { ...result.envelope, exitCode: result.exitCode });
        } else if (req.method === 'POST' && route === '/shutdown') {
          sendJson(res, 200, { ok: true, data: { stopping: true, pid: process.pid } });
          setImmediate(() => void close());
        } else {
          sendJson(res, 404, {
            ok: false,
            error: { code: 'NOT_FOUND', message: `未知接口: ${req.method} ${route}` },
          });
        }
      } catch (error) {
        const code = error instanceof CliError ? error.code : 'INTERNAL';
        sendJson(res, code === 'INTERNAL' ? 500 : 400, {
          ok: false,
          error: { code, message: error instanceof Error ? error.message : String(error) },
          exitCode: 1,
        });
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  const state: DaemonState = {
    pid: process.pid,
    host: '127.0.0.1',
    port: address.port,
    token,
    url: `http://127.0.0.1:${address.port}`,
    version: CLI_VERSION,
    startedAt: new Date(startedAt).toISOString(),
  };
  await mkdir(getDaemonStateDir(), { recursive: true, mode: 0o700 });
  await writeFile(getDaemonStatePath(), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });

  let closing = false;
  async function close(): Promise<void> {
    if (closing) return closed;
    closing = true;
    const current = await readDaemonState();
    if (current?.pid === process.pid) await rm(getDaemonStatePath(), { force: true });
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resolveClosed();
  }

  return { state, closed, close };
}
