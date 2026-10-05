/** 弱网恢复：网络探测、下载停滞监控、恢复后自动继续检查/下载 */
import type { UpdateChannel } from '../auto-updater-state';
import { getChannelMetadataFile } from './channel';
import {
  DOWNLOAD_STALL_TIMEOUT_MS,
  MIRROR_UPDATE_URL,
  NETWORK_PROBE_TIMEOUT_MS,
  NETWORK_RECOVERY_INTERVAL_MS,
} from './constants';
import { isLikelyNetworkError, mergeRecoveryAction } from './policy';
import type { RecoveryAction } from './policy';
import { connectivityState, emitStatus, markConnectivity, updaterStatus } from './status';

interface RecoveryHandlers {
  check: () => Promise<void>;
  download: () => Promise<void>;
}

let recoveryProbeTimer: NodeJS.Timeout | null = null;
let downloadStallTimer: NodeJS.Timeout | null = null;
let recoveryProbeInFlight = false;
let pendingRecoveryAction: RecoveryAction | null = null;
let recoveryHandlers: RecoveryHandlers | null = null;

/** 由控制器注册恢复后要执行的检查/下载动作（避免模块循环依赖） */
export function registerRecoveryHandlers(handlers: RecoveryHandlers) {
  recoveryHandlers = handlers;
}

export function clearPendingRecoveryAction() {
  pendingRecoveryAction = null;
}

export function clearRecoveryProbeTimer() {
  if (recoveryProbeTimer) {
    clearTimeout(recoveryProbeTimer);
    recoveryProbeTimer = null;
  }
}

export function clearDownloadStallTimer() {
  if (downloadStallTimer) {
    clearTimeout(downloadStallTimer);
    downloadStallTimer = null;
  }
}

export async function probeUpdateNetwork(channel: UpdateChannel): Promise<boolean> {
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

export function armDownloadStallWatch() {
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
      void recoveryHandlers?.download();
    } else if (action === 'check') {
      void recoveryHandlers?.check();
    }
  } finally {
    recoveryProbeInFlight = false;
  }
}

export function queueRecovery(action: RecoveryAction, reason: string) {
  pendingRecoveryAction = mergeRecoveryAction(pendingRecoveryAction, action);
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

export async function shouldRecoverFromNetwork(error: unknown): Promise<boolean> {
  if (isLikelyNetworkError(error)) {
    return true;
  }
  const reachable = await probeUpdateNetwork(updaterStatus.channel);
  markConnectivity(reachable ? 'online' : 'offline', reachable);
  return !reachable;
}
