/** 持久化的更新状态（版本指针、灰度分桶、回滚目标）读写 */
import type { UpdateInfo } from 'electron-updater';
import { app } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { join } from 'path';
import { normalizeUpdaterState } from '../auto-updater-state';
import type { PersistedUpdaterState, UpdateChannel } from '../auto-updater-state';
import { getChannelMetadataFile, inferDefaultChannel } from './channel';
import { computeRolloutBucket, isRolloutEligible } from './rollout';
import { updaterStatus } from './status';

let updaterState: PersistedUpdaterState | null = null;

function getUpdaterStatePath() {
  return join(app.getPath('userData'), 'updater-state.json');
}

function createRolloutBucket() {
  return computeRolloutBucket(app.getPath('userData'));
}

export async function loadUpdaterState() {
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
    updaterState = normalizeUpdaterState(parsed, initialState);
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

export async function persistUpdaterState() {
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

/** 用最新的通道元数据同步状态快照（灰度比例、资格、回滚信息） */
export async function syncStatusFromUpdateInfo(
  updateInfo: UpdateInfo | null,
  channel: UpdateChannel
) {
  const state = await loadUpdaterState();
  updaterStatus.channel = state.channel;
  updaterStatus.channelFile = getChannelMetadataFile(channel);
  updaterStatus.currentVersion = app.getVersion();
  updaterStatus.channelVersion = updateInfo?.version ?? null;
  updaterStatus.rolloutPercentage = updateInfo?.stagingPercentage ?? null;
  updaterStatus.rolloutEligible = isRolloutEligible(
    state.rolloutBucket,
    updateInfo?.stagingPercentage
  );
  updaterStatus.rollbackAvailable = Boolean(state.rollbackTarget);
  updaterStatus.rollbackVersion = state.rollbackTarget?.version ?? null;
  updaterStatus.pendingVersion = state.pendingVersion;
}
