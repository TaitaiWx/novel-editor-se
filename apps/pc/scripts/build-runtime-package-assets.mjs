import { createHash } from 'crypto';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const appDir = resolve(__dirname, '..');
const distDir = join(appDir, 'dist');
const buildDir = join(appDir, 'build');
const packageJsonPath = join(appDir, 'package.json');
const releaseNotesPath = join(appDir, 'release-notes.json');

function inferChannel(version) {
  const lowerVersion = version.toLowerCase();
  if (lowerVersion.includes('-alpha.') || lowerVersion.includes('-canary.')) {
    return 'canary';
  }
  if (lowerVersion.includes('-beta.')) {
    return 'beta';
  }
  return 'stable';
}

function mapChannel(channel) {
  switch (channel) {
    case 'stable':
      return 'latest';
    case 'beta':
      return 'beta';
    case 'canary':
      return 'alpha';
    default:
      return channel;
  }
}

function normalizeChannel(channelKey) {
  if (channelKey === 'latest') return 'stable';
  if (channelKey === 'alpha') return 'canary';
  return channelKey;
}

function getRolloutPercentage(channelKey) {
  const envMap = {
    latest: process.env.NOVEL_EDITOR_STABLE_STAGING_PERCENTAGE,
    beta: process.env.NOVEL_EDITOR_BETA_STAGING_PERCENTAGE,
    alpha: process.env.NOVEL_EDITOR_CANARY_STAGING_PERCENTAGE,
  };

  const parsed = Number.parseInt(envMap[channelKey] ?? '', 10);
  if (!Number.isNaN(parsed)) {
    return Math.max(1, Math.min(parsed, 100));
  }

  if (channelKey === 'alpha') {
    return 10;
  }

  return 100;
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function run(command, args, options = {}) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options,
    });
    child.once('error', rejectPromise);
    child.once('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`${command} exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function createZipArchive(sourceDir, outputPath) {
  if (process.platform === 'win32') {
    await run('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -Path (Join-Path '${sourceDir.replace(/'/g, "''")}' '*') -DestinationPath '${outputPath.replace(/'/g, "''")}' -Force`,
    ]);
    return;
  }

  await run('zip', ['-qr', outputPath, '.'], { cwd: sourceDir });
}

async function copyRuntimePayload(stagingDir) {
  await cp(distDir, join(stagingDir, 'dist'), {
    recursive: true,
    dereference: true,
  });

  await cp(
    join(appDir, 'node_modules', 'better-sqlite3'),
    join(stagingDir, 'node_modules', 'better-sqlite3'),
    {
      recursive: true,
      dereference: true,
    }
  );

  if (existsSync(releaseNotesPath)) {
    await cp(releaseNotesPath, join(stagingDir, 'release-notes.json'), {
      dereference: true,
      force: true,
    });
  }
}

async function main() {
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const version = packageJson.version;
  const inferredChannel = inferChannel(version);
  const channelKey = process.env.NOVEL_EDITOR_RELEASE_CHANNEL ?? mapChannel(inferredChannel);
  const channel = normalizeChannel(channelKey);
  const platform = process.env.NOVEL_EDITOR_BUILD_PLATFORM ?? process.platform;
  const arch = process.env.NOVEL_EDITOR_BUILD_ARCH ?? process.arch;
  const stagingPercentage = getRolloutPercentage(channelKey);
  const stagingDir = join(buildDir, `.runtime-package-staging-${platform}-${arch}`);
  const bundleFile = `runtime-package-${channelKey}-${platform}-${arch}-${version}.zip`;
  const bundlePath = join(buildDir, bundleFile);
  const manifestPath = join(buildDir, `runtime-package-${channelKey}-${platform}-${arch}.json`);

  await rm(stagingDir, { recursive: true, force: true });
  await rm(bundlePath, { force: true });
  await mkdir(stagingDir, { recursive: true });
  await mkdir(buildDir, { recursive: true });
  await copyRuntimePayload(stagingDir);
  await createZipArchive(stagingDir, bundlePath);

  const bundleStat = await stat(bundlePath);
  const manifest = {
    schemaVersion: 1,
    runtimeApiVersion: 1,
    channel,
    version,
    platform,
    arch,
    stagingPercentage,
    bundleFile,
    sha256: await sha256(bundlePath),
    size: bundleStat.size,
    publishedAt: new Date().toISOString(),
    releaseNotesFile: existsSync(releaseNotesPath) ? 'release-notes.json' : undefined,
  };

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  await rm(stagingDir, { recursive: true, force: true });
  console.log(`Created runtime package bundle: ${bundlePath}`);
  console.log(`Created runtime package manifest: ${manifestPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
