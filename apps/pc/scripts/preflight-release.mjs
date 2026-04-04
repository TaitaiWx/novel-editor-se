import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { mkdir, readdir, rm } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, '..');
const repoRoot = resolve(appRoot, '..', '..');
const buildDir = join(appRoot, 'build');
const distDir = join(appRoot, 'dist');

function getPreflightPackageArgs() {
  // 预检只做“最轻量但能生成更新元数据”的目标，避免本机环境被 dmg 等重目标拖垮。
  if (process.platform === 'darwin') {
    return ['--mac', 'zip'];
  }

  if (process.platform === 'win32') {
    return ['--win', 'nsis'];
  }

  return ['--linux', 'AppImage'];
}

function runCommand(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  if (result.status !== 0) {
    throw new Error(`命令执行失败: ${command} ${args.join(' ')}`);
  }
}

async function ensureFileExists(filePath, description) {
  if (!existsSync(filePath)) {
    throw new Error(`缺少${description}: ${filePath}`);
  }
}

async function collectFiles(dir, predicate, collected = []) {
  if (!existsSync(dir)) {
    return collected;
  }

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(fullPath, predicate, collected);
      continue;
    }

    if (predicate(fullPath, entry.name)) {
      collected.push(fullPath);
    }
  }

  return collected;
}

async function main() {
  await rm(buildDir, { recursive: true, force: true });
  await rm(distDir, { recursive: true, force: true });
  await mkdir(buildDir, { recursive: true });

  runCommand('pnpm', ['test:pc-updater']);
  runCommand('pnpm', ['--filter', '@novel-editor/pc', 'typecheck']);
  runCommand('pnpm', ['--filter', '@novel-editor/pc', 'build']);
  runCommand(
    'pnpm',
    [
      '--filter',
      '@novel-editor/pc',
      'exec',
      'electron-builder',
      ...getPreflightPackageArgs(),
      '--publish',
      'never',
    ],
    {
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    }
  );
  runCommand('node', [join(appRoot, 'scripts', 'prepare-update-metadata.mjs'), buildDir]);

  await ensureFileExists(join(distDir, 'main.mjs'), '主进程构建产物');
  await ensureFileExists(join(distDir, 'preload.js'), 'preload 构建产物');
  await ensureFileExists(join(distDir, 'index.html'), 'renderer 构建产物');

  const updateMetadataFiles = await collectFiles(buildDir, (_fullPath, fileName) =>
    /^(latest|beta|alpha)(-mac|-linux)?\.yml$/u.test(fileName)
  );
  if (updateMetadataFiles.length === 0) {
    throw new Error('未生成自动更新元数据文件');
  }

  const metadataContent = readFileSync(updateMetadataFiles[0], 'utf8');
  if (!metadataContent.includes('stagingPercentage:')) {
    throw new Error(`更新元数据缺少 stagingPercentage: ${updateMetadataFiles[0]}`);
  }

  const asarFiles = await collectFiles(buildDir, (_fullPath, fileName) => fileName === 'app.asar');
  if (asarFiles.length === 0) {
    throw new Error('目录打包产物中未找到 app.asar');
  }

  const sqliteBindings = await collectFiles(
    buildDir,
    (fullPath, fileName) =>
      fileName === 'better_sqlite3.node' && fullPath.includes('app.asar.unpacked')
  );
  if (sqliteBindings.length === 0) {
    throw new Error('目录打包产物中未找到解包后的 better-sqlite3 原生模块');
  }

  runCommand('node', [join(appRoot, 'scripts', 'run-packaged-smoke-test.mjs')]);

  console.log('发布前预检通过');
}

main().catch((error) => {
  console.error('发布前预检失败:', error);
  process.exit(1);
});
