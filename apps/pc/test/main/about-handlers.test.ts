import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── electron mock：捕获 ipcMain.handle 注册 ───

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  paths: {} as Record<string, string>,
  isPackaged: false,
  version: '1.2.0-beta.3',
  writeText: vi.fn(),
  updateStatus: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    },
  },
  clipboard: { writeText: mocks.writeText },
  app: {
    get isPackaged() {
      return mocks.isPackaged;
    },
    getPath: (name: string) => {
      const value = mocks.paths[name];
      if (!value) throw new Error(`unknown path ${name}`);
      return value;
    },
    getVersion: () => mocks.version,
    getName: () => 'Novel Editor',
  },
}));

vi.mock('../../src/main/auto-updater', () => ({
  getUpdateStatus: mocks.updateStatus,
}));

import { registerAboutHandlers } from '../../src/main/handlers/about';
import type { AboutInfo } from '../../src/shared/about';

function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const handler: Handler | undefined = mocks.handlers.get(channel);
  if (!handler) throw new Error(`未注册的通道: ${channel}`);
  return Promise.resolve(handler({}, ...args)) as Promise<T>;
}

let root: string;

beforeAll(() => {
  registerAboutHandlers();
});

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'ne-about-'));
  mocks.paths = {
    userData: path.join(root, 'userData'),
    logs: path.join(root, 'logs'),
    documents: path.join(root, 'documents'),
  };
  mocks.isPackaged = false;
  mocks.version = '1.2.0-beta.3';
  mocks.writeText.mockClear();
  mocks.updateStatus.mockReset();
  mocks.updateStatus.mockResolvedValue({
    channel: 'canary',
    rolloutBucket: 42,
    rolloutPercentage: 50,
    rolloutEligible: true,
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('get-about-info', () => {
  it('返回版本、通道、灰度分组、完整设备 ID、首次运行与本次启动时间', async () => {
    const before = Date.now();
    const info = await invoke<AboutInfo>('get-about-info');
    expect(info.appName).toBe('小说编辑器');
    expect(info.productName).toBe('Novel Editor');
    expect(info.version).toBe('1.2.0-beta.3');
    expect(info.releaseChannel).toBe('beta');
    expect(info.updateChannel).toBe('canary');
    expect(info.rollout).toEqual({
      bucket: 42,
      percentage: 50,
      eligible: true,
      canaryEnrolled: true,
    });
    // 设备 ID 与 userData/device-id 文件一致（完整 UUID）
    const stored = readFileSync(path.join(mocks.paths.userData, 'device-id'), 'utf-8');
    expect(info.deviceId).toBe(stored);
    expect(info.deviceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(info.firstRunAt && Number.isNaN(Date.parse(info.firstRunAt))).toBe(false);
    // 本次启动时间来自主进程（进程启动时刻），不晚于当前时间
    const startedAt = Date.parse(info.startedAt);
    expect(startedAt).toBeLessThanOrEqual(before);
    expect(startedAt).toBeGreaterThan(before - process.uptime() * 1000 - 5_000);
    // 诊断信息不再通过关于接口返回
    expect(info).not.toHaveProperty('runtime');
    expect(info).not.toHaveProperty('directories');
    expect(info).not.toHaveProperty('links');
  });

  it('更新模块不可用时按版本号推断通道', async () => {
    mocks.version = '1.3.0-alpha.1';
    mocks.updateStatus.mockRejectedValue(new Error('updater unavailable'));
    const info = await invoke<AboutInfo>('get-about-info');
    expect(info.releaseChannel).toBe('alpha');
    expect(info.updateChannel).toBe('canary');
    expect(info.rollout).toEqual({
      bucket: 0,
      percentage: null,
      eligible: null,
      canaryEnrolled: true,
    });
  });

  it('不再注册打开目录 / 外部链接的通道', () => {
    expect(mocks.handlers.has('about-open-directory')).toBe(false);
    expect(mocks.handlers.has('about-open-link')).toBe(false);
  });
});

describe('about-copy-text', () => {
  it('写入剪贴板并拒绝非法或超长文本', async () => {
    await expect(invoke('about-copy-text', '设备 ID')).resolves.toEqual({ success: true });
    expect(mocks.writeText).toHaveBeenCalledWith('设备 ID');
    await expect(invoke('about-copy-text', '')).resolves.toEqual({ success: false });
    await expect(invoke('about-copy-text', 1)).resolves.toEqual({ success: false });
    await expect(invoke('about-copy-text', 'x'.repeat(70 * 1024))).resolves.toEqual({
      success: false,
    });
    expect(mocks.writeText).toHaveBeenCalledTimes(1);
  });

  it('E2E 模式下不写系统剪贴板', async () => {
    vi.stubEnv('NOVEL_EDITOR_E2E', '1');
    try {
      await expect(invoke('about-copy-text', 'abc')).resolves.toEqual({ success: true });
      expect(mocks.writeText).not.toHaveBeenCalled();
      const { getLastE2ECopiedText } = await import('../../src/main/handlers/about');
      expect(getLastE2ECopiedText()).toBe('abc');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
