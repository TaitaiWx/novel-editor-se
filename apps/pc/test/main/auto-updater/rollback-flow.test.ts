import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { PersistedUpdaterState } from '../../../src/main/auto-updater-state';

// 用 vi.hoisted 共享可变的 Electron 模拟环境
const env = vi.hoisted(() => ({
  userData: '',
  version: '1.1.0',
  windows: [] as unknown[],
  openPath: vi.fn(async (_path: string) => ''),
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
    webContents: {
      send: vi.fn(),
      isCrashed: () => false,
      isLoadingMainFrame: () => false,
      getURL: () => 'file:///index.html',
      once: vi.fn(),
      removeListener: vi.fn(),
    },
  };
}

describe('auto-updater 版本指针与回滚流程', () => {
  beforeEach(async () => {
    vi.resetModules();
    env.userData = await mkdtemp(join(tmpdir(), 'ne-updater-'));
    env.version = '1.1.0';
    env.windows = [];
    env.openPath.mockClear();
  });

  afterEach(async () => {
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

  it('新版本连续启动失败后提示可回退', async () => {
    await writeState({
      channel: 'stable',
      rolloutBucket: 1,
      lastKnownGoodVersion: '1.0.0',
      rollbackTarget,
      pendingVersion: '1.1.0',
      pendingFromVersion: '1.0.0',
      pendingLaunchAttempts: 1,
    });
    const { trackPendingLaunchState } = await import('../../../src/main/auto-updater/health');
    const { getUpdateStatus } = await import('../../../src/main/auto-updater');

    await trackPendingLaunchState();
    const status = await getUpdateStatus();
    expect(status.rollbackAvailable).toBe(true);
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

  it('使用校验通过的本地缓存执行回滚并清除待确认状态', async () => {
    const installerPath = join(env.userData, 'installer.dmg');
    const content = Buffer.alloc(1_100_000, 7);
    await writeFile(installerPath, content);
    const hash = createHash('sha256').update(content).digest('hex');
    await writeState({
      channel: 'stable',
      rolloutBucket: 1,
      lastKnownGoodVersion: '1.0.0',
      rollbackTarget: {
        ...rollbackTarget,
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
    expect(env.openPath).toHaveBeenCalledWith(installerPath);
    const state = await readState();
    expect(state.pendingVersion).toBeNull();
    expect(state.pendingLaunchAttempts).toBe(0);
  });

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
    expect(await isCachedInstallerValid(big)).toBe(true);
    expect(await isCachedInstallerValid(big, 'deadbeef')).toBe(false);
  });
});
