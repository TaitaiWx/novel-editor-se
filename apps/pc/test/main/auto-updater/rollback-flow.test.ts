import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { PersistedUpdaterState } from '../../../src/main/auto-updater-state';

// 用 vi.hoisted 共享可变的 Electron 模拟环境
const env = vi.hoisted(() => ({
  userData: '',
  version: '1.1.0',
  windows: [] as unknown[],
  openPath: vi.fn(async (_path: string) => ''),
  install: vi.fn(async () => undefined),
}));

vi.mock('electron', () => ({
  app: {
    getVersion: () => env.version,
    getPath: () => env.userData,
    isPackaged: false,
  },
  BrowserWindow: { getAllWindows: () => env.windows },
  shell: { openPath: env.openPath },
}));

vi.mock('../../../src/main/auto-updater/rollback-install', () => ({
  installRollbackArtifact: env.install,
}));

vi.mock('../../../src/main/auto-updater/native-install', () => ({
  prepareNativeUpdate: vi.fn(),
  handoffNativeUpdate: vi.fn(),
}));
vi.mock('../../../src/main/graceful-shutdown', () => ({
  prepareAppForExit: vi.fn(async (exit: () => void) => {
    exit();
    return true;
  }),
}));

vi.mock('electron-log/main', () => {
  const noop = () => undefined;
  return {
    default: {
      info: noop,
      warn: noop,
      error: noop,
      initialize: noop,
      transports: { file: { level: 'info' } },
    },
  };
});

const rollbackTarget = {
  version: '1.0.0',
  tag: 'v1.0.0',
  assetName: 'installer.dmg',
  assetUrl: 'https://example.invalid/installer.dmg',
  cachedInstallerPath: null as string | null,
  cachedInstallerHash: null as string | null,
};

async function writeState(state: Partial<PersistedUpdaterState>) {
  await writeFile(join(env.userData, 'updater-state.json'), JSON.stringify(state), 'utf8');
}

async function readState(): Promise<PersistedUpdaterState> {
  return JSON.parse(await readFile(join(env.userData, 'updater-state.json'), 'utf8'));
}

function createFakeWindow() {
  return {
    isDestroyed: () => false,
    webContents: Object.assign(new EventEmitter(), {
      send: vi.fn(),
      isCrashed: () => false,
      isLoadingMainFrame: () => false,
      getURL: () => 'file:///index.html',
    }),
  };
}

describe('auto-updater 版本指针与回滚流程', () => {
  beforeEach(async () => {
    vi.stubEnv('APPIMAGE', '/test/Novel.AppImage');
    vi.resetModules();
    env.userData = await mkdtemp(join(tmpdir(), 'ne-updater-'));
    env.version = '1.1.0';
    env.windows = [];
    env.openPath.mockClear();
    env.install.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await rm(env.userData, { recursive: true, force: true });
  });

  it('首次加载生成稳定的灰度分桶并持久化', async () => {
    const { loadUpdaterState } = await import('../../../src/main/auto-updater/state-store');
    const { computeRolloutBucket } = await import('../../../src/main/auto-updater/rollout');
    const state = await loadUpdaterState();
    expect(state.rolloutBucket).toBe(computeRolloutBucket(env.userData));
    expect(state.channel).toBe('stable');
    expect(state.lastKnownGoodVersion).toBe('1.1.0');
    expect((await readState()).rolloutBucket).toBe(state.rolloutBucket);
  });

  it('根据 stagingPercentage 计算灰度资格', async () => {
    await writeState({ channel: 'beta', rolloutBucket: 30, lastKnownGoodVersion: '1.0.0' });
    const { syncStatusFromUpdateInfo } = await import('../../../src/main/auto-updater/state-store');
    const { updaterStatus } = await import('../../../src/main/auto-updater/status');

    await syncStatusFromUpdateInfo({ version: '1.2.0', stagingPercentage: 20 } as never, 'beta');
    expect(updaterStatus.rolloutPercentage).toBe(20);
    expect(updaterStatus.rolloutEligible).toBe(false);

    await syncStatusFromUpdateInfo({ version: '1.2.0', stagingPercentage: 50 } as never, 'beta');
    expect(updaterStatus.rolloutEligible).toBe(true);

    await syncStatusFromUpdateInfo({ version: '1.2.0' } as never, 'beta');
    expect(updaterStatus.rolloutEligible).toBeNull();
    expect(updaterStatus.channelVersion).toBe('1.2.0');
  });

  it('新版本连续启动失败后自动回退失败仍保留诊断状态', async () => {
    await writeState({
      channel: 'stable',
      rolloutBucket: 1,
      lastKnownGoodVersion: '1.0.0',
      rollbackTarget,
      pendingVersion: '1.1.0',
      pendingFromVersion: '1.0.0',
      pendingLaunchAttempts: 1,
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { trackPendingLaunchState } = await import('../../../src/main/auto-updater/health');
    const { getUpdateStatus } = await import('../../../src/main/auto-updater');

    await trackPendingLaunchState();
    const status = await getUpdateStatus();
    expect(status.rollbackAvailable).toBe(false);
    expect(status.rollbackVersion).toBe('1.0.0');
    expect(status.lastError).toContain('连续启动异常');
    expect((await readState()).pendingLaunchAttempts).toBe(2);
  });

  it('主进程、窗口、渲染进程全部就绪后推进版本指针', async () => {
    await writeState({
      channel: 'stable',
      rolloutBucket: 1,
      lastKnownGoodVersion: '1.0.0',
      pendingVersion: '1.1.0',
      pendingFromVersion: '1.0.0',
      pendingLaunchAttempts: 1,
    });
    env.windows = [createFakeWindow()];
    const health = await import('../../../src/main/auto-updater/health');
    const updater = await import('../../../src/main/auto-updater');

    health.resetStartupHealthState();
    health.armHealthyStartupObservers();
    health.noteMainProcessReady();
    updater.noteUpdaterRendererReady();
    // 渲染进程尚未报告健康时不应推进
    expect((await readState()).lastKnownGoodVersion).toBe('1.0.0');

    updater.noteUpdaterRendererHealthy();
    await vi.waitFor(async () => {
      const state = await readState();
      expect(state.lastKnownGoodVersion).toBe('1.1.0');
      expect(state.pendingVersion).toBeNull();
      expect(state.pendingLaunchAttempts).toBe(0);
    });
  });

  it('使用版本绑定缓存自动安装，旧版本健康前保留待确认状态', async () => {
    const { rollbackAssetNames } = await import('../../../src/main/auto-updater/rollback-metadata');
    const assetName = rollbackAssetNames('1.0.0')[0];
    await mkdir(join(env.userData, 'rollback-cache'));
    const installerPath = join(
      env.userData,
      'rollback-cache',
      `${process.platform}-${process.arch}-${assetName}`
    );
    const content = Buffer.alloc(1_100_000, 7);
    await writeFile(installerPath, content);
    const hash = createHash('sha256').update(content).digest('hex');
    await writeState({
      channel: 'stable',
      rolloutBucket: 1,
      lastKnownGoodVersion: '1.0.0',
      rollbackTarget: {
        ...rollbackTarget,
        assetName,
        rollbackProtocol: 1,
        sha256: hash,
        platform: process.platform,
        arch: process.arch,
        cachedInstallerPath: installerPath,
        cachedInstallerHash: hash,
      },
      pendingVersion: '1.1.0',
      pendingFromVersion: '1.0.0',
      pendingLaunchAttempts: 2,
    });
    const { rollbackToPreviousVersion } = await import('../../../src/main/auto-updater');

    const result = await rollbackToPreviousVersion();
    expect(result).toEqual({ version: '1.0.0', installerPath });
    expect(env.openPath).not.toHaveBeenCalled();
    expect(env.install).toHaveBeenCalled();
    const state = await readState();
    expect(state.pendingVersion).toBe('1.1.0');
    expect(state.pendingLaunchAttempts).toBe(2);
    expect(state.rollbackPendingVersion).toBe('1.0.0');
  });

  it('the old binary confirms successful rollback only after its renderer becomes healthy', async () => {
    await writeState({
      lastKnownGoodVersion: '1.0.0',
      pendingVersion: '1.1.0',
      pendingFromVersion: '1.0.0',
      pendingLaunchAttempts: 2,
      rollbackPendingVersion: '1.0.0',
      rejectedVersion: '1.1.0',
    });
    env.version = '1.0.0';
    env.windows = [createFakeWindow()];
    const health = await import('../../../src/main/auto-updater/health');
    health.resetStartupHealthState();
    health.armHealthyStartupObservers();
    health.noteMainProcessReady();
    health.noteUpdaterRendererReady();
    expect((await readState()).pendingVersion).toBe('1.1.0');
    health.noteUpdaterRendererHealthy();
    await vi.waitFor(async () => {
      const state = await readState();
      expect(state.rollbackPendingVersion).toBeNull();
      expect(state.pendingVersion).toBeNull();
      expect(state.lastKnownGoodVersion).toBe('1.0.0');
      expect(state.rejectedVersion).toBe('1.1.0');
    });
  });

  it.each(['crash', 'timeout', 'repeated'])(
    'automatically installs the verified old release on %s',
    async (failure) => {
      const { rollbackAssetNames } = await import(
        '../../../src/main/auto-updater/rollback-metadata'
      );
      const assetName = rollbackAssetNames('1.0.0')[0];
      const bytes = Buffer.alloc(1_100_000, 7);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const path = join(
        env.userData,
        'rollback-cache',
        `${process.platform}-${process.arch}-${assetName}`
      );
      await mkdir(join(env.userData, 'rollback-cache'));
      await writeFile(path, bytes);
      await writeState({
        lastKnownGoodVersion: '1.0.0',
        pendingVersion: '1.1.0',
        pendingFromVersion: '1.0.0',
        pendingLaunchAttempts: 1,
        rollbackTarget: {
          ...rollbackTarget,
          rollbackProtocol: 1,
          platform: process.platform,
          arch: process.arch,
          assetName,
          sha256,
          cachedInstallerPath: path,
          cachedInstallerHash: sha256,
        },
      });
      const win = createFakeWindow();
      env.windows = [win];
      const health = await import('../../../src/main/auto-updater/health');
      if (failure === 'repeated') await health.trackPendingLaunchState();
      else {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        health.armHealthyStartupObservers();
        if (failure === 'crash') win.webContents.emit('render-process-gone');
        else await vi.advanceTimersByTimeAsync(60_000);
        vi.useRealTimers();
      }
      await vi.waitFor(() => expect(env.install).toHaveBeenCalledTimes(1));
      const state = await readState();
      expect(state.pendingVersion).toBe('1.1.0');
      expect(state.rollbackPendingVersion).toBe('1.0.0');
      health.resetStartupHealthState();
    }
  );

  it('没有回滚目标时拒绝回滚', async () => {
    await writeState({ channel: 'stable', rolloutBucket: 1, lastKnownGoodVersion: '1.0.0' });
    const { rollbackToPreviousVersion } = await import('../../../src/main/auto-updater');
    await expect(rollbackToPreviousVersion()).rejects.toThrow('当前没有可用的回退版本');
  });

  it('缓存安装包过小或 hash 不匹配时视为无效', async () => {
    const { isCachedInstallerValid } = await import('../../../src/main/auto-updater/rollback');
    const small = join(env.userData, 'small.dmg');
    await writeFile(small, 'tiny');
    expect(await isCachedInstallerValid(small)).toBe(false);
    expect(await isCachedInstallerValid(null)).toBe(false);

    const big = join(env.userData, 'big.dmg');
    await writeFile(big, Buffer.alloc(1_100_000, 1));
    expect(await isCachedInstallerValid(big)).toBe(false);
    expect(await isCachedInstallerValid(big, 'deadbeef')).toBe(false);
  });
});
