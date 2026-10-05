/**
 * 打包产物启动烟雾测试（原 scripts/run-packaged-smoke-test.mjs）
 *
 * 启动 electron-builder 输出目录（apps/pc/build）中的可执行文件，带 --smoke-test 运行：
 * - 进程以 0 退出（应用内 smoke 逻辑正常结束）→ 通过
 * - 启动后存活 SMOKE_ALIVE_MS 未崩溃 → 通过并主动结束
 * - 存活窗口内非 0 退出 → 失败
 * 没有打包产物时自动跳过，因此日常 `pnpm test:e2e` 不受影响；发布流程打包后执行即可覆盖。
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(here, '..');
const BUILD_DIR = path.join(APP_ROOT, 'build');
const SMOKE_ALIVE_MS = 5_000;
const SMOKE_TIMEOUT_MS = 60_000;

function findFirstDirectory(parentDir: string, matcher: (name: string) => boolean): string | null {
  if (!existsSync(parentDir)) return null;
  const entry = readdirSync(parentDir, { withFileTypes: true }).find(
    (item) => item.isDirectory() && matcher(item.name)
  );
  return entry ? path.join(parentDir, entry.name) : null;
}

/** 按平台定位打包后的可执行文件；找不到返回 null */
function resolvePackagedExecutable(
  buildDir: string = BUILD_DIR,
  platform: NodeJS.Platform = process.platform
): string | null {
  if (platform === 'darwin') {
    const appOutDir = findFirstDirectory(buildDir, (name) => name.startsWith('mac'));
    const appBundle = appOutDir && findFirstDirectory(appOutDir, (name) => name.endsWith('.app'));
    if (!appBundle) return null;
    const executableName = path.basename(appBundle).replace(/\.app$/u, '');
    const executable = path.join(appBundle, 'Contents', 'MacOS', executableName);
    return existsSync(executable) ? executable : null;
  }

  const unpackedDir = findFirstDirectory(buildDir, (name) => name.endsWith('unpacked'));
  if (!unpackedDir) return null;
  const file = readdirSync(unpackedDir, { withFileTypes: true }).find(
    (entry) => entry.isFile() && (platform === 'win32' ? entry.name.endsWith('.exe') : true)
  );
  return file ? path.join(unpackedDir, file.name) : null;
}

type SmokeOutcome = { kind: 'exited-ok' } | { kind: 'alive' };

function runSmoke(executable: string, userDataDir: string): Promise<SmokeOutcome> {
  return new Promise((resolve, reject) => {
    let stderr = '';
    let settled = false;
    const child = spawn(
      executable,
      // Linux CI 的 chrome-sandbox 没有 SUID 权限，需要禁用沙箱
      ['--smoke-test', ...(process.env.CI ? ['--no-sandbox', '--disable-gpu-sandbox'] : [])],
      {
        cwd: APP_ROOT,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          NOVEL_EDITOR_SMOKE_TEST: '1',
          NOVEL_EDITOR_DISABLE_AUTO_UPDATER: '1',
          NOVEL_EDITOR_SMOKE_TEST_USER_DATA_DIR: userDataDir,
        },
        // 仅采集 stderr；stdout 不建管道，避免日志过多阻塞子进程
        stdio: ['ignore', 'ignore', 'pipe'],
      }
    );
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(aliveTimer);
      clearTimeout(absoluteTimer);
      action();
    };

    child.once('error', (error) => finish(() => reject(error)));
    child.once('exit', (code, signal) =>
      finish(() =>
        code === 0
          ? resolve({ kind: 'exited-ok' })
          : reject(
              new Error(
                `烟雾测试启动崩溃: code=${code ?? 'null'} signal=${signal ?? 'null'} stderr=${stderr.trim()}`
              )
            )
      )
    );

    // 存活窗口结束仍在运行 → 启动成功，主动结束进程
    const aliveTimer = setTimeout(
      () =>
        finish(() => {
          child.kill('SIGTERM');
          setTimeout(() => {
            if (child.exitCode === null) child.kill('SIGKILL');
          }, 3_000).unref();
          resolve({ kind: 'alive' });
        }),
      SMOKE_ALIVE_MS
    );
    const absoluteTimer = setTimeout(
      () =>
        finish(() => {
          child.kill('SIGKILL');
          reject(new Error(`烟雾测试绝对超时（${SMOKE_TIMEOUT_MS}ms）`));
        }),
      SMOKE_TIMEOUT_MS
    );
  });
}

const executable = resolvePackagedExecutable();

describe('打包产物烟雾测试', () => {
  it.skipIf(!executable)(
    '打包后的应用能正常启动且不崩溃',
    async () => {
      const userDataDir = await mkdtemp(path.join(tmpdir(), 'novel-editor-smoke-'));
      try {
        const outcome = await runSmoke(executable as string, userDataDir);
        expect(['exited-ok', 'alive']).toContain(outcome.kind);
      } finally {
        // Windows 上 Electron 子进程可能延迟释放文件句柄，交给 rm 自带的重试
        await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 1_000 });
      }
    },
    SMOKE_TIMEOUT_MS + 10_000
  );
});
