import { describe, expect, it } from 'vitest';
import {
  getChannelMetadataFile,
  inferDefaultChannel,
  mapUpdateChannel,
} from '../../../src/main/auto-updater/channel';
import { computeRolloutBucket, isRolloutEligible } from '../../../src/main/auto-updater/rollout';
import {
  applyDownloadedUpdate,
  applyHealthyVersion,
  applyPendingLaunch,
  clearPendingState,
  computeCheckBackoffMs,
  computeDownloadRetryDelayMs,
  isLikelyNetworkError,
  mergeRecoveryAction,
  shouldRetryDownload,
} from '../../../src/main/auto-updater/policy';
import {
  getMirrorShortcutName,
  isPreferredAssetName,
  isRollbackCacheCandidate,
  scoreReleaseAsset,
  selectCacheFilesToPrune,
  selectReleaseAsset,
} from '../../../src/main/auto-updater/assets';
import type { PersistedUpdaterState } from '../../../src/main/auto-updater-state';

function makeState(overrides: Partial<PersistedUpdaterState> = {}): PersistedUpdaterState {
  return {
    channel: 'stable',
    rolloutBucket: 10,
    lastKnownGoodVersion: '1.0.0',
    rollbackTarget: null,
    pendingVersion: null,
    pendingFromVersion: null,
    pendingLaunchAttempts: 0,
    ...overrides,
  };
}

const rollbackTarget = {
  version: '1.0.0',
  tag: 'v1.0.0',
  assetName: 'mac-arm64.dmg',
  assetUrl: 'https://example.com/mac-arm64.dmg',
  cachedInstallerPath: null,
  cachedInstallerHash: null,
};

describe('auto-updater/channel', () => {
  it('根据预发布标识推断默认通道', () => {
    expect(inferDefaultChannel('1.2.0')).toBe('stable');
    expect(inferDefaultChannel('1.2.0-beta.3')).toBe('beta');
    expect(inferDefaultChannel('1.2.0-alpha.1')).toBe('canary');
    expect(inferDefaultChannel('1.2.0-CANARY.1')).toBe('canary');
  });

  it('通道映射为 electron-updater channel 并生成平台元数据文件名', () => {
    expect(mapUpdateChannel('stable')).toBe('latest');
    expect(mapUpdateChannel('canary')).toBe('alpha');
    expect(getChannelMetadataFile('stable', 'win32')).toBe('latest.yml');
    expect(getChannelMetadataFile('beta', 'darwin')).toBe('beta-mac.yml');
    expect(getChannelMetadataFile('canary', 'linux')).toBe('alpha-linux.yml');
  });
});

describe('auto-updater/rollout', () => {
  it('同一种子得到稳定的 0~99 分桶', () => {
    const bucket = computeRolloutBucket('/Users/demo/Library/Application Support/novel');
    expect(bucket).toBe(computeRolloutBucket('/Users/demo/Library/Application Support/novel'));
    expect(bucket).toBeGreaterThanOrEqual(0);
    expect(bucket).toBeLessThan(100);
  });

  it('不同种子的分桶大致均匀分布', () => {
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 2000; i++) {
      counts[Math.floor(computeRolloutBucket(`seed-${i}`) / 10)] += 1;
    }
    for (const count of counts) {
      expect(count).toBeGreaterThan(120);
      expect(count).toBeLessThan(280);
    }
  });

  it('分桶小于灰度比例才有资格，未设置比例时返回 null', () => {
    expect(isRolloutEligible(9, 10)).toBe(true);
    expect(isRolloutEligible(10, 10)).toBe(false);
    expect(isRolloutEligible(0, 0)).toBe(false);
    expect(isRolloutEligible(99, 100)).toBe(true);
    expect(isRolloutEligible(5, undefined)).toBeNull();
    expect(isRolloutEligible(5, null)).toBeNull();
  });
});

describe('auto-updater/policy', () => {
  it('识别常见网络错误', () => {
    expect(isLikelyNetworkError(new Error('net::ERR_INTERNET_DISCONNECTED'))).toBe(true);
    expect(isLikelyNetworkError(new Error('getaddrinfo ENOTFOUND host'))).toBe(true);
    expect(isLikelyNetworkError('socket hang up')).toBe(true);
    expect(isLikelyNetworkError(new Error('sha512 checksum mismatch'))).toBe(false);
    expect(isLikelyNetworkError(null)).toBe(false);
  });

  it('download 恢复动作优先于 check', () => {
    expect(mergeRecoveryAction(null, 'check')).toBe('check');
    expect(mergeRecoveryAction('download', 'check')).toBe('download');
    expect(mergeRecoveryAction('check', 'download')).toBe('download');
  });

  it('检查更新失败按指数退避并封顶 30 分钟', () => {
    expect(computeCheckBackoffMs(1)).toBe(60_000);
    expect(computeCheckBackoffMs(2)).toBe(120_000);
    expect(computeCheckBackoffMs(3)).toBe(240_000);
    expect(computeCheckBackoffMs(20)).toBe(30 * 60 * 1000);
  });

  it('下载重试带抖动且有次数上限', () => {
    expect(computeDownloadRetryDelayMs(1, () => 0)).toBe(45_000);
    expect(computeDownloadRetryDelayMs(1, () => 1)).toBe(75_000);
    expect(computeDownloadRetryDelayMs(2, () => 0.5)).toBe(120_000);
    expect(shouldRetryDownload(3)).toBe(true);
    expect(shouldRetryDownload(4)).toBe(false);
  });

  it('待确认版本连续启动 2 次且有回滚目标时提示回退', () => {
    const state = makeState({ pendingVersion: '1.1.0', rollbackTarget });
    expect(applyPendingLaunch(state, '1.1.0')).toEqual({ offerRollback: false });
    expect(state.pendingLaunchAttempts).toBe(1);
    expect(applyPendingLaunch(state, '1.1.0')).toEqual({ offerRollback: true });
    expect(state.pendingLaunchAttempts).toBe(2);
  });

  it('没有回滚目标时不提示回退', () => {
    const state = makeState({ pendingVersion: '1.1.0', pendingLaunchAttempts: 5 });
    expect(applyPendingLaunch(state, '1.1.0').offerRollback).toBe(false);
  });

  it('当前版本不是待确认版本时重置启动计数', () => {
    const state = makeState({ pendingVersion: '1.1.0', pendingLaunchAttempts: 3 });
    expect(applyPendingLaunch(state, '1.0.0').offerRollback).toBe(false);
    expect(state.pendingLaunchAttempts).toBe(0);
  });

  it('健康启动推进版本指针并清除待确认标记', () => {
    const state = makeState({
      pendingVersion: '1.1.0',
      pendingFromVersion: '1.0.0',
      pendingLaunchAttempts: 1,
    });
    applyHealthyVersion(state, '1.1.0');
    expect(state).toMatchObject({
      lastKnownGoodVersion: '1.1.0',
      pendingVersion: null,
      pendingFromVersion: null,
      pendingLaunchAttempts: 0,
    });
  });

  it('健康的是其他版本时保留待确认标记', () => {
    const state = makeState({ pendingVersion: '1.2.0', pendingFromVersion: '1.1.0' });
    applyHealthyVersion(state, '1.1.0');
    expect(state.pendingVersion).toBe('1.2.0');
    expect(state.lastKnownGoodVersion).toBe('1.1.0');
  });

  it('下载完成记录待确认版本，回滚后清空', () => {
    const state = makeState({ pendingLaunchAttempts: 2 });
    applyDownloadedUpdate(state, '1.1.0', '1.0.0');
    expect(state).toMatchObject({
      pendingVersion: '1.1.0',
      pendingFromVersion: '1.0.0',
      pendingLaunchAttempts: 0,
    });
    clearPendingState(state);
    expect(state.pendingVersion).toBeNull();
    expect(state.pendingFromVersion).toBeNull();
  });
});

describe('auto-updater/assets', () => {
  const assets = [
    { name: 'app-1.0.0-arm64.dmg.blockmap', browser_download_url: 'u0' },
    { name: 'latest-mac.yml', browser_download_url: 'u1' },
    { name: 'app-1.0.0-x64.dmg', browser_download_url: 'u2' },
    { name: 'app-1.0.0-arm64-mac.zip', browser_download_url: 'u3' },
    { name: 'app-1.0.0-arm64.dmg', browser_download_url: 'u4' },
    { name: 'app-1.0.0-x64.exe', browser_download_url: 'u5' },
  ];

  it('按平台过滤安装包', () => {
    expect(isPreferredAssetName('a.dmg.blockmap', 'darwin')).toBe(false);
    expect(isPreferredAssetName('a.zip', 'darwin')).toBe(true);
    expect(isPreferredAssetName('a.exe', 'darwin')).toBe(false);
    expect(isPreferredAssetName('a.msi', 'win32')).toBe(true);
    expect(isPreferredAssetName('a.AppImage', 'linux')).toBe(true);
  });

  it('优先选择架构匹配的首选格式', () => {
    expect(scoreReleaseAsset('app-arm64.dmg', 'darwin', 'arm64')).toBe(120);
    expect(selectReleaseAsset(assets, 'darwin', 'arm64')?.browser_download_url).toBe('u4');
    expect(selectReleaseAsset(assets, 'darwin', 'x64')?.browser_download_url).toBe('u2');
    expect(selectReleaseAsset(assets, 'win32', 'x64')?.browser_download_url).toBe('u5');
    expect(selectReleaseAsset(assets, 'linux', 'x64')).toBeUndefined();
  });

  it('镜像快捷文件名', () => {
    expect(getMirrorShortcutName('darwin', 'arm64')).toBe('mac-arm64.dmg');
    expect(getMirrorShortcutName('win32', 'x64')).toBe('win-x64.exe');
    expect(getMirrorShortcutName('linux', 'x64')).toBe('linux-x64.AppImage');
    expect(getMirrorShortcutName('aix', 'x64')).toBeNull();
  });

  it('缓存清理排除中间文件，保留最新 N 个和指定文件', () => {
    expect(isRollbackCacheCandidate('a.dmg')).toBe(true);
    expect(isRollbackCacheCandidate('a.dmg.part')).toBe(false);
    expect(isRollbackCacheCandidate('a.dmg.dl-meta')).toBe(false);

    const files = [
      { name: 'old.dmg', path: '/c/old.dmg', mtimeMs: 1 },
      { name: 'new.dmg', path: '/c/new.dmg', mtimeMs: 3 },
      { name: 'mid.dmg', path: '/c/mid.dmg', mtimeMs: 2 },
      { name: 'oldest.dmg', path: '/c/oldest.dmg', mtimeMs: 0 },
    ];
    expect(selectCacheFilesToPrune(files, 2).map((f) => f.name)).toEqual(['old.dmg', 'oldest.dmg']);
    expect(selectCacheFilesToPrune(files, 2, 'old.dmg').map((f) => f.name)).toEqual(['oldest.dmg']);
    expect(selectCacheFilesToPrune(files.slice(0, 2), 2)).toEqual([]);
  });
});
