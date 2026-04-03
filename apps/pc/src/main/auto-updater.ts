import { app, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { createHash } from 'crypto';
import { join } from 'path';
import { download } from './resilient-downloader';
import { getDeviceId } from './device-id';
import {
  RUNTIME_API_VERSION,
  buildAutoRecoveryLaunchArgs,
  getLauncherArgsWithoutRecoveryFlag,
  getPreviousHealthyVersionCandidate,
  getRuntimeCopyCacheDir,
  getRuntimePackageManifestFileName,
  handleRuntimeStartupFailure,
  hasAutoRecoveryAttemptFlag,
  installManifestToInactiveCopy,
  loadRuntimeCopyState,
  markCurrentRuntimeHealthy,
  setRuntimeUpdateChannel,
  switchToPreviousHealthyCopy,
} from './runtime-copies';
import { getCurrentRuntimeChannel, getCurrentRuntimeVersion } from './runtime-context';
import { getMainWindow } from './window';
import type { RuntimePackageManifest, UpdateChannel } from './update-types';

const MIRROR_UPDATE_URL = 'https://dl.wayintech.net/novel-editor/latest';
const HEALTHY_STARTUP_DELAY_MS = 15_000;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;
const CHECK_JITTER_MS = 30 * 60 * 1000;
const MANIFEST_TIMEOUT_MS = 8_000;
const MAX_DOWNLOAD_RETRIES = 3;

export interface UpdateStatus {
  channel: UpdateChannel;
  channelFile: string;
  currentVersion: string;
  checking: boolean;
  updateReady: boolean;
  availableVersion: string | null;
  downloadedVersion: string | null;
  downloadPercent: number | null;
  previousVersionAvailable: boolean;
  previousVersion: string | null;
  /** 下载完成后正在安装到非活动运行副本 */
  preparingCopy: boolean;
  lastError: string | null;
}

const updaterStatus: UpdateStatus = {
  channel: getCurrentRuntimeChannel(),
  channelFile: getRuntimePackageManifestFileName(getCurrentRuntimeChannel()),
  currentVersion: getCurrentRuntimeVersion(),
  checking: false,
  updateReady: false,
  availableVersion: null,
  downloadedVersion: null,
  downloadPercent: null,
  previousVersionAvailable: false,
  previousVersion: null,
  preparingCopy: false,
  lastError: null,
};

let scheduledUpdateTimer: NodeJS.Timeout | null = null;
let startupHealthTimer: NodeJS.Timeout | null = null;
let checkInFlight = false;
let downloadInFlight = false;
let consecutiveCheckFailures = 0;
let pendingManifest: RuntimePackageManifest | null = null;
let downloadedBundlePath: string | null = null;
let startupHealthCommitted = false;
let startupRecoveryInFlight = false;

function broadcast(channel: string, payload?: unknown) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

async function syncPreviousVersionStatus() {
  const previousHealthyVersion = await getPreviousHealthyVersionCandidate();
  updaterStatus.previousVersionAvailable = Boolean(previousHealthyVersion?.version);
  updaterStatus.previousVersion = previousHealthyVersion?.version ?? null;
}

async function emitStatus() {
  updaterStatus.channel = getCurrentRuntimeChannel();
  updaterStatus.channelFile = getRuntimePackageManifestFileName(updaterStatus.channel);
  updaterStatus.currentVersion = getCurrentRuntimeVersion();
  await syncPreviousVersionStatus();
  broadcast('update-state-changed', updaterStatus);
  if (updaterStatus.previousVersionAvailable) {
    broadcast('update-previous-version-available', updaterStatus);
  }
}

function parseVersion(version: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u.exec(
    version.trim()
  );
  if (!match) {
    return null;
  }

  const [, major, minor, patch, prerelease] = match;
  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
    prerelease: prerelease ? prerelease.split('.') : [],
  };
}

function compareIdentifiers(left: string, right: string) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const leftIsNumber = Number.isInteger(leftNumber) && `${leftNumber}` === left;
  const rightIsNumber = Number.isInteger(rightNumber) && `${rightNumber}` === right;

  if (leftIsNumber && rightIsNumber) {
    return leftNumber - rightNumber;
  }
  if (leftIsNumber) return -1;
  if (rightIsNumber) return 1;
  return left.localeCompare(right);
}

function compareVersions(leftVersion: string, rightVersion: string) {
  const left = parseVersion(leftVersion);
  const right = parseVersion(rightVersion);
  if (!left || !right) {
    return leftVersion.localeCompare(rightVersion);
  }

  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;

  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const diff = compareIdentifiers(leftPart, rightPart);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

function createRolloutBucket() {
  const hash = createHash('sha256').update(app.getPath('userData')).digest('hex');
  return Number.parseInt(hash.slice(0, 8), 16) % 100;
}

function isManifestEligible(manifest: RuntimePackageManifest) {
  const percentage = Math.max(1, Math.min(manifest.stagingPercentage ?? 100, 100));
  return createRolloutBucket() < percentage;
}

function getManifestUrl(channel: UpdateChannel) {
  return `${MIRROR_UPDATE_URL}/${getRuntimePackageManifestFileName(channel)}?t=${Date.now()}`;
}

async function fetchRuntimePackageManifest(channel: UpdateChannel) {
  const response = await fetch(getManifestUrl(channel), {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Novel-Editor-Runtime-Updater',
    },
    signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`获取运行包清单失败: HTTP ${response.status}`);
  }

  const manifest = (await response.json()) as RuntimePackageManifest;
  if (manifest.runtimeApiVersion > RUNTIME_API_VERSION) {
    throw new Error('当前启动器版本过旧，无法加载新的运行时协议');
  }
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) {
    throw new Error(`运行包清单平台不匹配: ${manifest.platform}/${manifest.arch}`);
  }
  return manifest;
}

function buildBundleUrl(manifest: RuntimePackageManifest) {
  return `${MIRROR_UPDATE_URL}/${manifest.bundleFile}`;
}

function getBundleCachePath(manifest: RuntimePackageManifest) {
  return join(getRuntimeCopyCacheDir(), manifest.bundleFile);
}

async function scheduleBackoffCheck() {
  consecutiveCheckFailures += 1;
  const backoffMs = Math.min(60_000 * Math.pow(2, consecutiveCheckFailures - 1), MAX_BACKOFF_MS);
  log.info(`将在 ${Math.round(backoffMs / 1000)}s 后重试检查运行时更新`);
  setTimeout(() => {
    void checkForUpdatesManually();
  }, backoffMs);
}

function resetDownloadState() {
  updaterStatus.downloadPercent = null;
  updaterStatus.preparingCopy = false;
}

function handleManifestNotAvailable(manifest: RuntimePackageManifest | null) {
  updaterStatus.checking = false;
  updaterStatus.updateReady = false;
  updaterStatus.availableVersion = null;
  updaterStatus.downloadedVersion = null;
  resetDownloadState();
  pendingManifest = null;
  downloadedBundlePath = null;
  broadcast('update-not-available', manifest);
}

function armHealthyStartupTimer() {
  const mainWindow = getMainWindow();
  if (!mainWindow) {
    return;
  }

  const recoverFromStartupFailure = async (reason: string) => {
    if (!app.isPackaged || startupHealthCommitted || startupRecoveryInFlight) {
      return;
    }

    startupRecoveryInFlight = true;
    try {
      const resolution = await handleRuntimeStartupFailure(reason);
      updaterStatus.lastError = resolution.message;
      await emitStatus();
      if (!resolution.shouldRelaunch) {
        return;
      }
      if (hasAutoRecoveryAttemptFlag()) {
        log.error(`启动异常后已处于自动恢复链路中，停止再次 relaunch: ${reason}`);
        return;
      }
      log.error(`启动阶段检测到异常，准备自动回退并重启: ${reason}`);
      app.relaunch({ args: buildAutoRecoveryLaunchArgs() });
      app.exit(0);
    } finally {
      startupRecoveryInFlight = false;
    }
  };

  const handleRenderGone = (_event: Electron.Event, details: Electron.RenderProcessGoneDetails) => {
    void recoverFromStartupFailure(`渲染进程退出：${details.reason}`);
  };

  const handleDidFailLoad = (
    _event: Electron.Event,
    errorCode: number,
    errorDescription: string,
    _validatedUrl: string,
    isMainFrame: boolean
  ) => {
    if (!isMainFrame) {
      return;
    }
    void recoverFromStartupFailure(`主窗口加载失败(${errorCode})：${errorDescription}`);
  };

  const detachStartupFailureObservers = () => {
    mainWindow.webContents.removeListener('render-process-gone', handleRenderGone);
    mainWindow.webContents.removeListener('did-fail-load', handleDidFailLoad);
  };

  mainWindow.webContents.on('render-process-gone', handleRenderGone);
  mainWindow.webContents.on('did-fail-load', handleDidFailLoad);

  const scheduleHealthyMark = () => {
    if (startupHealthTimer) {
      clearTimeout(startupHealthTimer);
    }

    startupHealthTimer = setTimeout(async () => {
      const targetWindow = getMainWindow();
      if (!targetWindow || targetWindow.isDestroyed() || targetWindow.webContents.isCrashed()) {
        log.warn('启动健康检查失败：主窗口不可用或渲染进程已崩溃');
        return;
      }

      try {
        await markCurrentRuntimeHealthy();
        startupHealthCommitted = true;
        detachStartupFailureObservers();
        await syncPreviousVersionStatus();
        await emitStatus();
      } catch (error) {
        log.error('提交稳定运行副本指针失败:', error);
      }
    }, HEALTHY_STARTUP_DELAY_MS);
  };

  if (mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once('did-finish-load', scheduleHealthyMark);
    return;
  }

  scheduleHealthyMark();
}

export async function getUpdateStatus() {
  await loadRuntimeCopyState();
  await emitStatus();
  return updaterStatus;
}

export async function setUpdateChannel(channel: UpdateChannel) {
  await setRuntimeUpdateChannel(channel);
  updaterStatus.channel = channel;
  updaterStatus.channelFile = getRuntimePackageManifestFileName(channel);
  updaterStatus.lastError = null;
  updaterStatus.updateReady = false;
  updaterStatus.availableVersion = null;
  updaterStatus.downloadedVersion = null;
  resetDownloadState();
  pendingManifest = null;
  downloadedBundlePath = null;
  await emitStatus();
  void checkForUpdatesManually();
  return updaterStatus;
}

export async function checkForUpdatesManually() {
  if (checkInFlight) {
    return;
  }

  if (!app.isPackaged) {
    updaterStatus.checking = false;
    updaterStatus.lastError = '开发模式下不支持检查更新';
    await emitStatus();
    return;
  }

  const state = await loadRuntimeCopyState();
  updaterStatus.checking = true;
  updaterStatus.lastError = null;
  updaterStatus.channel = state.channel;
  updaterStatus.channelFile = getRuntimePackageManifestFileName(state.channel);
  await emitStatus();

  checkInFlight = true;
  try {
    const manifest = await fetchRuntimePackageManifest(state.channel);
    consecutiveCheckFailures = 0;

    if (!isManifestEligible(manifest)) {
      handleManifestNotAvailable(manifest);
      await emitStatus();
      return;
    }

    if (compareVersions(manifest.version, getCurrentRuntimeVersion()) <= 0) {
      handleManifestNotAvailable(manifest);
      await emitStatus();
      return;
    }

    pendingManifest = manifest;
    updaterStatus.checking = false;
    updaterStatus.availableVersion = manifest.version;
    updaterStatus.lastError = null;
    broadcast('update-available', manifest);
    await emitStatus();
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    updaterStatus.checking = false;
    updaterStatus.lastError = `检查更新失败: ${message}`;
    log.error('检查运行时更新失败:', error);
    await emitStatus();
    await scheduleBackoffCheck();
  } finally {
    checkInFlight = false;
  }
}

export async function setupAutoUpdater() {
  log.initialize();
  log.transports.file.level = 'info';
  startupHealthCommitted = false;
  startupRecoveryInFlight = false;

  updaterStatus.channel = getCurrentRuntimeChannel();
  updaterStatus.channelFile = getRuntimePackageManifestFileName(updaterStatus.channel);
  updaterStatus.currentVersion = getCurrentRuntimeVersion();
  updaterStatus.lastError = null;
  await syncPreviousVersionStatus();
  await emitStatus();
  armHealthyStartupTimer();

  if (scheduledUpdateTimer) {
    clearInterval(scheduledUpdateTimer);
  }
  const jitter = Math.floor(Math.random() * CHECK_JITTER_MS);
  scheduledUpdateTimer = setInterval(() => {
    void checkForUpdatesManually();
  }, UPDATE_CHECK_INTERVAL_MS + jitter);
  log.info(
    `双运行副本更新检查已启动，间隔: ${Math.round((UPDATE_CHECK_INTERVAL_MS + jitter) / 60000)}min`
  );

  void checkForUpdatesManually();
}

export async function downloadUpdate() {
  if (downloadInFlight) {
    return;
  }

  if (!pendingManifest) {
    await checkForUpdatesManually();
  }

  const manifest = pendingManifest;
  if (!manifest) {
    return;
  }

  downloadInFlight = true;
  updaterStatus.lastError = null;
  updaterStatus.preparingCopy = false;
  updaterStatus.downloadPercent = 0;
  await emitStatus();

  try {
    const bundleResult = await download({
      url: buildBundleUrl(manifest),
      destPath: getBundleCachePath(manifest),
      expectedHash: manifest.sha256,
      expectedSize: manifest.size,
      maxRetries: MAX_DOWNLOAD_RETRIES,
      headers: { 'X-Device-Id': getDeviceId() },
      onProgress: (downloadedBytes, totalBytes) => {
        const total = totalBytes || manifest.size || 0;
        updaterStatus.downloadPercent = total > 0 ? (downloadedBytes / total) * 100 : null;
        void emitStatus();
      },
    });

    updaterStatus.preparingCopy = true;
    await emitStatus();

    await installManifestToInactiveCopy(manifest, bundleResult.path);
    downloadedBundlePath = bundleResult.path;
    updaterStatus.checking = false;
    updaterStatus.updateReady = true;
    updaterStatus.availableVersion = manifest.version;
    updaterStatus.downloadedVersion = manifest.version;
    updaterStatus.downloadPercent = 100;
    updaterStatus.preparingCopy = false;
    updaterStatus.lastError = null;
    broadcast('update-downloaded', manifest);
    await emitStatus();
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    updaterStatus.lastError = `下载更新失败: ${message}`;
    updaterStatus.preparingCopy = false;
    log.error('下载运行包失败:', error);
    await emitStatus();
  } finally {
    downloadInFlight = false;
  }
}

export async function installUpdate() {
  if (!updaterStatus.updateReady) {
    throw new Error('当前没有可安装的更新');
  }

  if (!downloadedBundlePath) {
    throw new Error('新版本运行副本尚未准备完成');
  }

  app.relaunch({ args: getLauncherArgsWithoutRecoveryFlag() });
  app.exit(0);
}

export async function restorePreviousHealthyVersion() {
  const restoreInfo = await switchToPreviousHealthyCopy();
  app.relaunch({ args: getLauncherArgsWithoutRecoveryFlag() });
  app.exit(0);
  return {
    version: restoreInfo.version,
    copyName: restoreInfo.copyName,
  };
}
