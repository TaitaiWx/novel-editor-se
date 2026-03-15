import pkg from 'electron-updater';
import type {
  ProgressInfo,
  UpdateCheckResult,
  UpdateDownloadedEvent,
  UpdateInfo,
} from 'electron-updater';
import { app, BrowserWindow, shell } from 'electron';
import log from 'electron-log/main';
import { chmod, mkdir, readFile, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import { join } from 'path';
import { spawn } from 'child_process';

const { autoUpdater } = pkg;

const UPDATE_REPO = {
  owner: 'TaitaiWx',
  repo: 'novel-editor-se',
};
const HEALTHY_STARTUP_DELAY_MS = 15_000;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_FAILED_UPDATED_LAUNCHES = 2;

export type UpdateChannel = 'stable' | 'beta' | 'canary';

interface RollbackTarget {
  version: string;
  tag: string;
  assetName: string;
  assetUrl: string;
}

interface PersistedUpdaterState {
  channel: UpdateChannel;
  rolloutBucket: number;
  lastKnownGoodVersion: string;
  rollbackTarget: RollbackTarget | null;
  pendingVersion: string | null;
  pendingFromVersion: string | null;
  pendingLaunchAttempts: number;
}

export interface UpdateStatus {
  channel: UpdateChannel;
  channelFile: string;
  currentVersion: string;
  checking: boolean;
  updateReady: boolean;
  availableVersion: string | null;
  downloadedVersion: string | null;
  downloadPercent: number | null;
  channelVersion: string | null;
  rolloutPercentage: number | null;
  rolloutBucket: number;
  rolloutEligible: boolean | null;
  rollbackAvailable: boolean;
  rollbackVersion: string | null;
  pendingVersion: string | null;
  lastError: string | null;
}

interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  assets: GithubReleaseAsset[];
}

let updaterState: PersistedUpdaterState | null = null;
let updaterStatus: UpdateStatus = {
  channel: inferDefaultChannel(app.getVersion()),
  channelFile: getChannelMetadataFile(inferDefaultChannel(app.getVersion())),
  currentVersion: app.getVersion(),
  checking: false,
  updateReady: false,
  availableVersion: null,
  downloadedVersion: null,
  downloadPercent: null,
  channelVersion: null,
  rolloutPercentage: null,
  rolloutBucket: 0,
  rolloutEligible: null,
  rollbackAvailable: false,
  rollbackVersion: null,
  pendingVersion: null,
  lastError: null,
};
let startupHealthTimer: NodeJS.Timeout | null = null;
let scheduledUpdateTimer: NodeJS.Timeout | null = null;
let listenersRegistered = false;

function inferDefaultChannel(version: string): UpdateChannel {
  const lowerVersion = version.toLowerCase();
  if (lowerVersion.includes('-alpha.') || lowerVersion.includes('-canary.')) {
    return 'canary';
  }
  if (lowerVersion.includes('-beta.')) {
    return 'beta';
  }
  return 'stable';
}

function mapUpdateChannel(channel: UpdateChannel) {
  switch (channel) {
    case 'stable':
      return 'latest';
    case 'beta':
      return 'beta';
    case 'canary':
      return 'alpha';
  }
}

function getChannelMetadataFile(channel: UpdateChannel) {
  const mappedChannel = mapUpdateChannel(channel);
  const suffix =
    process.platform === 'win32' ? '' : process.platform === 'darwin' ? '-mac' : '-linux';
  return `${mappedChannel}${suffix}.yml`;
}

function getUpdaterStatePath() {
  return join(app.getPath('userData'), 'updater-state.json');
}

function createRolloutBucket() {
  const hash = createHash('sha256').update(app.getPath('userData')).digest('hex');
  return Number.parseInt(hash.slice(0, 8), 16) % 100;
}

async function loadUpdaterState() {
  if (updaterState) {
    return updaterState;
  }

  const initialState: PersistedUpdaterState = {
    channel: inferDefaultChannel(app.getVersion()),
    rolloutBucket: createRolloutBucket(),
    lastKnownGoodVersion: app.getVersion(),
    rollbackTarget: null,
    pendingVersion: null,
    pendingFromVersion: null,
    pendingLaunchAttempts: 0,
  };

  try {
    const content = await readFile(getUpdaterStatePath(), 'utf8');
    const parsed = JSON.parse(content) as Partial<PersistedUpdaterState>;
    updaterState = {
      ...initialState,
      ...parsed,
      channel: parsed.channel ?? initialState.channel,
      rolloutBucket:
        typeof parsed.rolloutBucket === 'number'
          ? parsed.rolloutBucket
          : initialState.rolloutBucket,
      lastKnownGoodVersion: parsed.lastKnownGoodVersion ?? initialState.lastKnownGoodVersion,
      rollbackTarget: parsed.rollbackTarget ?? null,
      pendingVersion: parsed.pendingVersion ?? null,
      pendingFromVersion: parsed.pendingFromVersion ?? null,
      pendingLaunchAttempts: parsed.pendingLaunchAttempts ?? 0,
    };
  } catch {
    updaterState = initialState;
    await persistUpdaterState();
  }

  updaterStatus.channel = updaterState.channel;
  updaterStatus.channelFile = getChannelMetadataFile(updaterState.channel);
  updaterStatus.rolloutBucket = updaterState.rolloutBucket;
  updaterStatus.rollbackAvailable = Boolean(updaterState.rollbackTarget);
  updaterStatus.rollbackVersion = updaterState.rollbackTarget?.version ?? null;
  updaterStatus.pendingVersion = updaterState.pendingVersion;
  return updaterState;
}

async function persistUpdaterState() {
  if (!updaterState) {
    return;
  }

  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(getUpdaterStatePath(), JSON.stringify(updaterState, null, 2), 'utf8');
}

function broadcast(channel: string, payload?: unknown) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}

function emitStatus() {
  broadcast('update-state-changed', updaterStatus);
  if (updaterStatus.rollbackAvailable) {
    broadcast('update-rollback-available', updaterStatus);
  }
}

async function syncStatusFromUpdateInfo(updateInfo: UpdateInfo | null, channel: UpdateChannel) {
  const state = await loadUpdaterState();
  updaterStatus.channel = state.channel;
  updaterStatus.channelFile = getChannelMetadataFile(channel);
  updaterStatus.currentVersion = app.getVersion();
  updaterStatus.channelVersion = updateInfo?.version ?? null;
  updaterStatus.rolloutPercentage = updateInfo?.stagingPercentage ?? null;
  updaterStatus.rolloutEligible =
    typeof updateInfo?.stagingPercentage === 'number'
      ? state.rolloutBucket < updateInfo.stagingPercentage
      : null;
  updaterStatus.rollbackAvailable = Boolean(state.rollbackTarget);
  updaterStatus.rollbackVersion = state.rollbackTarget?.version ?? null;
  updaterStatus.pendingVersion = state.pendingVersion;
}

function configureAutoUpdater(channel: UpdateChannel) {
  const mappedChannel = mapUpdateChannel(channel);
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = mappedChannel !== 'latest';
  autoUpdater.allowDowngrade = true;
  autoUpdater.channel = mappedChannel;
}

function isPreferredAssetName(name: string) {
  const lowerName = name.toLowerCase();
  if (
    lowerName.endsWith('.blockmap') ||
    lowerName.endsWith('.yml') ||
    lowerName.endsWith('.yaml')
  ) {
    return false;
  }

  if (process.platform === 'darwin') {
    return lowerName.endsWith('.dmg') || lowerName.endsWith('.zip');
  }

  if (process.platform === 'win32') {
    return lowerName.endsWith('.exe') || lowerName.endsWith('.msi');
  }

  return (
    lowerName.endsWith('.appimage') || lowerName.endsWith('.deb') || lowerName.endsWith('.rpm')
  );
}

function scoreReleaseAsset(name: string) {
  const lowerName = name.toLowerCase();
  const matchesArch = lowerName.includes(process.arch);
  let score = matchesArch ? 100 : 0;

  if (process.platform === 'darwin' && lowerName.endsWith('.dmg')) score += 20;
  if (process.platform === 'win32' && lowerName.endsWith('.exe')) score += 20;
  if (process.platform === 'linux' && lowerName.endsWith('.appimage')) score += 20;

  return score;
}

function configureUpdaterLogger() {
  log.initialize();
  log.transports.file.level = 'info';
  autoUpdater.logger = log;
}

async function resolveRollbackTarget(version: string) {
  const response = await fetch(
    `https://api.github.com/repos/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/releases/tags/v${version}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Novel-Editor-Updater',
      },
      signal: AbortSignal.timeout(8000),
    }
  );

  if (!response.ok) {
    throw new Error(`无法解析回退版本 ${version} 的发布信息`);
  }

  const release = (await response.json()) as GithubRelease;
  const selectedAsset = release.assets
    .filter((asset) => isPreferredAssetName(asset.name))
    .sort((left, right) => scoreReleaseAsset(right.name) - scoreReleaseAsset(left.name))[0];

  if (!selectedAsset) {
    throw new Error(`未找到适用于当前平台的回退安装包: ${version}`);
  }

  return {
    version,
    tag: release.tag_name,
    assetName: selectedAsset.name,
    assetUrl: selectedAsset.browser_download_url,
  } satisfies RollbackTarget;
}

async function downloadRollbackAsset(target: RollbackTarget) {
  const rollbackDir = join(app.getPath('userData'), 'rollback-cache');
  await mkdir(rollbackDir, { recursive: true });

  const filePath = join(rollbackDir, target.assetName);
  const response = await fetch(target.assetUrl, {
    headers: {
      'User-Agent': 'Novel-Editor-Updater',
    },
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`下载回退包失败: ${target.assetName}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await writeFile(filePath, Buffer.from(arrayBuffer));
  return filePath;
}

async function openRollbackInstaller(filePath: string) {
  if (process.platform === 'linux' && filePath.toLowerCase().endsWith('.appimage')) {
    await chmod(filePath, 0o755);
    const child = spawn(filePath, [], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return;
  }

  const errorMessage = await shell.openPath(filePath);
  if (errorMessage) {
    throw new Error(errorMessage);
  }
}

async function markVersionHealthy() {
  const state = await loadUpdaterState();
  state.lastKnownGoodVersion = app.getVersion();
  state.pendingLaunchAttempts = 0;

  if (state.pendingVersion === app.getVersion()) {
    state.pendingVersion = null;
    state.pendingFromVersion = null;
  }

  await persistUpdaterState();
  updaterStatus.rollbackAvailable = Boolean(state.rollbackTarget);
  updaterStatus.rollbackVersion = state.rollbackTarget?.version ?? null;
  updaterStatus.pendingVersion = null;
  emitStatus();
}

function armHealthyStartupTimer() {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (!mainWindow) {
    return;
  }

  const scheduleHealthyMark = () => {
    if (startupHealthTimer) {
      clearTimeout(startupHealthTimer);
    }

    startupHealthTimer = setTimeout(() => {
      void markVersionHealthy().catch((error) => {
        console.error('标记健康启动失败:', error);
      });
    }, HEALTHY_STARTUP_DELAY_MS);
  };

  if (mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once('did-finish-load', scheduleHealthyMark);
    return;
  }

  scheduleHealthyMark();
}

async function trackPendingLaunchState() {
  const state = await loadUpdaterState();
  if (state.pendingVersion === app.getVersion()) {
    state.pendingLaunchAttempts += 1;
    await persistUpdaterState();

    if (state.pendingLaunchAttempts >= MAX_FAILED_UPDATED_LAUNCHES && state.rollbackTarget) {
      updaterStatus.rollbackAvailable = true;
      updaterStatus.rollbackVersion = state.rollbackTarget.version;
      updaterStatus.lastError = `新版本 ${app.getVersion()} 连续启动异常，已保留回退到 ${state.rollbackTarget.version} 的能力`;
    }
  } else {
    state.pendingLaunchAttempts = 0;
    await persistUpdaterState();
  }
}

function handleUpdateAvailable(info: UpdateInfo) {
  void syncStatusFromUpdateInfo(info, updaterStatus.channel).then(() => {
    updaterStatus.availableVersion = info.version;
    updaterStatus.lastError = null;
    broadcast('update-available', info);
    emitStatus();
  });
}

function handleUpdateNotAvailable(info: UpdateInfo) {
  void syncStatusFromUpdateInfo(info, updaterStatus.channel).then(() => {
    updaterStatus.checking = false;
    updaterStatus.availableVersion = null;
    broadcast('update-not-available', info);
    emitStatus();
  });
}

function handleDownloadProgress(progress: ProgressInfo) {
  updaterStatus.checking = false;
  updaterStatus.downloadPercent = progress.percent;
  broadcast('update-download-progress', progress);
  emitStatus();
}

async function handleUpdateDownloaded(info: UpdateDownloadedEvent) {
  await syncStatusFromUpdateInfo(info, updaterStatus.channel);
  const state = await loadUpdaterState();
  try {
    state.rollbackTarget = await resolveRollbackTarget(app.getVersion());
  } catch (error) {
    log.error('准备回退版本失败:', error);
  }

  state.pendingVersion = info.version;
  state.pendingFromVersion = app.getVersion();
  state.pendingLaunchAttempts = 0;
  await persistUpdaterState();

  updaterStatus.checking = false;
  updaterStatus.updateReady = true;
  updaterStatus.downloadPercent = 100;
  updaterStatus.downloadedVersion = info.version;
  updaterStatus.pendingVersion = info.version;
  updaterStatus.rollbackAvailable = Boolean(state.rollbackTarget);
  updaterStatus.rollbackVersion = state.rollbackTarget?.version ?? null;

  broadcast('update-downloaded', info);
  emitStatus();
}

function registerUpdaterListeners() {
  if (listenersRegistered) {
    return;
  }

  listenersRegistered = true;
  autoUpdater.on('checking-for-update', () => {
    updaterStatus.checking = true;
    updaterStatus.lastError = null;
    emitStatus();
  });
  autoUpdater.on('update-available', handleUpdateAvailable);
  autoUpdater.on('update-not-available', handleUpdateNotAvailable);
  autoUpdater.on('download-progress', handleDownloadProgress);
  autoUpdater.on('update-downloaded', (info) => {
    void handleUpdateDownloaded(info).catch((error) => {
      log.error('处理已下载更新失败:', error);
    });
  });
  autoUpdater.on('error', (error) => {
    updaterStatus.checking = false;
    updaterStatus.lastError = error.message;
    emitStatus();
    log.error('自动更新错误:', error);
  });
}

async function applyUpdateCheckResult(result: UpdateCheckResult | null, channel: UpdateChannel) {
  await syncStatusFromUpdateInfo(result?.updateInfo ?? null, channel);
  emitStatus();
}

export async function getUpdateStatus() {
  const state = await loadUpdaterState();
  updaterStatus.channel = state.channel;
  updaterStatus.channelFile = getChannelMetadataFile(state.channel);
  updaterStatus.currentVersion = app.getVersion();
  updaterStatus.rolloutBucket = state.rolloutBucket;
  updaterStatus.rollbackAvailable = Boolean(state.rollbackTarget);
  updaterStatus.rollbackVersion = state.rollbackTarget?.version ?? null;
  updaterStatus.pendingVersion = state.pendingVersion;
  return updaterStatus;
}

export async function setUpdateChannel(channel: UpdateChannel) {
  const state = await loadUpdaterState();
  state.channel = channel;
  await persistUpdaterState();

  updaterStatus.channel = channel;
  updaterStatus.channelFile = getChannelMetadataFile(channel);
  updaterStatus.lastError = null;
  updaterStatus.updateReady = false;
  updaterStatus.availableVersion = null;
  updaterStatus.downloadedVersion = null;
  updaterStatus.downloadPercent = null;
  updaterStatus.channelVersion = null;
  updaterStatus.rolloutPercentage = null;
  updaterStatus.rolloutEligible = null;

  configureAutoUpdater(channel);
  void checkForUpdatesManually();
  return updaterStatus;
}

export async function checkForUpdatesManually() {
  const state = await loadUpdaterState();
  configureAutoUpdater(state.channel);

  updaterStatus.checking = true;
  updaterStatus.lastError = null;
  emitStatus();

  try {
    const result = await autoUpdater.checkForUpdates();
    await applyUpdateCheckResult(result, state.channel);
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    updaterStatus.checking = false;
    updaterStatus.lastError = `检查更新失败: ${message}`;
    emitStatus();
    log.error('检查更新失败:', error);
  }
}

export async function setupAutoUpdater() {
  configureUpdaterLogger();
  registerUpdaterListeners();
  const state = await loadUpdaterState();

  configureAutoUpdater(state.channel);
  await trackPendingLaunchState();
  await syncStatusFromUpdateInfo(null, state.channel);
  armHealthyStartupTimer();

  if (scheduledUpdateTimer) {
    clearInterval(scheduledUpdateTimer);
  }
  scheduledUpdateTimer = setInterval(() => {
    void checkForUpdatesManually();
  }, UPDATE_CHECK_INTERVAL_MS);

  void checkForUpdatesManually();
}

export async function downloadUpdate() {
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    updaterStatus.lastError = `下载更新失败: ${message}`;
    emitStatus();
    log.error('下载更新失败:', error);
  }
}

export function installUpdate() {
  autoUpdater.quitAndInstall();
}

export async function rollbackToPreviousVersion() {
  const state = await loadUpdaterState();
  if (!state.rollbackTarget) {
    throw new Error('当前没有可用的回退版本');
  }

  const installerPath = await downloadRollbackAsset(state.rollbackTarget);
  await openRollbackInstaller(installerPath);
  return {
    version: state.rollbackTarget.version,
    installerPath,
  };
}
