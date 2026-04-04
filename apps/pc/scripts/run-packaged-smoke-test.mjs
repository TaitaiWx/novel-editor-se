import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdtemp, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, '..');
const buildDir = join(appRoot, 'build');
const SMOKE_SCRIPT_FINGERPRINT = 'smoke-v3-alive-check';
const SMOKE_TIMEOUT_MS = 60_000;

/** 启动后存活这么久不崩溃即视为烟雾测试通过 */
const SMOKE_ALIVE_MS = 5_000;

async function findFirstDirectory(parentDir, matcher) {
  const entries = await readdir(parentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (matcher(entry.name)) {
      return join(parentDir, entry.name);
    }
  }
  return null;
}

async function resolveSmokeExecutable() {
  if (process.platform === 'darwin') {
    const appOutDir = await findFirstDirectory(buildDir, (name) => name.startsWith('mac'));
    if (!appOutDir) {
      throw new Error('未找到 mac 打包目录');
    }

    const appBundleDir = await findFirstDirectory(appOutDir, (name) => name.endsWith('.app'));
    if (!appBundleDir) {
      throw new Error('未找到 .app 包');
    }

    const executableName = appBundleDir.replace(/^.*\//u, '').replace(/\.app$/u, '');
    const executablePath = join(appBundleDir, 'Contents', 'MacOS', executableName);
    if (!existsSync(executablePath)) {
      throw new Error(`未找到 mac 可执行文件: ${executablePath}`);
    }
    return executablePath;
  }

  if (process.platform === 'win32') {
    const unpackedDir = await findFirstDirectory(buildDir, (name) => name.endsWith('unpacked'));
    if (!unpackedDir) {
      throw new Error('未找到 Windows unpacked 目录');
    }

    const entries = await readdir(unpackedDir, { withFileTypes: true });
    const executable = entries.find((entry) => entry.isFile() && entry.name.endsWith('.exe'));
    if (!executable) {
      throw new Error('未找到 Windows 可执行文件');
    }
    const exePath = join(unpackedDir, executable.name);
    if (!existsSync(exePath)) {
      throw new Error(`Windows 可执行文件不存在: ${exePath}`);
    }
    return exePath;
  }

  const unpackedDir = await findFirstDirectory(buildDir, (name) => name.endsWith('unpacked'));
  if (!unpackedDir) {
    throw new Error('未找到 Linux unpacked 目录');
  }

  const entries = await readdir(unpackedDir, { withFileTypes: true });
  const executable = entries.find((entry) => entry.isFile());
  if (!executable) {
    throw new Error('未找到 Linux 可执行文件');
  }
  return join(unpackedDir, executable.name);
}

async function main() {
  if (process.argv.includes('--fingerprint')) {
    console.log(`smoke-script-fingerprint=${SMOKE_SCRIPT_FINGERPRINT}`);
    return;
  }

  const executablePath = await resolveSmokeExecutable();
  console.log(
    `烟雾测试可执行文件: ${executablePath} (platform=${process.platform}, arch=${process.arch})`
  );
  const smokeUserDataDir = await mkdtemp(join(tmpdir(), 'novel-editor-smoke-'));

  try {
    await new Promise((resolvePromise, rejectPromise) => {
      let finished = false;
      let stderr = '';
      let aliveTimer = null;
      let absoluteTimer = null;
      let forceKillTimer = null;

      const child = spawn(
        executablePath,
        [
          '--smoke-test',
          // CI 环境下 Linux 的 chrome-sandbox 没有 SUID 权限，需要禁用沙箱
          ...(process.env.CI ? ['--no-sandbox', '--disable-gpu-sandbox'] : []),
        ],
        {
          cwd: appRoot,
          env: {
            ...process.env,
            NODE_ENV: 'production',
            NOVEL_EDITOR_SMOKE_TEST: '1',
            NOVEL_EDITOR_DISABLE_AUTO_UPDATER: '1',
            NOVEL_EDITOR_SMOKE_TEST_USER_DATA_DIR: smokeUserDataDir,
          },
          // 仅采集 stderr；stdout 不建管道，避免日志过多时阻塞子进程。
          stdio: ['ignore', 'ignore', 'pipe'],
        }
      );

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      const cleanup = () => {
        if (aliveTimer) {
          clearTimeout(aliveTimer);
          aliveTimer = null;
        }
        if (absoluteTimer) {
          clearTimeout(absoluteTimer);
          absoluteTimer = null;
        }
        if (forceKillTimer) {
          clearTimeout(forceKillTimer);
          forceKillTimer = null;
        }
        child.removeAllListeners('error');
        child.removeAllListeners('exit');
      };

      const finishResolve = () => {
        if (finished) return;
        finished = true;
        cleanup();
        resolvePromise(undefined);
      };

      const finishReject = (error) => {
        if (finished) return;
        finished = true;
        cleanup();
        rejectPromise(error);
      };

      // 如果进程在存活窗口内崩溃/退出，视为失败
      child.once('error', (error) => {
        finishReject(error);
      });

      child.once('exit', (code, signal) => {
        // 进程主动以 0 退出 → 通过（app 内部 smoke 逻辑正常退出）
        if (code === 0) {
          finishResolve();
          return;
        }
        // 存活窗口内非 0 退出 → 失败
        finishReject(
          new Error(
            `烟雾测试启动崩溃: code=${code ?? 'null'} signal=${signal ?? 'null'} stderr=${stderr.trim()}`
          )
        );
      });

      // 存活窗口结束后：进程仍在运行 → 启动成功，主动 kill
      aliveTimer = setTimeout(() => {
        console.log(`进程启动后存活 ${SMOKE_ALIVE_MS}ms 未崩溃，烟雾测试通过`);
        child.kill('SIGTERM');
        // 给进程一点时间优雅退出，否则强制 kill
        forceKillTimer = setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 3_000);
        finishResolve();
      }, SMOKE_ALIVE_MS);

      // 绝对超时保护（防止极端情况）
      absoluteTimer = setTimeout(() => {
        child.kill('SIGKILL');
        finishReject(new Error(`烟雾测试绝对超时（${SMOKE_TIMEOUT_MS}ms）`));
      }, SMOKE_TIMEOUT_MS);
    });

    console.log(`打包产物启动烟雾测试通过: ${executablePath}`);
  } finally {
    await rm(smokeUserDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('打包产物启动烟雾测试失败:', error);
  process.exit(1);
});
