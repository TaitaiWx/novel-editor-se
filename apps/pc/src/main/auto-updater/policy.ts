/**
 * 自动更新的决策逻辑（纯函数）：退避重试、网络错误识别、版本指针与回滚判定。
 * 不依赖 Electron，便于单测。
 */
import type { PersistedUpdaterState } from '../auto-updater-state';
import { MAX_BACKOFF_MS, MAX_DOWNLOAD_RETRIES, MAX_FAILED_UPDATED_LAUNCHES } from './constants';

export type RecoveryAction = 'check' | 'download';

/** 粗略判断错误是否由网络引起 */
export function isLikelyNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /network|net::|socket|timed out|timeout|econn|enotfound|offline|dns|reset|failed to fetch/i.test(
    message
  );
}

/** 合并待恢复动作：download 优先级高于 check */
export function mergeRecoveryAction(
  pending: RecoveryAction | null,
  action: RecoveryAction
): RecoveryAction {
  return pending === 'download' || action === 'download' ? 'download' : action;
}

/** 检查更新失败的指数退避：1min → 2min → 4min → ... → 30min 封顶 */
export function computeCheckBackoffMs(consecutiveFailures: number): number {
  return Math.min(60_000 * Math.pow(2, consecutiveFailures - 1), MAX_BACKOFF_MS);
}

/** 下载失败后是否还允许自动重试 */
export function shouldRetryDownload(consecutiveFailures: number): boolean {
  return consecutiveFailures <= MAX_DOWNLOAD_RETRIES;
}

/** 下载失败重试的退避时间（带 ±25% 抖动） */
export function computeDownloadRetryDelayMs(
  consecutiveFailures: number,
  random: () => number = Math.random
): number {
  const delay = Math.min(MAX_BACKOFF_MS, 60_000 * Math.pow(2, consecutiveFailures - 1));
  const jitter = 0.75 + random() * 0.5;
  return Math.floor(delay * jitter);
}

/**
 * 启动时记录待确认版本的启动次数（会修改传入的 state）。
 * 返回是否应提示用户回退到旧版本。
 */
export function applyPendingLaunch(
  state: PersistedUpdaterState,
  currentVersion: string
): { offerRollback: boolean } {
  if (state.pendingVersion === currentVersion) {
    state.pendingLaunchAttempts += 1;
    return {
      offerRollback:
        state.pendingLaunchAttempts >= MAX_FAILED_UPDATED_LAUNCHES && Boolean(state.rollbackTarget),
    };
  }
  state.pendingLaunchAttempts = 0;
  return { offerRollback: false };
}

/** 当前版本确认健康：推进版本指针并清理待确认标记（会修改传入的 state） */
export function applyHealthyVersion(state: PersistedUpdaterState, currentVersion: string): void {
  state.lastKnownGoodVersion = currentVersion;
  state.pendingLaunchAttempts = 0;
  if (state.pendingVersion === currentVersion) {
    state.pendingVersion = null;
    state.pendingFromVersion = null;
  }
}

/** 新版本下载完成：记录待确认版本（会修改传入的 state） */
export function applyDownloadedUpdate(
  state: PersistedUpdaterState,
  downloadedVersion: string,
  currentVersion: string
): void {
  state.pendingVersion = downloadedVersion;
  state.pendingFromVersion = currentVersion;
  state.pendingLaunchAttempts = 0;
}

/** 回滚后重置 pending 状态，避免老版本启动后被误判为异常（会修改传入的 state） */
export function clearPendingState(state: PersistedUpdaterState): void {
  state.pendingVersion = null;
  state.pendingFromVersion = null;
  state.pendingLaunchAttempts = 0;
}
