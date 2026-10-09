/**
 * 自动更新控制器：electron-updater 事件绑定，以及对外暴露的检查/下载/安装等操作（通道由版本号决定，见 channel.ts）。
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
import {
  getRollbackCacheDir,
  isCachedInstallerValid,
  isRollbackInProgress,
  preCacheCurrentVersion,
} from './rollback';
import { isBoundRollbackTarget } from './rollback-metadata';
import { prepareAppForExit } from '../graceful-shutdown';
import { armUpdateRecovery } from './recovery';
import { recoveryPhase } from './recovery-supervisor';
import { installDebianArtifact } from './debian-install';
import { prepareNativeUpdate, handoffNativeUpdate } from './native-install';
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
let preCachePromise: Promise<void> | null = null;
let downloadedDebian: { path: string; sha512: string } | null = null;

// ─── electron-updater 事件处理 ─────────────────────────────────────────────

function handleUpdateAvailable(info: UpdateInfo) {
  if (isRollbackInProgress()) return;
  consecutiveDownloadFailures = 0;
  clearDownloadStallTimer();
  clearRecoveryProbeTimer();
  clearPendingRecoveryAction();
  markConnectivity('online', true);
  void syncStatusFromUpdateInfo(info, updaterStatus.channel).then(async () => {
    if ((await loadUpdaterState()).rejectedVersion === info.version) {
      updaterStatus.availableVersion = null;
      updaterStatus.checking = false;
      emitStatus();
      return;
    }
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
  if (isRollbackInProgress() || (await loadUpdaterState()).rejectedVersion === info.version) return;
  await syncStatusFromUpdateInfo(info, updaterStatus.channel);
  const state = await loadUpdaterState();
  if (isRollbackInProgress()) return;
  if (process.platform === 'linux' && !process.env.APPIMAGE) {
    const file = info.files.find((entry) => /\.deb(?:$|[?#])/.test(entry.url));
    downloadedDebian =
      file && info.downloadedFile ? { path: info.downloadedFile, sha512: file.sha512 } : null;
  }

  // 立即通知更新就绪，预缓存在后台异步执行，不阻塞用户操作
  applyDownloadedUpdate(state, info.version, app.getVersion());
  await persistUpdaterState();

  updaterStatus.checking = false;
  updaterStatus.updateReady = true;
  updaterStatus.preCaching = false;
  updaterStatus.downloadPercent = 100;
  updaterStatus.downloadedVersion = info.version;
  updaterStatus.pendingVersion = info.version;
  updaterStatus.rollbackAvailable = Boolean(
    state.rollbackTarget && isBoundRollbackTarget(state.rollbackTarget)
  );
  updaterStatus.rollbackVersion = state.rollbackTarget?.version ?? null;
  clearDownloadStallTimer();
  clearRecoveryProbeTimer();
  clearPendingRecoveryAction();
  markConnectivity('online', true);

  broadcast('update-downloaded', info);
  emitStatus();

  // 后台异步预缓存当前版本安装包（用于回滚），不阻塞更新就绪通知
  preCachePromise = preCacheCurrentVersionInBackground(state);
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
    updaterStatus.rollbackAvailable = Boolean(
      state.rollbackTarget && isBoundRollbackTarget(state.rollbackTarget)
    );
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
  updaterStatus.recoveryPhase = await recoveryPhase(app.getPath('userData'));
  if (updaterStatus.recoveryPhase === 'failed' && !updaterStatus.lastError)
    updaterStatus.lastError = '独立恢复未能确认旧版本健康启动，请使用已验证的旧版本安装包恢复';
  updaterStatus.channel = state.channel;
  updaterStatus.channelFile = getChannelMetadataFile(state.channel);
  updaterStatus.currentVersion = app.getVersion();
  updaterStatus.rolloutBucket = state.rolloutBucket;
  updaterStatus.rollbackAvailable = Boolean(
    state.rollbackTarget && isBoundRollbackTarget(state.rollbackTarget)
  );
  updaterStatus.rollbackVersion = state.rollbackTarget?.version ?? null;
  updaterStatus.pendingVersion = state.pendingVersion;
  if (getAutoUpdaterUnavailableReason() && !updaterStatus.lastError) {
    updaterStatus.lastError = getUpdaterUnavailableMessage();
  }
  return updaterStatus;
}

export async function checkForUpdatesManually() {
  if (checkInFlight || isRollbackInProgress()) {
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
  if (state.rollbackPendingVersion || state.pendingVersion === app.getVersion()) return;
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
    if (result?.isUpdateAvailable && result.updateInfo.version !== state.rejectedVersion) {
      void downloadUpdate();
    }
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
  if (isRollbackInProgress()) return;
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
  if (downloadInFlight || isRollbackInProgress()) {
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

  const state = await loadUpdaterState();
  if (state.rejectedVersion && updaterStatus.availableVersion === state.rejectedVersion) return;
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

let installInFlight: Promise<void> | null = null;
export function installUpdate() {
  if (!installInFlight)
    installInFlight = performInstallUpdate()
      .catch((error) => {
        updaterStatus.lastError = error instanceof Error ? error.message : String(error);
        emitStatus();
        throw error;
      })
      .finally(() => {
        installInFlight = null;
      });
  return installInFlight;
}

async function performInstallUpdate() {
  const updater = await getAutoUpdater();
  if (!updater) {
    throw new Error(getUpdaterUnavailableMessage());
  }

  if (isRollbackInProgress()) throw new Error('正在恢复旧版本，请稍后重试');
  await preCachePromise;
  const state = await loadUpdaterState();
  if (!updaterStatus.updateReady || state.pendingVersion === state.rejectedVersion)
    throw new Error('没有可安全安装的更新');
  if (
    !state.rollbackTarget ||
    state.rollbackTarget.version !== app.getVersion() ||
    !isBoundRollbackTarget(state.rollbackTarget) ||
    !(await isCachedInstallerValid(
      state.rollbackTarget.cachedInstallerPath,
      state.rollbackTarget.sha256
    ))
  ) {
    const target = await preCacheCurrentVersion();
    if (
      !target ||
      !target.cachedInstallerPath ||
      !isBoundRollbackTarget(target) ||
      !(await isCachedInstallerValid(target.cachedInstallerPath, target.sha256))
    ) {
      throw new Error('旧版本恢复包尚未校验完成，暂不能安装更新，请联网后重试');
    }
    state.rollbackTarget = target;
    await persistUpdaterState();
  }
  await prepareNativeUpdate();
  if (!state.pendingVersion) throw new Error('更新版本信息缺失');
  const guardian = await armUpdateRecovery(state.rollbackTarget!, state.pendingVersion);
  try {
    if (
      !(await prepareAppForExit(async () => {
        await guardian.commit();
        if (process.platform === 'linux' && !process.env.APPIMAGE) {
          if (!downloadedDebian) throw new Error('缺少已校验的 Debian 安装包，请重新下载');
          await installDebianArtifact(downloadedDebian.path, {
            algorithm: 'sha512',
            value: downloadedDebian.sha512,
          });
          app.relaunch();
          app.quit();
        } else await handoffNativeUpdate(updater);
      }))
    )
      throw new Error('内容未能安全保存，已取消安装更新');
  } catch (error) {
    await guardian.cancel();
    throw error;
  }
}

// 网络恢复后由 network 模块回调继续检查/下载
registerRecoveryHandlers({
  check: checkForUpdatesManually,
  download: downloadUpdate,
});
