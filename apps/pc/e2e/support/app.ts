/**
 * 启动真实的 Electron 应用（dist/main.mjs）并通过 remote debugging 端口连接主窗口
 *
 * - 使用 apps/pc/node_modules 中的 electron 二进制，与 `pnpm start` 一致
 * - NOVEL_EDITOR_E2E=1：复用烟雾测试的 userData 隔离，但不会在就绪后自动退出
 * - 最后一个 argv 为项目目录，主进程通过 launch-folder.ts 解析并打开
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CdpClient } from './cdp';
import { Page, sleep } from './page';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PC_ROOT = path.resolve(here, '../..');
export const ARTIFACTS_DIR = path.join(PC_ROOT, 'e2e', '.artifacts');

const requireFromPc = createRequire(path.join(PC_ROOT, 'package.json'));
/** electron 包导出的是可执行文件路径 */
const ELECTRON_BINARY = requireFromPc('electron') as unknown as string;

interface CdpTarget {
  id: string;
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl?: string;
}

export interface LaunchOptions {
  /** 启动时打开的项目目录；不传则模拟首次启动（无上次工作区） */
  projectDir?: string;
  /** 复用的 userData 目录（不传则新建临时目录，关闭时删除） */
  userDataDir?: string;
  /** 额外环境变量 */
  env?: Record<string, string>;
}

export interface ElectronApp {
  page: Page;
  process: ChildProcess;
  userDataDir: string;
  /** 主进程 stdout/stderr 输出，失败时写入 artifacts 便于排查 */
  logs: string[];
  close(): Promise<void>;
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export function buildAppEnv(userDataDir: string, extra: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    NOVEL_EDITOR_E2E: '1',
    NOVEL_EDITOR_SMOKE_TEST: '1',
    NOVEL_EDITOR_SMOKE_TEST_USER_DATA_DIR: userDataDir,
    NOVEL_EDITOR_DISABLE_AUTO_UPDATER: '1',
    ...extra,
  };
  // 防止外部开发环境变量把渲染进程指向 Vite dev server
  delete env.VITE_DEV_SERVER_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  // 「上传日志」在 E2E 中必须走本地兜底，不能真的上传到开发者本机配置的地址
  delete env.NOVEL_EDITOR_LOG_UPLOAD_URL;
  return env;
}

/** 以同样的 Electron + userData 启动一个进程（用于单实例转发场景），返回其退出码 */
export function spawnElectron(args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  // Linux CI runner 上 chrome-sandbox 没有 SUID 权限，需关闭 Chromium 沙箱才能启动
  const sandboxFlags =
    process.platform === 'linux' && (process.env.CI || process.env.NOVEL_EDITOR_E2E_NO_SANDBOX)
      ? ['--no-sandbox']
      : [];
  // All E2E profiles are disposable; never prompt for the host's login keychain.
  const keychainFlags = process.platform === 'darwin' ? ['--use-mock-keychain'] : [];
  return spawn(ELECTRON_BINARY, [PC_ROOT, ...sandboxFlags, ...keychainFlags, ...args], {
    cwd: PC_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    // POSIX 下作为进程组 leader，便于整组结束（Electron 会派生 GPU/渲染等子进程）
    detached: process.platform !== 'win32',
  });
}

async function findMainWindowTarget(port: number, timeoutMs: number): Promise<CdpTarget> {
  const deadline = Date.now() + timeoutMs;
  let lastSeen: CdpTarget[] = [];
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = (await response.json()) as CdpTarget[];
      lastSeen = targets;
      const main = targets.find(
        (target) =>
          target.type === 'page' &&
          target.webSocketDebuggerUrl &&
          !target.url.startsWith('devtools://') &&
          !target.url.includes('splash') &&
          /\/index\.html(\?|#|$)/.test(target.url) &&
          // AI 助手 / 右侧面板独立窗口同样加载 index.html，但带有 mode 查询参数
          !/[?&]mode=/.test(target.url)
      );
      if (main) return main;
    } catch {
      // 调试端口尚未就绪
    }
    await sleep(200);
  }
  throw new Error(`未找到主窗口调试目标，最后看到: ${JSON.stringify(lastSeen.map((t) => t.url))}`);
}

function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {
    try {
      child.kill(signal);
    } catch {
      // 进程已退出
    }
  }
}

export function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

export async function stopProcess(child: ChildProcess): Promise<void> {
  killTree(child, 'SIGTERM');
  if (!(await waitForExit(child, 5_000))) {
    killTree(child, 'SIGKILL');
    await waitForExit(child, 5_000);
  }
}

export async function launchApp(options: LaunchOptions): Promise<ElectronApp> {
  const ownsUserData = !options.userDataDir;
  const userDataDir =
    options.userDataDir ?? (await mkdtemp(path.join(tmpdir(), 'novel-editor-e2e-userdata-')));
  await mkdir(userDataDir, { recursive: true });
  const port = await getFreePort();
  const env = buildAppEnv(userDataDir, options.env);
  const child = spawnElectron(
    [
      `--remote-debugging-port=${port}`,
      // 窗口被遮挡 / 失焦时 Chromium 会节流定时器并暂停 rAF，导致用例偶发变慢或超时
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      // 测试时不出声（NOVEL_EDITOR_E2E_BACKGROUND=1 时窗口还会在后台运行，见主进程 e2e-background.ts）
      '--mute-audio',
      // Hosted Linux has no GPU; explicit SwANGLE supplies WebGL for real 3D tests.
      ...(process.env.CI && process.platform === 'linux'
        ? ['--use-gl=angle', '--use-angle=swiftshader']
        : []),
      ...(options.projectDir ? [options.projectDir] : []),
    ],
    env
  );

  const logs: string[] = [];
  const collect = (stream: NodeJS.ReadableStream | null, label: string) => {
    stream?.setEncoding('utf8');
    stream?.on('data', (chunk: string) => {
      logs.push(`[${label}] ${chunk}`);
      if (process.env.NOVEL_EDITOR_E2E_VERBOSE === '1') process.stderr.write(chunk);
    });
  };
  collect(child.stdout, 'stdout');
  collect(child.stderr, 'stderr');

  let cdp: CdpClient | null = null;
  const close = async () => {
    cdp?.close();
    await stopProcess(child);
    if (ownsUserData) {
      await rm(userDataDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    }
  };

  try {
    const exited = new Promise<never>((_, reject) => {
      child.once('exit', (code, signal) =>
        reject(new Error(`Electron 提前退出 code=${code} signal=${signal}\n${logs.join('')}`))
      );
    });
    const target = await Promise.race([findMainWindowTarget(port, 30_000), exited]);
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl as string);
    const page = new Page(cdp, ARTIFACTS_DIR);
    await page.init();
    exited.catch(() => {});
    return { page, process: child, userDataDir, logs, close };
  } catch (error) {
    await writeLogs('launch-failure', logs);
    await close();
    throw error;
  }
}

export async function writeLogs(name: string, logs: string[]): Promise<void> {
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  await writeFile(
    path.join(ARTIFACTS_DIR, `${name.replace(/[^\w\u4e00-\u9fa5-]+/g, '_')}.log`),
    logs.join(''),
    'utf-8'
  ).catch(() => {});
}
