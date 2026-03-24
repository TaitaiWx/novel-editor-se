import pkg from 'electron-updater';
import type {
  ProgressInfo,
  UpdateCheckResult,
  UpdateDownloadedEvent,
  UpdateInfo,
} from 'electron-updater';
import { app, BrowserWindow, shell } from 'electron';
import log from 'electron-log/main';
import {
  access,
  chmod,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'fs/promises';
import { createHash } from 'crypto';
import { join } from 'path';
import { spawn } from 'child_process';
import { createReadStream } from 'fs';
import { getDeviceId } from './device-id';
import { download, cleanupStaleDownloads } from './resilient-downloader';

const { autoUpdater } = pkg;

const UPDATE_REPO = {
  owner: 'TaitaiWx',
  repo: 'novel-editor-se',
};
const HEALTHY_STARTUP_DELAY_MS = 15_000;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_FAILED_UPDATED_LAUNCHES = 2;
/** 回滚缓存最多保留的安装包数量 */
const MAX_ROLLBACK_CACHE_ENTRIES = 2;
/** 下载回滚安装包的超时（5 分钟，足够覆盖大文件慢网场景） */
const ROLLBACK_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
/** 国内镜像地址（GitHub API 不可达时的备用源） */
const MIRROR_BASE_URL = 'https://dl.wayintech.net/novel-editor/latest';
/** 更新检查失败后的最大退避间隔（30 分钟） */
const MAX_BACKOFF_MS = 30 * 60 * 1000;
/** 更新检查随机抖动范围（0~30 分钟），避免所有客户端同时请求 */
const CHECK_JITTER_MS = 30 * 60 * 1000;
const NETWORK_PROBE_TIMEOUT_MS = 4_000;
const NETWORK_RECOVERY_INTERVAL_MS = 15_000;
const DOWNLOAD_STALL_TIMEOUT_MS = 30_000;

export type UpdateChannel = 'stable' | 'beta' | 'canary';
type RecoveryAction = 'check' | 'download';
type UpdateNetworkPhase = 'online' | 'recovering' | 'offline';

interface RollbackTarget {
  version: string;
  tag: string;
  assetName: string;
  assetUrl: string;
  /** 本地已缓存的安装包路径（高可用核心：回滚不依赖网络） */
  cachedInstallerPath: string | null;
  /** 缓存安装包的 SHA256 摘要，用于完整性校验 */
  cachedInstallerHash: string | null;
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
  networkPhase: UpdateNetworkPhase;
  networkReachable: boolean | null;
  networkCheckedAt: number | null;
  /** 下载完成后正在预缓存当前版本安装包（用于回滚） */
  preCaching: boolean;
  lastError: string | null;
}

interface UpdaterConnectivityState {
  phase: UpdateNetworkPhase;
  reachable: boolean | null;
  lastCheckedAt: number | null;
  lastRecoveredAt: number | null;
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
const updaterStatus: UpdateStatus = {
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
  networkPhase: 'online',
  networkReachable: null,
  networkCheckedAt: null,
  preCaching: false,
  lastError: null,
};
let startupHealthTimer: NodeJS.Timeout | null = null;
let scheduledUpdateTimer: NodeJS.Timeout | null = null;
let recoveryProbeTimer: NodeJS.Timeout | null = null;
let downloadStallTimer: NodeJS.Timeout | null = null;
let listenersRegistered = false;
let consecutiveCheckFailures = 0;
let consecutiveDownloadFailures = 0;
let recoveryProbeInFlight = false;
let pendingRecoveryAction: RecoveryAction | null = null;
let checkInFlight = false;
let downloadInFlight = false;
/** 下载失败后自动重试的上限 */
const MAX_DOWNLOAD_RETRIES = 3;
const connectivityState: UpdaterConnectivityState = {
  phase: 'online',
  reachable: null,
  lastCheckedAt: null,
  lastRecoveredAt: null,
};

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

  const statePath = getUpdaterStatePath();
  const tmpPath = `${statePath}.tmp`;
  await mkdir(app.getPath('userData'), { recursive: true });
  // 原子写入：先写临时文件再 rename，防止崩溃导致 JSON 损坏
  await writeFile(tmpPath, JSON.stringify(updaterState, null, 2), 'utf8');
  await rename(tmpPath, statePath);
}

function broadcast(channel: string, payload?: unknown) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}

function emitStatus() {
  updaterStatus.networkPhase = connectivityState.phase;
  updaterStatus.networkReachable = connectivityState.reachable;
  updaterStatus.networkCheckedAt = connectivityState.lastCheckedAt;
  broadcast('update-state-changed', updaterStatus);
  if (updaterStatus.rollbackAvailable) {
    broadcast('update-rollback-available', updaterStatus);
  }
}

function clearRecoveryProbeTimer() {
  if (recoveryProbeTimer) {
    clearTimeout(recoveryProbeTimer);
    recoveryProbeTimer = null;
  }
}

function clearDownloadStallTimer() {
  if (downloadStallTimer) {
    clearTimeout(downloadStallTimer);
    downloadStallTimer = null;
  }
}

function markConnectivity(phase: UpdateNetworkPhase, reachable: boolean | null) {
  connectivityState.phase = phase;
  connectivityState.reachable = reachable;
  connectivityState.lastCheckedAt = Date.now();
  if (phase === 'online' && reachable) {
    connectivityState.lastRecoveredAt = connectivityState.lastCheckedAt;
  }
  emitStatus();
}

function isLikelyNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /network|net::|socket|timed out|timeout|econn|enotfound|offline|dns|reset|failed to fetch/i.test(
    message
  );
}

async function probeUpdateNetwork(channel: UpdateChannel): Promise<boolean> {
  const probeUrl = `${MIRROR_UPDATE_URL}/${getChannelMetadataFile(channel)}?probe=${Date.now()}`;
  try {
    const response = await fetch(probeUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(NETWORK_PROBE_TIMEOUT_MS),
      cache: 'no-store',
    });
    return response.ok;
  } catch {
    return false;
  }
}

function armDownloadStallWatch() {
  clearDownloadStallTimer();
  if (!updaterStatus.availableVersion || updaterStatus.updateReady) {
    return;
  }
  downloadStallTimer = setTimeout(() => {
    if (!updaterStatus.availableVersion || updaterStatus.updateReady) {
      return;
    }
    updaterStatus.lastError = '更新下载长时间无进展，等待网络恢复后继续';
    emitStatus();
    queueRecovery('download', '下载链路停滞');
  }, DOWNLOAD_STALL_TIMEOUT_MS);
}

async function runRecoveryProbe() {
  if (recoveryProbeInFlight) {
    return;
  }
  recoveryProbeInFlight = true;
  try {
    const reachable = await probeUpdateNetwork(updaterStatus.channel);
    markConnectivity(reachable ? 'online' : 'offline', reachable);
    if (!reachable) {
      recoveryProbeTimer = setTimeout(() => {
        recoveryProbeTimer = null;
        void runRecoveryProbe();
      }, NETWORK_RECOVERY_INTERVAL_MS);
      return;
    }

    clearRecoveryProbeTimer();
    const action = pendingRecoveryAction;
    pendingRecoveryAction = null;
    updaterStatus.lastError = null;
    emitStatus();

    if (action === 'download' && updaterStatus.availableVersion && !updaterStatus.updateReady) {
      void downloadUpdate();
    } else if (action === 'check') {
      void checkForUpdatesManually();
    }
  } finally {
    recoveryProbeInFlight = false;
  }
}

function queueRecovery(action: RecoveryAction, reason: string) {
  pendingRecoveryAction =
    pendingRecoveryAction === 'download' || action === 'download' ? 'download' : action;
  updaterStatus.checking = false;
  updaterStatus.lastError = `${reason}，网络恢复后会自动继续`;
  markConnectivity('recovering', connectivityState.reachable);
  if (!recoveryProbeTimer) {
    recoveryProbeTimer = setTimeout(() => {
      recoveryProbeTimer = null;
      void runRecoveryProbe();
    }, 0);
  }
}

async function shouldRecoverFromNetwork(error: unknown): Promise<boolean> {
  if (isLikelyNetworkError(error)) {
    return true;
  }
  const reachable = await probeUpdateNetwork(updaterStatus.channel);
  markConnectivity(reachable ? 'online' : 'offline', reachable);
  return !reachable;
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

const MIRROR_UPDATE_URL = 'https://dl.wayintech.net/novel-editor/latest';

function configureAutoUpdater(channel: UpdateChannel) {
  const mappedChannel = mapUpdateChannel(channel);
  autoUpdater.autoDownload = true;
  // oneClick: true NSIS 不运行卸载程序，直接覆盖文件，静默安装安全可靠。
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = mappedChannel !== 'latest';
  autoUpdater.allowDowngrade = true;
  autoUpdater.channel = mappedChannel;

  // Use mirror server for update checks — avoids private-repo 404 and works in China
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: MIRROR_UPDATE_URL,
    requestHeaders: { 'X-Device-Id': getDeviceId() },
  });
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
  // 优先尝试 GitHub API
  try {
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

    if (response.ok) {
      const release = (await response.json()) as GithubRelease;
      const selectedAsset = release.assets
        .filter((asset) => isPreferredAssetName(asset.name))
        .sort((left, right) => scoreReleaseAsset(right.name) - scoreReleaseAsset(left.name))[0];

      if (selectedAsset) {
        return {
          version,
          tag: release.tag_name,
          assetName: selectedAsset.name,
          assetUrl: selectedAsset.browser_download_url,
          cachedInstallerPath: null,
          cachedInstallerHash: null,
        } satisfies RollbackTarget;
      }
    }
  } catch (error) {
    log.warn(`GitHub API 不可达，尝试国内镜像: ${error}`);
  }

  // Fallback: 国内镜像 version.json
  return resolveRollbackTargetFromMirror(version);
}

async function resolveRollbackTargetFromMirror(version: string) {
  const assetName = getMirrorShortcutName();
  if (!assetName) {
    throw new Error(`未找到适用于当前平台的回退安装包: ${version}`);
  }

  const mirrorUrl = `${MIRROR_BASE_URL}/${assetName}`;
  // 验证镜像资源是否存在
  const headResp = await fetch(mirrorUrl, {
    method: 'HEAD',
    signal: AbortSignal.timeout(5000),
  });

  if (!headResp.ok) {
    throw new Error(`镜像回退包不可用: ${mirrorUrl} (${headResp.status})`);
  }

  return {
    version,
    tag: `v${version}`,
    assetName,
    assetUrl: mirrorUrl,
    cachedInstallerPath: null,
    cachedInstallerHash: null,
  } satisfies RollbackTarget;
}

/** 根据当前平台和架构返回镜像的快捷文件名 */
function getMirrorShortcutName(): string | null {
  const arch = process.arch;
  if (process.platform === 'darwin') return `mac-${arch}.dmg`;
  if (process.platform === 'win32') return `win-${arch}.exe`;
  if (process.platform === 'linux') return `linux-${arch}.AppImage`;
  return null;
}

function getRollbackCacheDir() {
  return join(app.getPath('userData'), 'rollback-cache');
}

/** 计算文件的 SHA256 摘要 */
async function computeFileHash(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

/** 检查本地缓存的安装包是否存在且完整 */
async function isCachedInstallerValid(
  cachedPath: string | null,
  expectedHash?: string | null
): Promise<boolean> {
  if (!cachedPath) return false;
  try {
    const fileStat = await stat(cachedPath);
    // 文件必须 > 1MB 才算有效安装包（排除损坏的空文件）
    if (fileStat.size <= 1_048_576) return false;
    // 如果有预期的 hash，校验完整性
    if (expectedHash) {
      const actualHash = await computeFileHash(cachedPath);
      if (actualHash !== expectedHash) {
        log.warn(`缓存安装包 hash 不匹配: expected=${expectedHash}, actual=${actualHash}`);
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** 流式下载安装包到本地 — 支持断点续传 + 自动重试 + 弱网恢复 */
async function downloadRollbackAsset(
  target: RollbackTarget
): Promise<{ path: string; hash: string }> {
  const filePath = join(getRollbackCacheDir(), target.assetName);
  const result = await download({
    url: target.assetUrl,
    destPath: filePath,
    timeoutMs: ROLLBACK_DOWNLOAD_TIMEOUT_MS,
    maxRetries: 5,
  });

  log.info(`回退安装包已缓存: ${result.path} (sha256=${result.hash.slice(0, 16)}…)`);
  return { path: result.path, hash: result.hash };
}

/**
 * 在新版本下载完成后，预缓存当前版本的安装包到本地。
 * 这是高可用回滚的核心：确保回滚时不依赖网络。
 */
async function preCacheCurrentVersion(): Promise<RollbackTarget | null> {
  const currentVersion = app.getVersion();
  try {
    const target = await resolveRollbackTarget(currentVersion);

    // 检查是否已有有效缓存
    const existingPath = join(getRollbackCacheDir(), target.assetName);
    if (await isCachedInstallerValid(existingPath)) {
      const hash = await computeFileHash(existingPath);
      log.info(`当前版本 ${currentVersion} 安装包已在缓存中: ${existingPath}`);
      return { ...target, cachedInstallerPath: existingPath, cachedInstallerHash: hash };
    }

    const { path: cachedPath, hash } = await downloadRollbackAsset(target);
    return { ...target, cachedInstallerPath: cachedPath, cachedInstallerHash: hash };
  } catch (error) {
    log.error(`预缓存版本 ${currentVersion} 安装包失败:`, error);
    // 降级：仍保存 URL 信息，回滚时尝试在线下载
    try {
      const target = await resolveRollbackTarget(currentVersion);
      return { ...target, cachedInstallerPath: null, cachedInstallerHash: null };
    } catch {
      return null;
    }
  }
}

/** 清理旧的回滚缓存，只保留最近 N 个版本 */
async function pruneRollbackCache(keepAssetName?: string) {
  const cacheDir = getRollbackCacheDir();
  try {
    await access(cacheDir);
  } catch {
    return;
  }

  const entries = await readdir(cacheDir, { withFileTypes: true });
  const files = entries.filter(
    (e) =>
      e.isFile() &&
      !e.name.endsWith('.download') &&
      !e.name.endsWith('.tmp') &&
      !e.name.endsWith('.part') &&
      !e.name.endsWith('.dl-meta')
  );

  if (files.length <= MAX_ROLLBACK_CACHE_ENTRIES) return;

  // 按修改时间排序，保留最新的
  const fileStats = await Promise.all(
    files.map(async (f) => {
      const fullPath = join(cacheDir, f.name);
      const s = await stat(fullPath);
      return { name: f.name, path: fullPath, mtimeMs: s.mtimeMs };
    })
  );
  fileStats.sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const file of fileStats.slice(MAX_ROLLBACK_CACHE_ENTRIES)) {
    if (file.name === keepAssetName) continue;
    try {
      await unlink(file.path);
      log.info(`已清理旧回滚缓存: ${file.name}`);
    } catch (error) {
      log.warn(`清理回滚缓存失败: ${file.name}`, error);
    }
  }
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

  // 版本确认健康后清理旧缓存
  void pruneRollbackCache(state.rollbackTarget?.assetName).catch((error) => {
    log.warn('清理回滚缓存失败:', error);
  });

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

    startupHealthTimer = setTimeout(async () => {
      // 双重验证：main 进程存活 + renderer 未崩溃
      const win = BrowserWindow.getAllWindows()[0];
      if (!win || win.isDestroyed() || win.webContents.isCrashed()) {
        log.warn('启动健康检测失败: 窗口不可用或渲染进程已崩溃');
        return;
      }

      try {
        await markVersionHealthy();
      } catch (error) {
        log.error('标记健康启动失败:', error);
      }
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
  consecutiveDownloadFailures = 0;
  clearDownloadStallTimer();
  clearRecoveryProbeTimer();
  pendingRecoveryAction = null;
  markConnectivity('online', true);
  void syncStatusFromUpdateInfo(info, updaterStatus.channel).then(() => {
    updaterStatus.availableVersion = info.version;
    updaterStatus.lastError = null;
    broadcast('update-available', info);
    emitStatus();
  });
}

function handleUpdateNotAvailable(info: UpdateInfo) {
  clearDownloadStallTimer();
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
  if (progress.percent > 0) {
    markConnectivity('online', true);
  }
  armDownloadStallWatch();
  broadcast('update-download-progress', progress);
  emitStatus();
}

async function handleUpdateDownloaded(info: UpdateDownloadedEvent) {
  await syncStatusFromUpdateInfo(info, updaterStatus.channel);
  const state = await loadUpdaterState();

  // 核心：在安装新版本前，先把当前版本的安装包缓存到本地
  updaterStatus.preCaching = true;
  updaterStatus.downloadPercent = 100;
  emitStatus();
  const rollbackTarget = await preCacheCurrentVersion();
  if (rollbackTarget) {
    state.rollbackTarget = rollbackTarget;
    if (rollbackTarget.cachedInstallerPath) {
      log.info(`回滚安装包已就绪: ${rollbackTarget.cachedInstallerPath}`);
    } else {
      log.warn('回滚安装包未能缓存到本地，回滚将依赖网络下载');
    }
  } else {
    log.error('无法准备回滚信息，更新后将无法回滚');
  }

  state.pendingVersion = info.version;
  state.pendingFromVersion = app.getVersion();
  state.pendingLaunchAttempts = 0;
  await persistUpdaterState();

  updaterStatus.checking = false;
  updaterStatus.updateReady = true;
  updaterStatus.preCaching = false;
  updaterStatus.downloadPercent = 100;
  updaterStatus.downloadedVersion = info.version;
  updaterStatus.pendingVersion = info.version;
  updaterStatus.rollbackAvailable = Boolean(state.rollbackTarget);
  updaterStatus.rollbackVersion = state.rollbackTarget?.version ?? null;
  clearDownloadStallTimer();
  clearRecoveryProbeTimer();
  pendingRecoveryAction = null;
  markConnectivity('online', true);

  broadcast('update-downloaded', info);
  emitStatus();
}

async function handleUpdaterError(error: Error) {
  updaterStatus.checking = false;
  log.error('自动更新错误:', error);

  const shouldRecover = await shouldRecoverFromNetwork(error);
  if (shouldRecover) {
    clearDownloadStallTimer();
    queueRecovery(
      updaterStatus.availableVersion && !updaterStatus.updateReady ? 'download' : 'check',
      '更新网络暂不可用'
    );
    return;
  }

  updaterStatus.lastError = error.message;
  emitStatus();

  if (updaterStatus.availableVersion && !updaterStatus.updateReady) {
    consecutiveDownloadFailures++;
    if (consecutiveDownloadFailures <= MAX_DOWNLOAD_RETRIES) {
      const delay = Math.min(MAX_BACKOFF_MS, 60_000 * Math.pow(2, consecutiveDownloadFailures - 1));
      const jitter = 0.75 + Math.random() * 0.5;
      const backoffMs = Math.floor(delay * jitter);
      log.info(
        `下载失败，${Math.round(backoffMs / 1000)}s 后重试 ` +
          `(${consecutiveDownloadFailures}/${MAX_DOWNLOAD_RETRIES})`
      );
      setTimeout(() => void downloadUpdate(), backoffMs);
    } else {
      log.warn(`下载连续失败 ${consecutiveDownloadFailures} 次，等待下次定时检查`);
    }
  }
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
    void handleUpdaterError(error);
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
  if (checkInFlight) {
    return;
  }

  // Dev 模式下直接返回，不执行实际检查
  if (!app.isPackaged) {
    updaterStatus.checking = false;
    updaterStatus.lastError = '开发模式下不支持检查更新';
    emitStatus();
    return;
  }

  const state = await loadUpdaterState();
  configureAutoUpdater(state.channel);

  const reachable = await probeUpdateNetwork(state.channel);
  markConnectivity(reachable ? 'online' : 'offline', reachable);
  if (!reachable) {
    queueRecovery('check', '更新源暂不可达');
    return;
  }

  updaterStatus.checking = true;
  updaterStatus.lastError = null;
  emitStatus();

  checkInFlight = true;
  try {
    const result = await autoUpdater.checkForUpdates();
    await applyUpdateCheckResult(result, state.channel);
    consecutiveCheckFailures = 0;
  } catch (error) {
    if (await shouldRecoverFromNetwork(error)) {
      queueRecovery('check', '检查更新时网络异常');
      return;
    }
    consecutiveCheckFailures += 1;
    const message = error instanceof Error ? error.message : '未知错误';
    updaterStatus.checking = false;
    updaterStatus.lastError = `检查更新失败: ${message}`;
    emitStatus();
    log.error(`检查更新失败 (连续第 ${consecutiveCheckFailures} 次):`, error);

    // 指数退避重试：1min → 2min → 4min → ... → 30min 封顶
    const backoffMs = Math.min(60_000 * Math.pow(2, consecutiveCheckFailures - 1), MAX_BACKOFF_MS);
    log.info(`将在 ${Math.round(backoffMs / 1000)}s 后重试检查更新`);
    setTimeout(() => void checkForUpdatesManually(), backoffMs);
  } finally {
    checkInFlight = false;
  }
}

export async function setupAutoUpdater() {
  configureUpdaterLogger();

  // Dev 模式下 electron-updater 无法正常工作（无 app-update.yml），跳过实际更新逻辑
  if (!app.isPackaged) {
    log.info('开发模式：跳过自动更新初始化');
    updaterStatus.currentVersion = app.getVersion();
    updaterStatus.checking = false;
    emitStatus();
    return;
  }

  registerUpdaterListeners();
  const state = await loadUpdaterState();

  // 启动时清理过期的下载残留文件 (.part / .dl-meta / .download)
  void cleanupStaleDownloads(getRollbackCacheDir()).catch((e) => {
    log.warn('清理过期下载文件失败:', e);
  });

  configureAutoUpdater(state.channel);
  await trackPendingLaunchState();
  await syncStatusFromUpdateInfo(null, state.channel);
  armHealthyStartupTimer();

  if (scheduledUpdateTimer) {
    clearInterval(scheduledUpdateTimer);
  }
  const jitter = Math.floor(Math.random() * CHECK_JITTER_MS);
  scheduledUpdateTimer = setInterval(() => {
    void checkForUpdatesManually();
  }, UPDATE_CHECK_INTERVAL_MS + jitter);
  const intervalMin = Math.round((UPDATE_CHECK_INTERVAL_MS + jitter) / 60000);
  log.info(`定时更新检查已启动，间隔: ${intervalMin}min`);

  void checkForUpdatesManually();
}

export async function downloadUpdate() {
  if (downloadInFlight) {
    return;
  }

  const reachable = await probeUpdateNetwork(updaterStatus.channel);
  markConnectivity(reachable ? 'online' : 'offline', reachable);
  if (!reachable) {
    queueRecovery('download', '下载更新前网络不可达');
    return;
  }

  downloadInFlight = true;
  try {
    armDownloadStallWatch();
    await autoUpdater.downloadUpdate();
  } catch (error) {
    clearDownloadStallTimer();
    if (await shouldRecoverFromNetwork(error)) {
      queueRecovery('download', '下载更新时网络异常');
      return;
    }
    const message = error instanceof Error ? error.message : '未知错误';
    updaterStatus.lastError = `下载更新失败: ${message}`;
    emitStatus();
    log.error('下载更新失败:', error);
  } finally {
    downloadInFlight = false;
  }
}

export function installUpdate() {
  // oneClick: true NSIS 直接覆盖安装，不运行卸载程序，
  // 静默模式 (/S) 安全可靠，不会出现"应用被删除"问题。
  autoUpdater.quitAndInstall(true, true);
}

export async function rollbackToPreviousVersion() {
  const state = await loadUpdaterState();
  if (!state.rollbackTarget) {
    throw new Error('当前没有可用的回退版本');
  }

  let installerPath: string;

  // 优先使用本地缓存（高可用：不依赖网络），校验 SHA256 完整性
  if (
    await isCachedInstallerValid(
      state.rollbackTarget.cachedInstallerPath,
      state.rollbackTarget.cachedInstallerHash
    )
  ) {
    installerPath = state.rollbackTarget.cachedInstallerPath!;
    log.info(`使用本地缓存进行回滚: ${installerPath}`);
  } else {
    // 降级：从网络重新下载
    log.warn('本地回滚缓存不可用或校验失败，尝试从网络下载');
    const { path, hash } = await downloadRollbackAsset(state.rollbackTarget);
    installerPath = path;
    // 更新缓存路径和 hash
    state.rollbackTarget.cachedInstallerPath = installerPath;
    state.rollbackTarget.cachedInstallerHash = hash;
    await persistUpdaterState();
  }

  // 回滚后重置 pending 状态，避免老版本启动后被误判为异常
  state.pendingVersion = null;
  state.pendingFromVersion = null;
  state.pendingLaunchAttempts = 0;
  await persistUpdaterState();

  await openRollbackInstaller(installerPath);
  return {
    version: state.rollbackTarget.version,
    installerPath,
  };
}
