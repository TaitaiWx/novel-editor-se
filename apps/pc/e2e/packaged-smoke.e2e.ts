/**
 * 打包产物启动烟雾测试（原 scripts/run-packaged-smoke-test.mjs）
 *
 * 启动 electron-builder 输出目录（apps/pc/build）中的可执行文件，带 --smoke-test 运行：
 * - 进程以 0 退出（应用内 smoke 逻辑正常结束）→ 通过
 * - 必须收到渲染进程健康确认并以 0 退出；仅存活或超时不算成功
 * - 存活窗口内非 0 退出 → 失败
 * 没有打包产物时自动跳过，因此日常 `pnpm test:e2e` 不受影响；发布流程打包后执行即可覆盖。
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { resolvePackagedExecutable } from './support/packaged-executable';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(here, '..');
const BUILD_DIR = process.env.NOVEL_EDITOR_PACKAGED_BUILD_DIR ?? path.join(APP_ROOT, 'build');
const SMOKE_TIMEOUT_MS = 60_000;

type SmokeOutcome = { kind: 'exited-ok' };

async function runSmoke(executable: string, userDataDir: string): Promise<SmokeOutcome> {
  const started = Date.now();
  let output = '';
  const append = (label: string, chunk: Buffer) => {
    output = (output + `[+${Date.now() - started}ms ${label}] ${chunk.toString()}`).slice(
      -1024 * 1024
    );
  };
  try {
    return await new Promise((resolve, reject) => {
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
          // Consume both streams continuously; keep a bounded tail for CI diagnostics.
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
      child.stdout?.on('data', (chunk: Buffer) => append('stdout', chunk));
      child.stderr?.on('data', (chunk: Buffer) => append('stderr', chunk));

      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
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
                  `烟雾测试启动崩溃: code=${code ?? 'null'} signal=${signal ?? 'null'} output=${output.trim()}`
                )
              )
        )
      );

      const absoluteTimer = setTimeout(
        () =>
          finish(() => {
            child.kill('SIGKILL');
            reject(new Error(`烟雾测试绝对超时（${SMOKE_TIMEOUT_MS}ms） output=${output.trim()}`));
          }),
        SMOKE_TIMEOUT_MS
      );
    });
  } finally {
    const artifacts = path.join(APP_ROOT, 'e2e', '.artifacts');
    await mkdir(artifacts, { recursive: true });
    await writeFile(
      path.join(artifacts, `packaged-smoke-${process.platform}-${Date.now()}.log`),
      `executable=${executable}\nelapsed=${Date.now() - started}ms\n${output}`,
      'utf8'
    );
  }
}

const executable = resolvePackagedExecutable(BUILD_DIR);

describe('打包产物烟雾测试', () => {
  it.skipIf(process.env.NOVEL_EDITOR_REQUIRE_PACKAGED_SMOKE !== '1')('CI 必须找到打包产物', () => {
    expect(executable, `Missing packaged executable in ${BUILD_DIR}`).not.toBeNull();
  });
  it.skipIf(!executable || process.platform !== 'darwin')(
    '打包产物使用本地化展示名并保留 Helper 的原始名称',
    async () => {
      const contents = path.resolve(executable!, '../..');
      const resources = path.join(contents, 'Resources');
      const locales = readdirSync(resources).filter((name) => name.endsWith('.lproj'));
      expect(locales.length).toBeGreaterThan(0);
      for (const locale of locales) {
        const value = await readFile(path.join(resources, locale, 'InfoPlist.strings'));
        expect(value.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfe]));
        expect(value.subarray(2).toString('utf16le')).toContain('"CFBundleName" = "小说编辑器";');
      }
      const bundleName = execFileSync(
        '/usr/libexec/PlistBuddy',
        ['-c', 'Print :CFBundleName', path.join(contents, 'Info.plist')],
        { encoding: 'utf8' }
      ).trim();
      expect(bundleName).toBe('Novel Editor');
      expect(existsSync(path.join(contents, 'Frameworks', `${bundleName} Helper.app`))).toBe(true);
    }
  );
  it.skipIf(!executable)(
    '打包后的应用能正常启动且不崩溃',
    async () => {
      const userDataDir = await mkdtemp(path.join(tmpdir(), 'novel-editor-smoke-'));
      try {
        const outcome = await runSmoke(executable as string, userDataDir);
        expect(outcome.kind).toBe('exited-ok');
      } finally {
        // Windows 上 Electron 子进程可能延迟释放文件句柄，交给 rm 自带的重试
        await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 1_000 });
      }
    },
    SMOKE_TIMEOUT_MS + 10_000
  );
});
