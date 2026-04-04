import { describe, expect, it } from 'vitest';
import {
  createStartupHealthState,
  isStartupHealthComplete,
  normalizeRollbackTarget,
  normalizeUpdaterState,
} from '../../src/main/auto-updater-state';
import type { PersistedUpdaterState } from '../../src/main/auto-updater-state';

describe('auto-updater-state', () => {
  const initialState: PersistedUpdaterState = {
    channel: 'beta',
    rolloutBucket: 17,
    lastKnownGoodVersion: '1.1.0-beta.23',
    rollbackTarget: null,
    pendingVersion: null,
    pendingFromVersion: null,
    pendingLaunchAttempts: 0,
  };

  it('会丢弃非法的 channel 和损坏的回滚目标', () => {
    const normalized = normalizeUpdaterState(
      {
        channel: 'broken' as never,
        rollbackTarget: {
          version: '1.0.0',
          assetName: 'missing-tag.dmg',
        } as never,
      },
      initialState
    );

    expect(normalized.channel).toBe('beta');
    expect(normalized.rollbackTarget).toBeNull();
  });

  it('会保留合法的回滚目标并清洗可选字段', () => {
    const normalized = normalizeRollbackTarget({
      version: '1.0.0',
      tag: 'v1.0.0',
      assetName: 'Novel-Editor-1.0.0.dmg',
      assetUrl: 'https://example.com/Novel-Editor-1.0.0.dmg',
      cachedInstallerPath: 123,
      cachedInstallerHash: 'abc',
    });

    expect(normalized).toEqual({
      version: '1.0.0',
      tag: 'v1.0.0',
      assetName: 'Novel-Editor-1.0.0.dmg',
      assetUrl: 'https://example.com/Novel-Editor-1.0.0.dmg',
      cachedInstallerPath: null,
      cachedInstallerHash: 'abc',
    });
  });

  it('会把损坏的 pending 启动次数归零', () => {
    const normalized = normalizeUpdaterState(
      {
        pendingVersion: '1.1.0-beta.24',
        pendingFromVersion: '1.1.0-beta.23',
        pendingLaunchAttempts: -9,
      },
      initialState
    );

    expect(normalized.pendingVersion).toBe('1.1.0-beta.24');
    expect(normalized.pendingFromVersion).toBe('1.1.0-beta.23');
    expect(normalized.pendingLaunchAttempts).toBe(0);
  });

  it('只有全部健康信号完成后才允许提交健康启动', () => {
    const state = createStartupHealthState();

    expect(isStartupHealthComplete(state)).toBe(false);

    state.mainProcessReady = true;
    state.windowLoaded = true;
    state.rendererReady = true;
    expect(isStartupHealthComplete(state)).toBe(false);

    state.rendererHealthy = true;
    expect(isStartupHealthComplete(state)).toBe(true);
  });
});
