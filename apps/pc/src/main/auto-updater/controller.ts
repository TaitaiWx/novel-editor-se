/**
 * 自动更新控制器：electron-updater 事件绑定，以及对外暴露的检查/下载/安装/切换通道等操作。
 */
import type {
  AppUpdater,
  ProgressInfo,
  UpdateCheckResult,
  UpdateDownloadedEvent,
  UpdateInfo,
} from 'electron-updater';
import { app } from 'electron';
import log from 'electron-log/main';
import type { PersistedUpdaterState, UpdateChannel } from '../auto-updater-state';
import { cleanupStaleDownloads } from '../resilient-downloader';
import { getChannelMetadataFile } from './channel';
import {
  CHECK_JITTER_MS,
  FIRST_CHECK_DELAY_MS,
  MAX_DOWNLOAD_RETRIES,
  UPDATE_CHECK_INTERVAL_MS,
} from './constants';
import {
  armHealthyStartupObservers,
  noteMainProcessReady,
  resetStartupHealthState,
  trackPendingLaunchState,
} from './health';
import {
  configureAutoUpdater,
  configureUpdaterLogger,
  getAutoUpdater,
  getAutoUpdaterUnavailableReason,
  getUpdaterUnavailableMessage,
} from './loader';
import {
  armDownloadStallWatch,
  clearDownloadStallTimer,
  clearPendingRecoveryAction,
  clearRecoveryProbeTimer,
  probeUpdateNetwork,
  queueRecovery,
  registerRecoveryHandlers,
  shouldRecoverFromNetwork,
} from './network';
import {
  applyDownloadedUpdate,
  computeCheckBackoffMs,
  computeDownloadRetryDelayMs,
  shouldRetryDownload,
} from './policy';
import { getRollbackCacheDir, preCacheCurrentVersion } from './rollback';
import { loadUpdaterState, persistUpdaterState, syncStatusFromUpdateInfo } from './state-store';
import { broadcast, emitStatus, markConnectivity, updaterStatus } from './status';

let scheduledUpdateTimer: NodeJS.Timeout | null = null;
/** 启动后延迟的首次检查；需要跟踪，重复 setup 时先清除，避免出现多次提前检查 */
let firstCheckTimer: NodeJS.Timeout | null = null;
let listenersRegistered = false;
let consecutiveCheckFailures = 0;
let consecutiveDownloadFailures = 0;
let checkInFlight = false;
let downloadInFlight = false;

// ─── electron-updater 事件处理 ─────────────────────────────────────────────

function handleUpdateAvailable(info: UpdateInfo) {
  consecutiveDownloadFailures = 0;
  clearDownloadStallTimer();
  clearRecoveryProbeTimer();
  clearPendingRecoveryAction();
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

  // 立即通知更新就绪，预缓存在后台异步执行，不阻塞用户操作
  applyDownloadedUpdate(state, info.version, app.getVersion());
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
  clearPendingRecoveryAction();
  markConnectivity('online', true);

  broadcast('update-downloaded', info);
  emitStatus();

  // 后台异步预缓存当前版本安装包（用于回滚），不阻塞更新就绪通知
  void preCacheCurrentVersionInBackground(state);
}

/**
 * 在后台预缓存当前版本安装包，用于高可用回滚。
 * 独立于 handleUpdateDownloaded，不阻塞更新安装流程。
 */
async function preCacheCurrentVersionInBackground(state: PersistedUpdaterState) {
  updaterStatus.preCaching = true;
  emitStatus();
  try {
    const rollbackTarget = await preCacheCurrentVersion();
    if (rollbackTarget) {
      state.rollbackTarget = rollbackTarget;
      await persistUpdaterState();
      if (rollbackTarget.cachedInstallerPath) {
        log.info(`回滚安装包已就绪: ${rollbackTarget.cachedInstallerPath}`);
      } else {
        log.warn('回滚安装包未能缓存到本地，回滚将依赖网络下载');
      }
    } else {
      log.error('无法准备回滚信息，更新后将无法回滚');
    }
    updaterStatus.rollbackAvailable = Boolean(state.rollbackTarget);
    updaterStatus.rollbackVersion = state.rollbackTarget?.version ?? null;
  } catch (error) {
    log.error('后台预缓存回滚安装包失败:', error);
  } finally {
    updaterStatus.preCaching = false;
    emitStatus();
  }
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
    if (shouldRetryDownload(consecutiveDownloadFailures)) {
      const backoffMs = computeDownloadRetryDelayMs(consecutiveDownloadFailures);
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

function registerUpdaterListeners(updater: AppUpdater) {
  if (listenersRegistered) {
    return;
  }

  listenersRegistered = true;
  updater.on('checking-for-update', () => {
    updaterStatus.checking = true;
    updaterStatus.lastError = null;
    emitStatus();
  });
  updater.on('update-available', handleUpdateAvailable);
  updater.on('update-not-available', handleUpdateNotAvailable);
  updater.on('download-progress', handleDownloadProgress);
  updater.on('update-downloaded', (info) => {
    void handleUpdateDownloaded(info).catch((error) => {
      log.error('处理已下载更新失败:', error);
    });
  });
  updater.on('error', (error) => {
    void handleUpdaterError(error);
  });
}

async function applyUpdateCheckResult(result: UpdateCheckResult | null, channel: UpdateChannel) {
  await syncStatusFromUpdateInfo(result?.updateInfo ?? null, channel);
  emitStatus();
}

// ─── 对外 API ───────────────────────────────────────────────────────────────

export async function getUpdateStatus() {
  const state = await loadUpdaterState();
  updaterStatus.channel = state.channel;
  updaterStatus.channelFile = getChannelMetadataFile(state.channel);
  updaterStatus.currentVersion = app.getVersion();
  updaterStatus.rolloutBucket = state.rolloutBucket;
  updaterStatus.rollbackAvailable = Boolean(state.rollbackTarget);
  updaterStatus.rollbackVersion = state.rollbackTarget?.version ?? null;
  updaterStatus.pendingVersion = state.pendingVersion;
  if (getAutoUpdaterUnavailableReason() && !updaterStatus.lastError) {
    updaterStatus.lastError = getUpdaterUnavailableMessage();
  }
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

  const updater = await getAutoUpdater();
  if (!updater) {
    updaterStatus.lastError = getUpdaterUnavailableMessage();
    emitStatus();
    return updaterStatus;
  }

  configureAutoUpdater(updater, channel);
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
  const updater = await getAutoUpdater();
  if (!updater) {
    updaterStatus.checking = false;
    updaterStatus.lastError = getUpdaterUnavailableMessage();
    emitStatus();
    return;
  }

  configureAutoUpdater(updater, state.channel);

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
    const result = await updater.checkForUpdates();
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
    const backoffMs = computeCheckBackoffMs(consecutiveCheckFailures);
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

  const updater = await getAutoUpdater();
  if (!updater) {
    updaterStatus.currentVersion = app.getVersion();
    updaterStatus.checking = false;
    updaterStatus.lastError = getUpdaterUnavailableMessage();
    emitStatus();
    return;
  }

  resetStartupHealthState();
  registerUpdaterListeners(updater);
  const state = await loadUpdaterState();

  // 启动时清理过期的下载残留文件 (.part / .dl-meta / .download)
  void cleanupStaleDownloads(getRollbackCacheDir()).catch((e) => {
    log.warn('清理过期下载文件失败:', e);
  });

  configureAutoUpdater(updater, state.channel);
  await trackPendingLaunchState();
  await syncStatusFromUpdateInfo(null, state.channel);
  armHealthyStartupObservers();
  noteMainProcessReady();

  if (scheduledUpdateTimer) {
    clearInterval(scheduledUpdateTimer);
  }
  const jitter = Math.floor(Math.random() * CHECK_JITTER_MS);
  scheduledUpdateTimer = setInterval(() => {
    void checkForUpdatesManually();
  }, UPDATE_CHECK_INTERVAL_MS + jitter);
  const intervalMin = Math.round((UPDATE_CHECK_INTERVAL_MS + jitter) / 60000);
  log.info(`定时更新检查已启动，间隔: ${intervalMin}min`);

  // 延迟首次更新检查，避免与启动渲染竞争 CPU / 网络 / IO
  if (firstCheckTimer) {
    clearTimeout(firstCheckTimer);
  }
  firstCheckTimer = setTimeout(() => {
    firstCheckTimer = null;
    void checkForUpdatesManually();
  }, FIRST_CHECK_DELAY_MS);
}

export async function downloadUpdate() {
  if (downloadInFlight) {
    return;
  }

  const updater = await getAutoUpdater();
  if (!updater) {
    updaterStatus.lastError = getUpdaterUnavailableMessage();
    emitStatus();
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
    await updater.downloadUpdate();
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

export async function installUpdate() {
  const updater = await getAutoUpdater();
  if (!updater) {
    throw new Error(getUpdaterUnavailableMessage());
  }

  // oneClick: true NSIS 直接覆盖安装，不运行卸载程序，
  // 静默模式 (/S) 安全可靠，不会出现"应用被删除"问题。
  updater.quitAndInstall(true, true);
}

// 网络恢复后由 network 模块回调继续检查/下载
registerRecoveryHandlers({
  check: checkForUpdatesManually,
  download: downloadUpdate,
});
