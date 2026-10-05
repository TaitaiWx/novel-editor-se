/** 对渲染进程暴露的更新状态快照，以及广播工具 */
import { app, BrowserWindow } from 'electron';
import type { UpdateChannel } from '../auto-updater-state';
import { getChannelMetadataFile, inferDefaultChannel } from './channel';

export type UpdateNetworkPhase = 'online' | 'recovering' | 'offline';

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

export const updaterStatus: UpdateStatus = {
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

export const connectivityState: UpdaterConnectivityState = {
  phase: 'online',
  reachable: null,
  lastCheckedAt: null,
  lastRecoveredAt: null,
};

export function broadcast(channel: string, payload?: unknown) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}

export function emitStatus() {
  updaterStatus.networkPhase = connectivityState.phase;
  updaterStatus.networkReachable = connectivityState.reachable;
  updaterStatus.networkCheckedAt = connectivityState.lastCheckedAt;
  broadcast('update-state-changed', updaterStatus);
  if (updaterStatus.rollbackAvailable) {
    broadcast('update-rollback-available', updaterStatus);
  }
}

export function markConnectivity(phase: UpdateNetworkPhase, reachable: boolean | null) {
  connectivityState.phase = phase;
  connectivityState.reachable = reachable;
  connectivityState.lastCheckedAt = Date.now();
  if (phase === 'online' && reachable) {
    connectivityState.lastRecoveredAt = connectivityState.lastCheckedAt;
  }
  emitStatus();
}
