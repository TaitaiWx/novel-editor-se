import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdtemp, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, '..');
const buildDir = join(appRoot, 'build');
const SMOKE_TIMEOUT_MS = 30_000;

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
  const executablePath = await resolveSmokeExecutable();
  console.log(
    `烟雾测试可执行文件: ${executablePath} (platform=${process.platform}, arch=${process.arch})`
  );
  const smokeUserDataDir = await mkdtemp(join(tmpdir(), 'novel-editor-smoke-'));

  try {
    await new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        rejectPromise(new Error(`烟雾测试超时（${SMOKE_TIMEOUT_MS}ms）`));
      }, SMOKE_TIMEOUT_MS);

      const child = spawn(executablePath, ['--smoke-test'], {
        cwd: appRoot,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          NOVEL_EDITOR_SMOKE_TEST: '1',
          NOVEL_EDITOR_DISABLE_AUTO_UPDATER: '1',
          NOVEL_EDITOR_SMOKE_TEST_USER_DATA_DIR: smokeUserDataDir,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.once('error', (error) => {
        clearTimeout(timer);
        rejectPromise(error);
      });

      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        if (code === 0) {
          resolvePromise(undefined);
          return;
        }

        rejectPromise(
          new Error(
            `烟雾测试启动失败: code=${code ?? 'null'} signal=${signal ?? 'null'} stderr=${stderr.trim()}`
          )
        );
      });
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
