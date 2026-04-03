import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import JSZip from 'jszip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const appDir = resolve(__dirname, '..');
const buildDir = join(appDir, 'build');
const distDir = join(appDir, 'dist');
const packageJsonPath = join(appDir, 'package.json');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function inferChannel(version) {
  const lowerVersion = version.toLowerCase();
  if (lowerVersion.includes('-alpha.') || lowerVersion.includes('-canary.')) {
    return 'alpha';
  }
  if (lowerVersion.includes('-beta.')) {
    return 'beta';
  }
  return 'latest';
}

async function run(command, args, cwd) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
    });
    child.once('error', rejectPromise);
    child.once('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`)
      );
    });
  });
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  return hash.digest('hex');
}

async function assertPathExists(filePath, message) {
  assert.ok(existsSync(filePath), `${message}: ${filePath}`);
}

async function main() {
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const version = packageJson.version;
  const channelKey = process.env.NOVEL_EDITOR_RELEASE_CHANNEL ?? inferChannel(version);
  const platform = process.env.NOVEL_EDITOR_BUILD_PLATFORM ?? process.platform;
  const arch = process.env.NOVEL_EDITOR_BUILD_ARCH ?? process.arch;
  const manifestPath = join(buildDir, `runtime-package-${channelKey}-${platform}-${arch}.json`);

  // 预检必须直接覆盖真实构建链，避免只验证缓存产物。
  await run(pnpmCommand, ['build'], appDir);
  await run(pnpmCommand, ['bundle:runtime-package'], appDir);

  for (const requiredDistFile of [
    join(distDir, 'main.mjs'),
    join(distDir, 'main-runtime.mjs'),
    join(distDir, 'preload.js'),
    join(distDir, 'index.html'),
    join(distDir, 'splash', 'splash.html'),
  ]) {
    await assertPathExists(requiredDistFile, '缺少运行时构建产物');
  }

  await assertPathExists(manifestPath, '缺少运行包清单');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const bundlePath = join(buildDir, manifest.bundleFile);
  await assertPathExists(bundlePath, '缺少运行包压缩包');

  assert.equal(manifest.version, version, '运行包清单版本号与 package.json 不一致');
  assert.equal(manifest.platform, platform, '运行包清单 platform 不一致');
  assert.equal(manifest.arch, arch, '运行包清单 arch 不一致');
  assert.ok(manifest.runtimeApiVersion >= 1, '运行包清单 runtimeApiVersion 非法');

  const bundleStat = await stat(bundlePath);
  assert.equal(manifest.size, bundleStat.size, '运行包清单 size 与压缩包实际大小不一致');
  assert.equal(manifest.sha256, await sha256(bundlePath), '运行包清单 sha256 校验失败');

  const zip = await JSZip.loadAsync(await readFile(bundlePath));
  const entries = Object.keys(zip.files);
  const requiredZipEntries = [
    'dist/main-runtime.mjs',
    'dist/preload.js',
    'dist/index.html',
    'dist/splash/splash.html',
  ];
  for (const requiredEntry of requiredZipEntries) {
    assert.ok(entries.includes(requiredEntry), `运行包压缩包缺少关键文件: ${requiredEntry}`);
  }
  assert.ok(
    entries.some((entry) => entry.startsWith('node_modules/better-sqlite3/')),
    '运行包压缩包缺少 better-sqlite3 运行时依赖'
  );

  console.log('Preflight passed');
  console.log(`Version: ${version}`);
  console.log(`Channel: ${channelKey}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`Bundle: ${bundlePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
