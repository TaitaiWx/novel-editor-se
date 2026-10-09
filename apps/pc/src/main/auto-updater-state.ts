/** 自动更新状态相关的纯逻辑 */

export type UpdateChannel = 'stable' | 'beta' | 'canary';

export interface RollbackTarget {
  version: string;
  tag: string;
  assetName: string;
  assetUrl: string;
  /** 发布源提供的摘要与平台身份；旧版无此字段的缓存不可直接执行。 */
  rollbackProtocol?: number;
  /** Independent OS guardian nonce acknowledgement support. */
  recoveryProtocol?: number;
  sha256?: string;
  platform?: string;
  arch?: string;
  /** 本地已缓存的安装包路径（高可用核心：回滚不依赖网络） */
  cachedInstallerPath: string | null;
  /** 缓存安装包的 SHA256 摘要，用于完整性校验 */
  cachedInstallerHash: string | null;
}

export interface PersistedUpdaterState {
  channel: UpdateChannel;
  rolloutBucket: number;
  lastKnownGoodVersion: string;
  rollbackTarget: RollbackTarget | null;
  pendingVersion: string | null;
  pendingFromVersion: string | null;
  pendingLaunchAttempts: number;
  rollbackPendingVersion?: string | null;
  rejectedVersion?: string | null;
}

export interface StartupHealthState {
  mainProcessReady: boolean;
  windowLoaded: boolean;
  rendererReady: boolean;
  rendererHealthy: boolean;
}

export function createStartupHealthState(): StartupHealthState {
  return {
    mainProcessReady: false,
    windowLoaded: false,
    rendererReady: false,
    rendererHealthy: false,
  };
}

export function isStartupHealthComplete(state: StartupHealthState): boolean {
  return (
    state.mainProcessReady && state.windowLoaded && state.rendererReady && state.rendererHealthy
  );
}

export function normalizeChannel(value: unknown, fallback: UpdateChannel): UpdateChannel {
  return value === 'stable' || value === 'beta' || value === 'canary' ? value : fallback;
}

export function normalizeRollbackTarget(value: unknown): RollbackTarget | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const target = value as Partial<RollbackTarget>;
  if (
    typeof target.version !== 'string' ||
    typeof target.tag !== 'string' ||
    typeof target.assetName !== 'string' ||
    typeof target.assetUrl !== 'string'
  ) {
    return null;
  }

  return {
    ...(target.rollbackProtocol === 1 ? { rollbackProtocol: 1 } : {}),
    ...(target.recoveryProtocol === 1 ? { recoveryProtocol: 1 } : {}),
    ...(typeof target.sha256 === 'string' ? { sha256: target.sha256 } : {}),
    ...(typeof target.platform === 'string' ? { platform: target.platform } : {}),
    ...(typeof target.arch === 'string' ? { arch: target.arch } : {}),
    version: target.version,
    tag: target.tag,
    assetName: target.assetName,
    assetUrl: target.assetUrl,
    cachedInstallerPath:
      typeof target.cachedInstallerPath === 'string' ? target.cachedInstallerPath : null,
    cachedInstallerHash:
      typeof target.cachedInstallerHash === 'string' ? target.cachedInstallerHash : null,
  };
}

export function normalizeUpdaterState(
  parsed: Partial<PersistedUpdaterState>,
  initialState: PersistedUpdaterState
): PersistedUpdaterState {
  return {
    rollbackPendingVersion:
      typeof parsed.rollbackPendingVersion === 'string' ? parsed.rollbackPendingVersion : null,
    rejectedVersion: typeof parsed.rejectedVersion === 'string' ? parsed.rejectedVersion : null,
    channel: normalizeChannel(parsed.channel, initialState.channel),
    rolloutBucket:
      typeof parsed.rolloutBucket === 'number' && Number.isFinite(parsed.rolloutBucket)
        ? parsed.rolloutBucket
        : initialState.rolloutBucket,
    lastKnownGoodVersion:
      typeof parsed.lastKnownGoodVersion === 'string'
        ? parsed.lastKnownGoodVersion
        : initialState.lastKnownGoodVersion,
    rollbackTarget: normalizeRollbackTarget(parsed.rollbackTarget),
    pendingVersion: typeof parsed.pendingVersion === 'string' ? parsed.pendingVersion : null,
    pendingFromVersion:
      typeof parsed.pendingFromVersion === 'string' ? parsed.pendingFromVersion : null,
    pendingLaunchAttempts:
      typeof parsed.pendingLaunchAttempts === 'number' && parsed.pendingLaunchAttempts >= 0
        ? parsed.pendingLaunchAttempts
        : 0,
  };
}
