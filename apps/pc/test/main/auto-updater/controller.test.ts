import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { rollbackAssetNames } from '../../../src/main/auto-updater/rollback-metadata';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { setTimeout as delay } from 'timers/promises';
import { join } from 'path';
import type { PersistedUpdaterState, RollbackTarget } from '../../../src/main/auto-updater-state';

// ─── 共享可变的模拟环境 ─────────────────────────────────────────────────────

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = false;
  allowDowngrade = false;
  channel: string | null = null;
  logger: unknown = null;
  setFeedURL = vi.fn();
  checkForUpdates = vi.fn(async (): Promise<unknown> => null);
  downloadUpdate = vi.fn(async (): Promise<unknown> => []);
  quitAndInstall = vi.fn();
}

interface SentMessage {
  channel: string;
  payload: unknown;
}

const env = vi.hoisted(() => ({
  userData: '',
  version: '1.1.0',
  isPackaged: true,
  sent: [] as { channel: string; payload: unknown }[],
  updater: null as unknown,
  updaterMissing: false,
  networkReachable: true,
  recoverFromNetwork: false,
  preCacheResult: null as unknown,
  preCacheError: null as Error | null,
  logError: vi.fn(),
  recoveryHandlers: null as null | {
    check: () => Promise<void>;
    download: () => Promise<void>;
  },
}));

vi.mock('electron', () => ({
  app: {
    getVersion: () => env.version,
    getPath: () => env.userData,
    get isPackaged() {
      return env.isPackaged;
    },
  },
  BrowserWindow: {
    getAllWindows: () => [
      {
        webContents: {
          send: (channel: string, payload: unknown) => {
            // 深拷贝快照，避免后续对 updaterStatus 的修改影响断言
            env.sent.push({
              channel,
              payload: payload === undefined ? undefined : JSON.parse(JSON.stringify(payload)),
            });
          },
        },
      },
    ],
  },
}));

vi.mock('../../../src/main/auto-updater/recovery', () => ({
  armUpdateRecovery: vi.fn(async () => ({
    commit: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
  })),
}));

vi.mock('../../../src/main/auto-updater/native-install', () => ({
  prepareNativeUpdate: vi.fn(async () => undefined),
  handoffNativeUpdate: async (updater: FakeUpdater) => {
    updater.quitAndInstall(true, true);
  },
}));

vi.mock('../../../src/main/graceful-shutdown', () => ({
  prepareAppForExit: vi.fn(async (exit: () => void | Promise<void>) => {
    await exit();
    return true;
  }),
}));

vi.mock('electron-log/main', () => {
  const noop = () => undefined;
  return {
    default: {
      info: noop,
      warn: noop,
      error: (...args: unknown[]) => env.logError(...args),
      initialize: noop,
      transports: { file: { level: 'info' } },
    },
  };
});

// 工厂结果会被缓存（resetModules 不清 mock 注册表），因此用 getter 每次读取最新 updater；
// updaterMissing=true 时模拟 electron-updater 未导出 autoUpdater（加载失败降级路径）
vi.mock('electron-updater', () => ({
  get autoUpdater() {
    return env.updaterMissing ? undefined : env.updater;
  },
}));

vi.mock('../../../src/main/device-id', () => ({ getDeviceId: () => 'device-test' }));

vi.mock('../../../src/main/resilient-downloader', () => ({
  cleanupStaleDownloads: vi.fn(async () => undefined),
}));

vi.mock('../../../src/main/auto-updater/health', () => ({
  armHealthyStartupObservers: vi.fn(),
  noteMainProcessReady: vi.fn(),
  resetStartupHealthState: vi.fn(),
  trackPendingLaunchState: vi.fn(async () => undefined),
}));

vi.mock('../../../src/main/auto-updater/rollback', () => ({
  isRollbackInProgress: () => false,
  isCachedInstallerValid: vi.fn(async () => true),
  getRollbackCacheDir: () => join(env.userData, 'rollback-cache'),
  preCacheCurrentVersion: vi.fn(async () => {
    if (env.preCacheError) throw env.preCacheError;
    return env.preCacheResult;
  }),
}));

vi.mock('../../../src/main/auto-updater/network', () => ({
  armDownloadStallWatch: vi.fn(),
  clearDownloadStallTimer: vi.fn(),
  clearPendingRecoveryAction: vi.fn(),
  clearRecoveryProbeTimer: vi.fn(),
  probeUpdateNetwork: vi.fn(async () => env.networkReachable),
  queueRecovery: vi.fn(),
  registerRecoveryHandlers: vi.fn((handlers: typeof env.recoveryHandlers) => {
    env.recoveryHandlers = handlers;
  }),
  shouldRecoverFromNetwork: vi.fn(async () => env.recoverFromNetwork),
}));

// ─── 工具函数 ──────────────────────────────────────────────────────────────

let rollbackTarget: RollbackTarget;

async function writeState(state: Partial<PersistedUpdaterState>) {
  await writeFile(join(env.userData, 'updater-state.json'), JSON.stringify(state), 'utf8');
}

async function readState(): Promise<PersistedUpdaterState> {
  return JSON.parse(await readFile(join(env.userData, 'updater-state.json'), 'utf8'));
}

function fakeUpdater(): FakeUpdater {
  return env.updater as FakeUpdater;
}

function sentOn(channel: string): SentMessage[] {
  return env.sent.filter((m) => m.channel === channel);
}

interface StatusSnapshot {
  checking: boolean;
  updateReady: boolean;
  availableVersion: string | null;
  downloadPercent: number | null;
  lastError: string | null;
  rolloutEligible: boolean | null;
  rolloutPercentage: number | null;
  preCaching: boolean;
  rollbackAvailable: boolean;
  rollbackVersion: string | null;
  pendingVersion: string | null;
  downloadedVersion: string | null;
  channelVersion: string | null;
}

function lastStatus(): StatusSnapshot {
  const all = sentOn('update-state-changed');
  return all[all.length - 1].payload as StatusSnapshot;
}

async function loadController() {
  const controller = await import('../../../src/main/auto-updater/controller');
  const network = await import('../../../src/main/auto-updater/network');
  const health = await import('../../../src/main/auto-updater/health');
  const rollback = await import('../../../src/main/auto-updater/rollback');
  const downloader = await import('../../../src/main/resilient-downloader');
  const { updaterStatus } = await import('../../../src/main/auto-updater/status');
  return { controller, network, health, rollback, downloader, updaterStatus };
}

/** 跑完微任务和真实 fs I/O（setImmediate 不被 fake） */
async function flush(times = 20) {
  for (let i = 0; i < times; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** 等待真实 I/O 完成；用真实时间限额，不推进 fake timers 或依赖事件循环转数。 */
async function waitUntil(predicate: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) {
    await delay(5);
  }
  if (!predicate()) throw new Error('waitUntil 超时');
}

/** 等待后台预缓存流程结束（出现 preCaching=true 之后又广播了 preCaching=false） */
async function waitForPreCacheSettled() {
  await waitUntil(() => {
    const snapshots = sentOn('update-state-changed').map((m) => m.payload as StatusSnapshot);
    const startIdx = snapshots.findIndex((p) => p.preCaching);
    // The controller emits this final transition only after persistence settles.
    // Event-loop turns are not an I/O deadline, especially on a busy CI worker.
    return startIdx >= 0 && snapshots.slice(startIdx + 1).some((p) => !p.preCaching);
  });
}

// ─── 测试 ──────────────────────────────────────────────────────────────────

describe('auto-updater controller', () => {
  beforeEach(async () => {
    vi.stubEnv('APPIMAGE', '/test/Novel.AppImage');
    // Asset selection depends on APPIMAGE, so construct the fixture after setting the environment.
    rollbackTarget = {
      version: '1.0.0',
      tag: 'v1.0.0',
      rollbackProtocol: 1,
      sha256: 'a'.repeat(64),
      platform: process.platform,
      arch: process.arch,
      assetName: rollbackAssetNames('1.0.0')[0],
      assetUrl: 'https://example.invalid/installer.dmg',
      cachedInstallerPath: '/tmp/installer.dmg',
      cachedInstallerHash: 'abc',
    };
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    env.userData = await mkdtemp(join(tmpdir(), 'ne-controller-'));
    env.version = '1.1.0';
    env.isPackaged = true;
    env.sent = [];
    env.updater = new FakeUpdater();
    env.updaterMissing = false;
    env.networkReachable = true;
    env.recoverFromNetwork = false;
    env.preCacheResult = null;
    env.preCacheError = null;
    env.recoveryHandlers = null;
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await rm(env.userData, { recursive: true, force: true });
  });

  it('模块加载时注册网络恢复回调', async () => {
    const { controller } = await loadController();
    expect(env.recoveryHandlers?.check).toBe(controller.checkForUpdatesManually);
    expect(env.recoveryHandlers?.download).toBe(controller.downloadUpdate);
  });

  describe('setupAutoUpdater', () => {
    it('开发模式跳过初始化', async () => {
      env.isPackaged = false;
      const { controller, health } = await loadController();
      await controller.setupAutoUpdater();
      expect(health.resetStartupHealthState).not.toHaveBeenCalled();
      expect(fakeUpdater().listenerCount('update-available')).toBe(0);
      expect(lastStatus().checking).toBe(false);
    });

    it('electron-updater 加载失败时降级并报告原因', async () => {
      env.updaterMissing = true;
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { controller } = await loadController();
      await controller.setupAutoUpdater();
      expect(lastStatus().lastError).toContain('自动更新模块不可用，已降级');
      errSpy.mockRestore();
    });

    it('打包模式下配置 updater、注册监听、启动定时检查', async () => {
      // 内部测试用的环境变量覆盖通道（用户界面不提供选择）
      vi.stubEnv('NOVEL_EDITOR_UPDATE_CHANNEL', 'beta');
      await writeState({ channel: 'beta', rolloutBucket: 10, lastKnownGoodVersion: '1.1.0' });
      const { controller, health, downloader } = await loadController();
      await controller.setupAutoUpdater();

      const updater = fakeUpdater();
      expect(updater.channel).toBe('beta');
      expect(updater.allowPrerelease).toBe(true);
      expect(updater.autoDownload).toBe(false);
      expect(updater.autoInstallOnAppQuit).toBe(false);
      expect(updater.setFeedURL).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'generic',
          requestHeaders: { 'X-Device-Id': 'device-test' },
        })
      );
      expect(health.resetStartupHealthState).toHaveBeenCalled();
      expect(health.trackPendingLaunchState).toHaveBeenCalled();
      expect(health.armHealthyStartupObservers).toHaveBeenCalled();
      expect(health.noteMainProcessReady).toHaveBeenCalled();
      expect(downloader.cleanupStaleDownloads).toHaveBeenCalledWith(
        join(env.userData, 'rollback-cache')
      );
      for (const evt of [
        'checking-for-update',
        'update-available',
        'update-not-available',
        'download-progress',
        'update-downloaded',
        'error',
      ]) {
        expect(updater.listenerCount(evt)).toBe(1);
      }

      // 首次检查延迟 10s
      expect(updater.checkForUpdates).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(10_000);
      await flush();
      expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);

      // 定时检查（6h + 抖动，最多 6.5h）
      await vi.advanceTimersByTimeAsync(6.5 * 60 * 60 * 1000);
      await flush();
      expect(updater.checkForUpdates.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('重复调用不会重复注册监听，并替换定时器（含首次检查 timeout）', async () => {
      const { controller } = await loadController();
      await controller.setupAutoUpdater();
      await controller.setupAutoUpdater();
      expect(fakeUpdater().listenerCount('update-available')).toBe(1);
      expect(vi.getTimerCount()).toBe(2); // 1 个 interval + 1 个首次检查 timeout

      // 首次检查只触发一次
      await vi.advanceTimersByTimeAsync(10_000);
      await flush();
      expect(fakeUpdater().checkForUpdates).toHaveBeenCalledTimes(1);
    });

    it('清理残留下载失败时不抛错', async () => {
      const { controller, downloader } = await loadController();
      vi.mocked(downloader.cleanupStaleDownloads).mockRejectedValueOnce(new Error('eperm'));
      await expect(controller.setupAutoUpdater()).resolves.toBeUndefined();
      await flush();
    });
  });

  describe('updater 事件', () => {
    async function setup(state?: Partial<PersistedUpdaterState>) {
      if (state) await writeState(state);
      const ctx = await loadController();
      await ctx.controller.setupAutoUpdater();
      env.sent = [];
      return ctx;
    }

    it('checking-for-update 置 checking 并清空错误', async () => {
      const { updaterStatus } = await setup();
      updaterStatus.lastError = 'old';
      fakeUpdater().emit('checking-for-update');
      expect(lastStatus().checking).toBe(true);
      expect(lastStatus().lastError).toBeNull();
    });

    it('update-available 广播并按灰度分桶计算资格（命中）', async () => {
      const { network } = await setup({
        channel: 'canary',
        rolloutBucket: 5,
        lastKnownGoodVersion: '1.1.0',
      });
      fakeUpdater().emit('update-available', { version: '1.2.0', stagingPercentage: 10 });
      await flush();
      expect(network.clearDownloadStallTimer).toHaveBeenCalled();
      expect(network.clearRecoveryProbeTimer).toHaveBeenCalled();
      expect(network.clearPendingRecoveryAction).toHaveBeenCalled();
      expect(sentOn('update-available')[0].payload).toEqual({
        version: '1.2.0',
        stagingPercentage: 10,
      });
      const s = lastStatus();
      expect(s.availableVersion).toBe('1.2.0');
      expect(s.rolloutPercentage).toBe(10);
      expect(s.rolloutEligible).toBe(true);
      expect(s.lastError).toBeNull();
    });

    it('update-available 灰度未命中时 rolloutEligible=false', async () => {
      await setup({ channel: 'stable', rolloutBucket: 90, lastKnownGoodVersion: '1.1.0' });
      fakeUpdater().emit('update-available', { version: '1.2.0', stagingPercentage: 10 });
      await flush();
      expect(lastStatus().rolloutEligible).toBe(false);
    });

    it('update-not-available 清空 availableVersion', async () => {
      const { updaterStatus } = await setup();
      updaterStatus.availableVersion = '9.9.9';
      updaterStatus.checking = true;
      fakeUpdater().emit('update-not-available', { version: '1.1.0' });
      await flush();
      expect(sentOn('update-not-available')).toHaveLength(1);
      const s = lastStatus();
      expect(s.availableVersion).toBeNull();
      expect(s.checking).toBe(false);
      expect(s.channelVersion).toBe('1.1.0');
      expect(s.rolloutEligible).toBeNull();
    });

    it('download-progress 更新进度并启动卡顿监测', async () => {
      const { network } = await setup();
      fakeUpdater().emit('download-progress', { percent: 42 });
      expect(network.armDownloadStallWatch).toHaveBeenCalled();
      expect(sentOn('update-download-progress')[0].payload).toEqual({ percent: 42 });
      expect(lastStatus().downloadPercent).toBe(42);

      fakeUpdater().emit('download-progress', { percent: 0 });
      expect(lastStatus().downloadPercent).toBe(0);
    });

    it('update-downloaded 持久化 pending 版本并在后台预缓存回滚包', async () => {
      env.preCacheResult = rollbackTarget;
      const { rollback } = await setup({
        channel: 'stable',
        rolloutBucket: 1,
        lastKnownGoodVersion: '1.1.0',
      });
      fakeUpdater().emit('update-downloaded', { version: '1.2.0' });
      await waitForPreCacheSettled();

      expect(sentOn('update-downloaded')).toHaveLength(1);
      expect(rollback.preCacheCurrentVersion).toHaveBeenCalled();
      const persisted = await readState();
      expect(persisted.pendingVersion).toBe('1.2.0');
      expect(persisted.pendingFromVersion).toBe('1.1.0');
      expect(persisted.pendingLaunchAttempts).toBe(0);
      expect(persisted.rollbackTarget?.version).toBe('1.0.0');

      const s = lastStatus();
      expect(s.updateReady).toBe(true);
      expect(s.downloadPercent).toBe(100);
      expect(s.downloadedVersion).toBe('1.2.0');
      expect(s.pendingVersion).toBe('1.2.0');
      expect(s.preCaching).toBe(false);
      expect(s.rollbackAvailable).toBe(true);
      expect(s.rollbackVersion).toBe('1.0.0');
      // 预缓存期间广播过 preCaching=true
      expect(
        sentOn('update-state-changed').some((m) => (m.payload as StatusSnapshot).preCaching)
      ).toBe(true);
      expect(sentOn('update-rollback-available').length).toBeGreaterThan(0);
    });

    it('预缓存被I/O门控超过500轮事件循环时仍等待最终状态再读取持久化结果', async () => {
      const { rollback } = await setup();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.mocked(rollback.preCacheCurrentVersion).mockImplementationOnce(async () => {
        await gate;
        return rollbackTarget;
      });
      fakeUpdater().emit('update-downloaded', { version: '1.2.0' });
      await waitUntil(() =>
        sentOn('update-state-changed').some(
          (message) => (message.payload as StatusSnapshot).preCaching
        )
      );
      let outcome = 'pending';
      const waiter = waitForPreCacheSettled().then(
        () => {
          outcome = 'resolved';
        },
        () => {
          outcome = 'rejected';
        }
      );
      try {
        // Exercise the former iteration ceiling while actual completion is gated.
        await flush(600);
        expect(outcome).toBe('pending');
      } finally {
        release();
        // Drain the real persistence operation even if the regression assertion fails.
        await waitUntil(() => !lastStatus().preCaching);
        await waiter;
      }
      expect(outcome).toBe('resolved');
      expect((await readState()).rollbackTarget?.version).toBe(rollbackTarget.version);
    });

    it('预缓存结果无本地安装包时仍记录回滚目标', async () => {
      env.preCacheResult = { ...rollbackTarget, cachedInstallerPath: null };
      await setup();
      fakeUpdater().emit('update-downloaded', { version: '1.2.0' });
      await waitForPreCacheSettled();
      expect((await readState()).rollbackTarget?.cachedInstallerPath).toBeNull();
      expect(lastStatus().rollbackAvailable).toBe(true);
    });

    it('预缓存失败（返回 null）时不可回滚', async () => {
      env.preCacheResult = null;
      await setup();
      fakeUpdater().emit('update-downloaded', { version: '1.2.0' });
      await waitForPreCacheSettled();
      const s = lastStatus();
      expect(s.rollbackAvailable).toBe(false);
      expect(s.preCaching).toBe(false);
    });

    it('预缓存抛错时保持 preCaching=false', async () => {
      env.preCacheError = new Error('disk full');
      await setup();
      fakeUpdater().emit('update-downloaded', { version: '1.2.0' });
      await waitForPreCacheSettled();
      expect(lastStatus().preCaching).toBe(false);
      expect(lastStatus().updateReady).toBe(true);
    });

    it('update-downloaded 处理异常时被捕获', async () => {
      await setup();
      // 让 userData 指向一个文件，导致持久化失败
      const blocker = join(env.userData, 'blocker');
      await writeFile(blocker, 'x');
      const originalUserData = env.userData;
      env.userData = blocker;
      try {
        fakeUpdater().emit('update-downloaded', { version: '1.2.0' });
        await waitUntil(() => env.logError.mock.calls.length > 0);
      } finally {
        env.userData = originalUserData;
      }
      expect(env.logError).toHaveBeenCalledWith('处理已下载更新失败:', expect.any(Error));
      expect(sentOn('update-downloaded')).toHaveLength(0);
    });

    it('error 为网络错误时排队恢复（无可用版本 → check）', async () => {
      env.recoverFromNetwork = true;
      const { network } = await setup();
      fakeUpdater().emit('error', new Error('net::ERR'));
      await flush();
      expect(network.clearDownloadStallTimer).toHaveBeenCalled();
      expect(network.queueRecovery).toHaveBeenCalledWith('check', '更新网络暂不可用');
    });

    it('error 为网络错误且有待下载版本时排队恢复下载', async () => {
      env.recoverFromNetwork = true;
      const { network, updaterStatus } = await setup();
      updaterStatus.availableVersion = '1.2.0';
      updaterStatus.updateReady = false;
      fakeUpdater().emit('error', new Error('net::ERR'));
      await flush();
      expect(network.queueRecovery).toHaveBeenCalledWith('download', '更新网络暂不可用');
    });

    it('非网络错误记录 lastError；无可用版本时不重试下载', async () => {
      await setup();
      fakeUpdater().emit('error', new Error('bad signature'));
      await flush();
      expect(lastStatus().lastError).toBe('bad signature');
      expect(lastStatus().checking).toBe(false);
      expect(vi.getTimerCount()).toBe(2); // 仅 interval + 首次检查
    });

    it('下载失败按退避重试，最多 3 次', async () => {
      const { updaterStatus } = await setup();
      updaterStatus.availableVersion = '1.2.0';
      updaterStatus.updateReady = false;
      const updater = fakeUpdater();

      for (let i = 1; i <= 3; i++) {
        updater.emit('error', new Error('checksum mismatch'));
        await flush();
        // 退避上限 60s * 2^(i-1) * 1.25
        await vi.advanceTimersByTimeAsync(60_000 * Math.pow(2, i - 1) * 1.25 + 1);
        await flush();
        expect(updater.downloadUpdate).toHaveBeenCalledTimes(i);
      }

      updater.emit('error', new Error('checksum mismatch'));
      await flush();
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      await flush();
      expect(updater.downloadUpdate).toHaveBeenCalledTimes(3);
    });

    it('新的 update-available 会重置下载失败计数', async () => {
      const { updaterStatus } = await setup();
      updaterStatus.availableVersion = '1.2.0';
      const updater = fakeUpdater();
      for (let i = 0; i < 4; i++) {
        updater.emit('error', new Error('x'));
        await flush();
      }
      // 丢弃之前排队的重试，只观察重置后的行为
      vi.clearAllTimers();
      updater.emit('update-available', { version: '1.3.0' });
      await flush();
      updater.downloadUpdate.mockClear();
      updater.emit('error', new Error('x'));
      await flush();
      await vi.advanceTimersByTimeAsync(75_001);
      await flush();
      expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkForUpdatesManually', () => {
    it('开发模式下直接返回错误', async () => {
      env.isPackaged = false;
      const { controller } = await loadController();
      await controller.checkForUpdatesManually();
      expect(lastStatus().lastError).toBe('开发模式下不支持检查更新');
      expect(fakeUpdater().checkForUpdates).not.toHaveBeenCalled();
    });

    it('updater 不可用时报告降级', async () => {
      env.updaterMissing = true;
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { controller } = await loadController();
      await controller.checkForUpdatesManually();
      expect(lastStatus().lastError).toContain('自动更新模块不可用，已降级');
      expect(lastStatus().checking).toBe(false);
      errSpy.mockRestore();
    });

    it('网络不可达时排队恢复，不调用 checkForUpdates', async () => {
      env.networkReachable = false;
      const { controller, network } = await loadController();
      await controller.checkForUpdatesManually();
      expect(network.queueRecovery).toHaveBeenCalledWith('check', '更新源暂不可达');
      expect(fakeUpdater().checkForUpdates).not.toHaveBeenCalled();
    });

    it('检查成功时按结果同步灰度信息', async () => {
      await writeState({ channel: 'stable', rolloutBucket: 50, lastKnownGoodVersion: '1.1.0' });
      const { controller } = await loadController();
      fakeUpdater().checkForUpdates.mockResolvedValueOnce({
        updateInfo: { version: '1.3.0', stagingPercentage: 60 },
      });
      await controller.checkForUpdatesManually();
      const s = lastStatus();
      expect(s.channelVersion).toBe('1.3.0');
      expect(s.rolloutPercentage).toBe(60);
      expect(s.rolloutEligible).toBe(true);
      expect(fakeUpdater().channel).toBe('latest');
      expect(fakeUpdater().allowPrerelease).toBe(false);
    });

    it('never downloads a version rejected by a completed rollback', async () => {
      await writeState({ rejectedVersion: '1.3.0' });
      const { controller } = await loadController();
      fakeUpdater().checkForUpdates.mockResolvedValueOnce({
        isUpdateAvailable: true,
        updateInfo: { version: '1.3.0' },
      });
      await controller.checkForUpdatesManually();
      await flush();
      expect(fakeUpdater().downloadUpdate).not.toHaveBeenCalled();
    });

    it('检查进行中时忽略并发调用', async () => {
      const { controller } = await loadController();
      let release: (v: null) => void = () => undefined;
      fakeUpdater().checkForUpdates.mockImplementationOnce(
        () => new Promise<null>((resolve) => (release = resolve))
      );
      const first = controller.checkForUpdatesManually();
      await waitUntil(() => fakeUpdater().checkForUpdates.mock.calls.length === 1);
      await controller.checkForUpdatesManually();
      expect(fakeUpdater().checkForUpdates).toHaveBeenCalledTimes(1);
      release(null);
      await first;
      await controller.checkForUpdatesManually();
      expect(fakeUpdater().checkForUpdates).toHaveBeenCalledTimes(2);
    });

    it('检查抛出网络错误时排队恢复', async () => {
      const { controller, network } = await loadController();
      fakeUpdater().checkForUpdates.mockRejectedValueOnce(new Error('ETIMEDOUT'));
      vi.mocked(network.shouldRecoverFromNetwork).mockResolvedValueOnce(true);
      await controller.checkForUpdatesManually();
      expect(network.queueRecovery).toHaveBeenCalledWith('check', '检查更新时网络异常');
    });

    it('检查失败时记录错误并指数退避重试', async () => {
      const { controller } = await loadController();
      const updater = fakeUpdater();
      updater.checkForUpdates.mockRejectedValueOnce(new Error('404'));
      await controller.checkForUpdatesManually();
      expect(lastStatus().lastError).toBe('检查更新失败: 404');
      expect(lastStatus().checking).toBe(false);

      // 第 1 次失败 → 60s 后重试
      updater.checkForUpdates.mockRejectedValueOnce('weird');
      await vi.advanceTimersByTimeAsync(60_000);
      await flush();
      expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
      expect(lastStatus().lastError).toBe('检查更新失败: 未知错误');

      // 第 2 次失败 → 120s 后重试（60s 时尚未触发）
      await vi.advanceTimersByTimeAsync(60_000);
      await flush();
      expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(60_000);
      await flush();
      expect(updater.checkForUpdates).toHaveBeenCalledTimes(3);
    });
  });

  describe('downloadUpdate', () => {
    it('updater 不可用时报告降级', async () => {
      env.updaterMissing = true;
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { controller } = await loadController();
      await controller.downloadUpdate();
      expect(lastStatus().lastError).toContain('自动更新模块不可用，已降级');
      errSpy.mockRestore();
    });

    it('网络不可达时排队恢复下载', async () => {
      env.networkReachable = false;
      const { controller, network } = await loadController();
      await controller.downloadUpdate();
      expect(network.queueRecovery).toHaveBeenCalledWith('download', '下载更新前网络不可达');
      expect(fakeUpdater().downloadUpdate).not.toHaveBeenCalled();
    });

    it('成功下载并启动卡顿监测', async () => {
      const { controller, network } = await loadController();
      await controller.downloadUpdate();
      expect(network.armDownloadStallWatch).toHaveBeenCalled();
      expect(fakeUpdater().downloadUpdate).toHaveBeenCalledTimes(1);
    });

    it('下载进行中时忽略并发调用', async () => {
      const { controller } = await loadController();
      let release: (v: string[]) => void = () => undefined;
      fakeUpdater().downloadUpdate.mockImplementationOnce(
        () => new Promise<string[]>((resolve) => (release = resolve))
      );
      const first = controller.downloadUpdate();
      await waitUntil(() => fakeUpdater().downloadUpdate.mock.calls.length === 1);
      await controller.downloadUpdate();
      expect(fakeUpdater().downloadUpdate).toHaveBeenCalledTimes(1);
      release([]);
      await first;
    });

    it('下载网络异常时排队恢复', async () => {
      const { controller, network } = await loadController();
      fakeUpdater().downloadUpdate.mockRejectedValueOnce(new Error('ECONNRESET'));
      vi.mocked(network.shouldRecoverFromNetwork).mockResolvedValueOnce(true);
      await controller.downloadUpdate();
      expect(network.clearDownloadStallTimer).toHaveBeenCalled();
      expect(network.queueRecovery).toHaveBeenCalledWith('download', '下载更新时网络异常');
    });

    it('下载非网络失败时记录错误', async () => {
      const { controller } = await loadController();
      fakeUpdater().downloadUpdate.mockRejectedValueOnce(new Error('sha512 mismatch'));
      await controller.downloadUpdate();
      expect(lastStatus().lastError).toBe('下载更新失败: sha512 mismatch');
      fakeUpdater().downloadUpdate.mockRejectedValueOnce(42);
      await controller.downloadUpdate();
      expect(lastStatus().lastError).toBe('下载更新失败: 未知错误');
    });
  });

  describe('installUpdate', () => {
    it('verified rollback cache and coordinated save precede installation', async () => {
      const { rollbackAssetNames } = await import(
        '../../../src/main/auto-updater/rollback-metadata'
      );
      env.preCacheResult = {
        ...rollbackTarget,
        version: env.version,
        tag: `v${env.version}`,
        assetName: rollbackAssetNames(env.version)[0],
        platform: process.platform,
        arch: process.arch,
        rollbackProtocol: 1,
        sha256: 'a'.repeat(64),
      };
      const { controller, updaterStatus } = await loadController();
      updaterStatus.updateReady = true;
      await writeState({ pendingVersion: '1.2.0' });
      await controller.installUpdate();
      expect(fakeUpdater().quitAndInstall).toHaveBeenCalledWith(true, true);
    });

    it('refuses installation when the external guardian cannot arm', async () => {
      env.preCacheResult = {
        ...rollbackTarget,
        version: env.version,
        tag: `v${env.version}`,
        assetName: rollbackAssetNames(env.version)[0],
      };
      const { controller, updaterStatus } = await loadController();
      const { armUpdateRecovery } = await import('../../../src/main/auto-updater/recovery');
      vi.mocked(armUpdateRecovery).mockRejectedValueOnce(new Error('guardian unavailable'));
      updaterStatus.updateReady = true;
      await writeState({ pendingVersion: '1.2.0' });
      await expect(controller.installUpdate()).rejects.toThrow('guardian unavailable');
      expect(fakeUpdater().quitAndInstall).not.toHaveBeenCalled();
    });

    it('does not quit when a verified fallback cannot be prepared', async () => {
      const { controller, updaterStatus } = await loadController();
      updaterStatus.updateReady = true;
      await writeState({ pendingVersion: '1.2.0' });
      await expect(controller.installUpdate()).rejects.toThrow('恢复包尚未校验完成');
      expect(fakeUpdater().quitAndInstall).not.toHaveBeenCalled();
    });

    it('does not quit when coordinated save rejects installation', async () => {
      env.preCacheResult = {
        ...rollbackTarget,
        version: env.version,
        tag: `v${env.version}`,
        assetName: rollbackAssetNames(env.version)[0],
      };
      const { controller, updaterStatus } = await loadController();
      const { prepareAppForExit } = await import('../../../src/main/graceful-shutdown');
      vi.mocked(prepareAppForExit).mockResolvedValueOnce(false);
      updaterStatus.updateReady = true;
      await writeState({ pendingVersion: '1.2.0' });
      await expect(controller.installUpdate()).rejects.toThrow('取消安装更新');
      expect(fakeUpdater().quitAndInstall).not.toHaveBeenCalled();
    });

    it('updater 不可用时抛错', async () => {
      env.updaterMissing = true;
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { controller } = await loadController();
      await expect(controller.installUpdate()).rejects.toThrow('自动更新模块不可用，已降级');
      errSpy.mockRestore();
    });
  });

  describe('getUpdateStatus', () => {
    it.each([
      { platform: 'darwin', assetName: 'Novel-Editor-1.0.0-mac-x64.zip', appImage: '' },
      { platform: 'win32', assetName: 'Novel-Editor-1.0.0-win-x64.exe', appImage: '' },
      {
        platform: 'linux',
        assetName: 'Novel-Editor-1.0.0-linux-x64.AppImage',
        appImage: '/app/Novel.AppImage',
      },
      { platform: 'linux', assetName: 'Novel-Editor-1.0.0-linux-amd64.deb', appImage: '' },
    ])('recognizes a bound rollback artifact $assetName on $platform', async (fixture) => {
      vi.stubGlobal('process', { ...process, platform: fixture.platform, arch: 'x64' });
      vi.stubEnv('APPIMAGE', fixture.appImage);
      await writeState({
        rollbackTarget: {
          ...rollbackTarget,
          platform: fixture.platform,
          arch: 'x64',
          assetName: fixture.assetName,
        },
      });
      const { controller } = await loadController();
      expect((await controller.getUpdateStatus()).rollbackAvailable).toBe(true);
    });

    it('getUpdateStatus 从持久化状态填充快照（通道来自内部环境变量覆盖）', async () => {
      vi.stubEnv('NOVEL_EDITOR_UPDATE_CHANNEL', 'beta');
      await writeState({
        channel: 'beta',
        rolloutBucket: 77,
        lastKnownGoodVersion: '1.0.0',
        rollbackTarget,
        pendingVersion: '1.1.0',
        pendingFromVersion: '1.0.0',
        pendingLaunchAttempts: 1,
      });
      const { controller } = await loadController();
      const status = await controller.getUpdateStatus();
      expect(status.channel).toBe('beta');
      expect(status.channelFile).toMatch(/^beta/);
      expect(status.currentVersion).toBe('1.1.0');
      expect(status.rolloutBucket).toBe(77);
      expect(status.rollbackAvailable).toBe(true);
      expect(status.rollbackVersion).toBe('1.0.0');
      expect(status.pendingVersion).toBe('1.1.0');
      expect(status.lastError).toBeNull();
    });

    it('getUpdateStatus 在 updater 加载失败后附带降级信息', async () => {
      env.updaterMissing = true;
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { controller } = await loadController();
      await controller.downloadUpdate(); // 触发加载失败
      const { updaterStatus } = await loadController();
      updaterStatus.lastError = null;
      const status = await controller.getUpdateStatus();
      expect(status.lastError).toContain('自动更新模块不可用，已降级');
      errSpy.mockRestore();
    });

    it('旧版持久化的用户通道选择不再生效：按版本号推断并写回', async () => {
      await writeState({ channel: 'canary', rolloutBucket: 3, lastKnownGoodVersion: '1.1.0' });
      const { controller } = await loadController();
      const status = await controller.getUpdateStatus();
      expect(status.channel).toBe('stable');
      expect(status.channelFile).toMatch(/^latest/);
      expect((await readState()).channel).toBe('stable');
      expect('setUpdateChannel' in controller).toBe(false);
    });
  });

  describe('网络恢复回调', () => {
    it('恢复回调触发检查与下载', async () => {
      await loadController();
      await env.recoveryHandlers?.check();
      await env.recoveryHandlers?.download();
      expect(fakeUpdater().checkForUpdates).toHaveBeenCalledTimes(1);
      expect(fakeUpdater().downloadUpdate).toHaveBeenCalledTimes(1);
    });
  });
});
