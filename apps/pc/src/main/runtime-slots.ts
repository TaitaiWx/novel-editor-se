import { app } from 'electron';
import { randomUUID } from 'crypto';
import { access, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import type {
  RuntimeDescriptor,
  RuntimeCopyBootState,
  RuntimeCopyName,
  RuntimeCopyRecord,
  RuntimePackageManifest,
  UpdateChannel,
} from './update-types';
import { applyRuntimeStartupFailure } from './runtime-slot-state';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const RUNTIME_COPY_SCHEMA_VERSION = 1;
export const RUNTIME_API_VERSION = 1;
export const MAX_PENDING_COPY_BOOT_FAILURES = 1;
const AUTO_RECOVERY_ARG_PREFIX = '--novel-editor-runtime-copy-recovery=';
const RUNTIME_COPY_MODULES = ['better-sqlite3'] as const;

let runtimeCopyState: RuntimeCopyBootState | null = null;

function createEmptyCopyRecord(copyName: RuntimeCopyName): RuntimeCopyRecord {
  return {
    copyName,
    version: null,
    runtimeApiVersion: RUNTIME_API_VERSION,
    bundleHash: null,
    bundleSize: null,
    source: null,
    preparedAt: null,
    lastHealthyAt: null,
    failedLaunches: 0,
  };
}

function createInitialRuntimeState(): RuntimeCopyBootState {
  return {
    schemaVersion: RUNTIME_COPY_SCHEMA_VERSION,
    launcherVersion: app.getVersion(),
    channel: inferDefaultChannel(app.getVersion()),
    stableCopy: null,
    pendingCopy: null,
    currentCopy: null,
    lastKnownGoodVersion: null,
    lastError: null,
    copies: {
      a: createEmptyCopyRecord('a'),
      b: createEmptyCopyRecord('b'),
    },
    bootSession: null,
  };
}

export function inferDefaultChannel(version: string): UpdateChannel {
  const lowerVersion = version.toLowerCase();
  if (lowerVersion.includes('-alpha.') || lowerVersion.includes('-canary.')) {
    return 'canary';
  }
  if (lowerVersion.includes('-beta.')) {
    return 'beta';
  }
  return 'stable';
}

export function mapUpdateChannel(channel: UpdateChannel) {
  switch (channel) {
    case 'stable':
      return 'latest';
    case 'beta':
      return 'beta';
    case 'canary':
      return 'alpha';
  }
}

export function getRuntimePackageManifestFileName(
  channel: UpdateChannel,
  platform: NodeJS.Platform = process.platform,
  arch = process.arch
) {
  // 线上产物文件名继续沿用 slot 前缀，避免破坏现有发布源兼容性。
  return `slot-${mapUpdateChannel(channel)}-${platform}-${arch}.json`;
}

export function getRuntimeCopyStatePath() {
  // 本地状态文件名暂时保留旧前缀，避免破坏已发布版本的升级链路。
  return join(app.getPath('userData'), 'runtime-slot-state.json');
}

export function getRuntimeCopiesRootDir() {
  // 运行副本目录先沿用旧目录名，保证历史版本下载的 A/B 运行副本仍可复用。
  return join(app.getPath('userData'), 'runtime-slots');
}

export function getRuntimeCopyRootDir(copyName: RuntimeCopyName) {
  return join(getRuntimeCopiesRootDir(), copyName);
}

export function getRuntimeCopyDistDir(copyName: RuntimeCopyName) {
  return join(getRuntimeCopyRootDir(copyName), 'dist');
}

export function getRuntimeCopyCacheDir() {
  // 缓存目录继续复用旧路径，避免重新下载已有运行包。
  return join(app.getPath('userData'), 'runtime-slot-cache');
}

async function pathExists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function validateRuntimeRoot(rootDir: string) {
  const requiredPaths = [
    join(rootDir, 'dist', 'main-runtime.mjs'),
    join(rootDir, 'dist', 'preload.js'),
    join(rootDir, 'dist', 'index.html'),
    join(rootDir, 'node_modules', 'better-sqlite3'),
  ];

  for (const requiredPath of requiredPaths) {
    if (!(await pathExists(requiredPath))) {
      return false;
    }
  }

  return true;
}

async function persistRuntimeCopyState() {
  if (!runtimeCopyState) {
    return;
  }

  const statePath = getRuntimeCopyStatePath();
  const tmpPath = `${statePath}.tmp`;
  await mkdir(dirname(statePath), { recursive: true });
  // 原子写入版本指针，避免进程在写文件时退出造成状态撕裂
  await writeFile(tmpPath, JSON.stringify(runtimeCopyState, null, 2), 'utf8');
  await rename(tmpPath, statePath);
}

export async function loadRuntimeCopyState() {
  if (runtimeCopyState) {
    return runtimeCopyState;
  }

  const initialState = createInitialRuntimeState();
  try {
    const content = await readFile(getRuntimeCopyStatePath(), 'utf8');
    // 兼容历史版本落盘的 slot 字段，启动后会按新的运行副本字段重新持久化。
    const parsed = JSON.parse(content) as Partial<RuntimeCopyBootState> & {
      stableSlot?: RuntimeCopyName | null;
      pendingSlot?: RuntimeCopyName | null;
      currentSlot?: RuntimeCopyName | null;
      slots?: Record<
        RuntimeCopyName,
        Partial<RuntimeCopyRecord> & {
          slotName?: RuntimeCopyName;
        }
      >;
      bootSession?: Partial<RuntimeCopyBootState['bootSession']> & {
        slotName?: RuntimeCopyName;
      };
    };
    const {
      stableSlot: legacyStableCopy,
      pendingSlot: legacyPendingCopy,
      currentSlot: legacyCurrentCopy,
      slots: legacyCopies,
      bootSession: parsedBootSession,
      ...restParsed
    } = parsed;
    const parsedCopies = parsed.copies ?? legacyCopies;
    runtimeCopyState = {
      ...initialState,
      ...restParsed,
      launcherVersion: app.getVersion(),
      channel: parsed.channel ?? initialState.channel,
      stableCopy: parsed.stableCopy ?? legacyStableCopy ?? initialState.stableCopy,
      pendingCopy: parsed.pendingCopy ?? legacyPendingCopy ?? initialState.pendingCopy,
      currentCopy: parsed.currentCopy ?? legacyCurrentCopy ?? initialState.currentCopy,
      copies: {
        a: {
          ...createEmptyCopyRecord('a'),
          ...(parsedCopies?.a ?? {}),
          copyName: 'a',
        },
        b: {
          ...createEmptyCopyRecord('b'),
          ...(parsedCopies?.b ?? {}),
          copyName: 'b',
        },
      },
      bootSession: parsedBootSession
        ? {
            ...parsedBootSession,
            copyName: parsedBootSession.copyName ?? parsedBootSession.slotName ?? 'a',
            version: parsedBootSession.version ?? '',
            startedAt: parsedBootSession.startedAt ?? new Date().toISOString(),
            healthyAt: parsedBootSession.healthyAt ?? null,
            gracefulExitRequestedAt: parsedBootSession.gracefulExitRequestedAt ?? null,
          }
        : null,
    };
  } catch {
    runtimeCopyState = initialState;
    await persistRuntimeCopyState();
  }

  return runtimeCopyState;
}

function getOtherCopyName(copyName: RuntimeCopyName): RuntimeCopyName {
  return copyName === 'a' ? 'b' : 'a';
}

function createRuntimeDescriptorForDev(): RuntimeDescriptor {
  return {
    version: app.getVersion(),
    channel: inferDefaultChannel(app.getVersion()),
    runtimeApiVersion: RUNTIME_API_VERSION,
    rootDir: join(__dirname, '..'),
    distDir: __dirname,
    source: 'dev',
    copyName: 'embedded',
  };
}

function getEmbeddedRuntimeRootDir() {
  return app.isPackaged ? app.getAppPath() : join(__dirname, '..');
}

function getEmbeddedReleaseNotesPath() {
  const candidates = [
    join(getEmbeddedRuntimeRootDir(), 'release-notes.json'),
    join(process.resourcesPath, 'release-notes.json'),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function seedEmbeddedRuntimeToCopy(copyName: RuntimeCopyName, channel: UpdateChannel) {
  const sourceRoot = getEmbeddedRuntimeRootDir();
  const targetRoot = getRuntimeCopyRootDir(copyName);
  const stagingRoot = `${targetRoot}.staging-${Date.now()}-${randomUUID()}`;

  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });

  // 运行副本必须自包含，不能依赖 app.asar 内部路径解析。
  await cp(join(sourceRoot, 'dist'), join(stagingRoot, 'dist'), {
    recursive: true,
    dereference: true,
  });

  for (const packageName of RUNTIME_COPY_MODULES) {
    await cp(
      join(sourceRoot, 'node_modules', packageName),
      join(stagingRoot, 'node_modules', packageName),
      {
        recursive: true,
        dereference: true,
      }
    );
  }

  const releaseNotesPath = getEmbeddedReleaseNotesPath();
  if (releaseNotesPath) {
    await cp(releaseNotesPath, join(stagingRoot, 'release-notes.json'), {
      dereference: true,
      force: true,
    });
  }

  if (!(await validateRuntimeRoot(stagingRoot))) {
    throw new Error('内置运行时不完整，无法初始化稳定运行副本');
  }

  await rm(targetRoot, { recursive: true, force: true });
  await rename(stagingRoot, targetRoot);

  const state = await loadRuntimeCopyState();
  state.copies[copyName] = {
    copyName,
    version: app.getVersion(),
    runtimeApiVersion: RUNTIME_API_VERSION,
    bundleHash: null,
    bundleSize: null,
    source: 'embedded',
    preparedAt: new Date().toISOString(),
    lastHealthyAt: null,
    failedLaunches: 0,
  };
  state.stableCopy = copyName;
  state.pendingCopy = null;
  state.currentCopy = null;
  state.channel = channel;
  state.lastKnownGoodVersion = app.getVersion();
  state.lastError = null;
  await persistRuntimeCopyState();
}

async function ensureStableCopyReady(state: RuntimeCopyBootState) {
  const stableCopy = state.stableCopy;
  if (stableCopy && (await validateRuntimeRoot(getRuntimeCopyRootDir(stableCopy)))) {
    return;
  }

  const candidateCopy = stableCopy ? getOtherCopyName(stableCopy) : 'a';
  if (await validateRuntimeRoot(getRuntimeCopyRootDir(candidateCopy))) {
    state.stableCopy = candidateCopy;
    state.lastKnownGoodVersion = state.copies[candidateCopy].version;
    state.pendingCopy = null;
    state.currentCopy = null;
    state.lastError = `稳定运行副本缺失，已回落到运行副本 ${candidateCopy.toUpperCase()}`;
    await persistRuntimeCopyState();
    return;
  }

  await seedEmbeddedRuntimeToCopy('a', state.channel);
}

async function reconcilePreviousBootSession(state: RuntimeCopyBootState) {
  const previousSession = state.bootSession;
  if (!previousSession || previousSession.healthyAt) {
    return;
  }

  if (previousSession.gracefulExitRequestedAt) {
    state.bootSession = null;
    await persistRuntimeCopyState();
    return;
  }

  const resolution = applyRuntimeStartupFailure(state, {
    failedCopy: previousSession.copyName,
    reason: '上次启动未完成健康提交',
    maxPendingCopyBootFailures: MAX_PENDING_COPY_BOOT_FAILURES,
  });
  runtimeCopyState = resolution.nextState;
  await persistRuntimeCopyState();
}

function buildCopyDescriptor(
  state: RuntimeCopyBootState,
  copyName: RuntimeCopyName
): RuntimeDescriptor {
  const copyRecord = state.copies[copyName];
  if (!copyRecord.version) {
    throw new Error(`运行副本 ${copyName.toUpperCase()} 缺少版本信息，无法启动`);
  }

  return {
    version: copyRecord.version,
    channel: state.channel,
    runtimeApiVersion: copyRecord.runtimeApiVersion || RUNTIME_API_VERSION,
    rootDir: getRuntimeCopyRootDir(copyName),
    distDir: getRuntimeCopyDistDir(copyName),
    source: copyRecord.source ?? 'downloaded',
    copyName,
  };
}

export async function prepareRuntimeLaunch(): Promise<RuntimeDescriptor> {
  if (!app.isPackaged) {
    return createRuntimeDescriptorForDev();
  }

  const state = await loadRuntimeCopyState();
  await ensureStableCopyReady(state);
  await reconcilePreviousBootSession(state);

  const preferredCopy = state.pendingCopy ?? state.stableCopy;
  if (!preferredCopy) {
    throw new Error('未找到可用的运行副本');
  }

  if (!(await validateRuntimeRoot(getRuntimeCopyRootDir(preferredCopy)))) {
    if (preferredCopy === state.pendingCopy) {
      state.pendingCopy = null;
      await persistRuntimeCopyState();
      return prepareRuntimeLaunch();
    }

    await seedEmbeddedRuntimeToCopy(preferredCopy, state.channel);
  }

  const descriptor = buildCopyDescriptor(state, preferredCopy);
  state.currentCopy = preferredCopy;
  state.bootSession = {
    copyName: preferredCopy,
    version: descriptor.version,
    startedAt: new Date().toISOString(),
    healthyAt: null,
    gracefulExitRequestedAt: null,
  };
  await persistRuntimeCopyState();
  return descriptor;
}

export async function markCurrentRuntimeHealthy() {
  if (!app.isPackaged) {
    return;
  }

  const state = await loadRuntimeCopyState();
  const currentCopy = state.currentCopy;
  if (!currentCopy) {
    return;
  }

  const now = new Date().toISOString();
  state.copies[currentCopy].failedLaunches = 0;
  state.copies[currentCopy].lastHealthyAt = now;
  state.stableCopy = currentCopy;
  if (state.pendingCopy === currentCopy) {
    state.pendingCopy = null;
  }
  state.lastKnownGoodVersion = state.copies[currentCopy].version;
  state.lastError = null;
  state.bootSession = null;
  await persistRuntimeCopyState();
}

export async function markRuntimeGracefulExit() {
  if (!app.isPackaged) {
    return;
  }

  const state = await loadRuntimeCopyState();
  if (state.bootSession && !state.bootSession.healthyAt) {
    state.bootSession.gracefulExitRequestedAt = new Date().toISOString();
    await persistRuntimeCopyState();
  }
}

async function extractZipArchive(archivePath: string, targetDir: string) {
  await mkdir(targetDir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    let command = '';
    let args: string[] = [];

    if (process.platform === 'darwin') {
      command = 'ditto';
      args = ['-x', '-k', archivePath, targetDir];
    } else if (process.platform === 'win32') {
      command = 'powershell';
      args = [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${targetDir.replace(/'/g, "''")}' -Force`,
      ];
    } else {
      command = 'unzip';
      args = ['-oq', archivePath, '-d', targetDir];
    }

    const child = spawn(command, args, { stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`解压运行包失败: ${command} exited with code ${code ?? 'unknown'}`));
    });
  });
}

export async function installManifestToInactiveCopy(
  manifest: RuntimePackageManifest,
  bundlePath: string
) {
  const state = await loadRuntimeCopyState();
  await ensureStableCopyReady(state);

  const activeCopy = state.currentCopy ?? state.stableCopy ?? 'a';
  const targetCopy = getOtherCopyName(activeCopy);
  const targetRoot = getRuntimeCopyRootDir(targetCopy);
  const stagingRoot = `${targetRoot}.staging-${Date.now()}-${randomUUID()}`;

  await rm(stagingRoot, { recursive: true, force: true });
  await extractZipArchive(bundlePath, stagingRoot);

  if (!(await validateRuntimeRoot(stagingRoot))) {
    throw new Error('下载的运行包缺少关键运行时文件');
  }

  await rm(targetRoot, { recursive: true, force: true });
  await rename(stagingRoot, targetRoot);

  const bundleStat = await stat(bundlePath);
  state.copies[targetCopy] = {
    copyName: targetCopy,
    version: manifest.version,
    runtimeApiVersion: manifest.runtimeApiVersion,
    bundleHash: manifest.sha256,
    bundleSize: manifest.size || bundleStat.size,
    source: 'downloaded',
    preparedAt: new Date().toISOString(),
    lastHealthyAt:
      state.copies[targetCopy].version === manifest.version
        ? state.copies[targetCopy].lastHealthyAt
        : null,
    failedLaunches: 0,
  };
  state.pendingCopy = targetCopy;
  state.lastError = null;
  await persistRuntimeCopyState();

  return { copyName: targetCopy, version: manifest.version };
}

function pickPreviousHealthyCopy(state: RuntimeCopyBootState): RuntimeCopyName | null {
  const currentCopy = state.currentCopy ?? state.stableCopy;
  const preferred = currentCopy ? getOtherCopyName(currentCopy) : 'a';
  const candidates: RuntimeCopyName[] = [preferred, getOtherCopyName(preferred)];

  for (const candidate of candidates) {
    const record = state.copies[candidate];
    if (record.version && record.lastHealthyAt) {
      return candidate;
    }
  }

  return null;
}

export async function switchToPreviousHealthyCopy() {
  const state = await loadRuntimeCopyState();
  const previousHealthyCopy = pickPreviousHealthyCopy(state);
  if (!previousHealthyCopy) {
    throw new Error('当前没有可恢复的健康运行副本');
  }

  state.pendingCopy = null;
  state.currentCopy = previousHealthyCopy;
  state.stableCopy = previousHealthyCopy;
  state.lastKnownGoodVersion = state.copies[previousHealthyCopy].version;
  state.lastError = `已切换到运行副本 ${previousHealthyCopy.toUpperCase()} (${state.copies[previousHealthyCopy].version ?? '未知版本'})`;
  state.bootSession = null;
  await persistRuntimeCopyState();

  return {
    copyName: previousHealthyCopy,
    version: state.copies[previousHealthyCopy].version ?? '未知版本',
  };
}

export function hasAutoRecoveryAttemptFlag(args: string[] = process.argv.slice(1)) {
  return args.some((arg) => arg.startsWith(AUTO_RECOVERY_ARG_PREFIX));
}

export function getLauncherArgsWithoutRecoveryFlag(args: string[] = process.argv.slice(1)) {
  return args.filter((arg) => !arg.startsWith(AUTO_RECOVERY_ARG_PREFIX));
}

export function buildAutoRecoveryLaunchArgs(args: string[] = process.argv.slice(1)) {
  return [...getLauncherArgsWithoutRecoveryFlag(args), `${AUTO_RECOVERY_ARG_PREFIX}${Date.now()}`];
}

export async function handleRuntimeStartupFailure(reason: string) {
  if (!app.isPackaged) {
    return {
      failedCopy: null,
      fallbackCopy: null,
      shouldRelaunch: false,
      message: reason,
    };
  }

  const state = await loadRuntimeCopyState();
  const failedCopy = state.bootSession?.copyName ?? state.currentCopy;
  if (!failedCopy) {
    state.lastError = `启动失败：${reason}`;
    await persistRuntimeCopyState();
    return {
      failedCopy: null,
      fallbackCopy: null,
      shouldRelaunch: false,
      message: state.lastError,
    };
  }

  const resolution = applyRuntimeStartupFailure(state, {
    failedCopy,
    reason,
    maxPendingCopyBootFailures: MAX_PENDING_COPY_BOOT_FAILURES,
  });
  runtimeCopyState = resolution.nextState;
  await persistRuntimeCopyState();
  return {
    failedCopy,
    fallbackCopy: resolution.fallbackCopy,
    shouldRelaunch: resolution.shouldRelaunch,
    message: resolution.message,
  };
}

export async function getRuntimeBootStateSnapshot() {
  return loadRuntimeCopyState();
}

export async function setRuntimeUpdateChannel(channel: UpdateChannel) {
  const state = await loadRuntimeCopyState();
  state.channel = channel;
  await persistRuntimeCopyState();
  return state;
}

export async function getPreviousHealthyVersionCandidate() {
  const state = await loadRuntimeCopyState();
  const previousHealthyCopy = pickPreviousHealthyCopy(state);
  if (!previousHealthyCopy) {
    return null;
  }

  return {
    copyName: previousHealthyCopy,
    version: state.copies[previousHealthyCopy].version,
  };
}
