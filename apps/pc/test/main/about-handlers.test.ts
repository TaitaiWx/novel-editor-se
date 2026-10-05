import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  openPath: vi.fn(async (_p: string) => ''),
  openExternal: vi.fn(async (_url: string) => undefined),
  writeText: vi.fn(),
  updateStatus: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    },
  },
  shell: { openPath: mocks.openPath, openExternal: mocks.openExternal },
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
import { REPOSITORY_URL } from '../../src/shared/about';
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
  mocks.openPath.mockClear();
  mocks.openExternal.mockClear();
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
  it('返回版本、通道、灰度分组、完整设备 ID、运行时与数据目录', async () => {
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

    expect(info.runtime).toMatchObject({
      node: process.versions.node,
      v8: process.versions.v8,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      isPackaged: false,
    });
    expect(info.directories).toEqual([
      { key: 'userData', label: '用户数据', path: mocks.paths.userData },
      { key: 'logs', label: '日志', path: mocks.paths.logs },
      {
        key: 'sampleData',
        label: '示例项目',
        path: path.join(mocks.paths.documents, 'Novel Editor', 'sample-data'),
      },
    ]);
    expect(info.links).toEqual({
      repository: REPOSITORY_URL,
      releaseNotes: `${REPOSITORY_URL}/releases/tag/v1.2.0-beta.3`,
      issues: `${REPOSITORY_URL}/issues`,
    });
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

  it('仓库地址与 package.json repository 字段一致', () => {
    const pkg = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8')
    ) as { repository: { url: string } };
    expect(pkg.repository.url.replace(/\.git$/, '')).toBe(REPOSITORY_URL);
  });
});

describe('about-open-directory', () => {
  it('只允许打开 get-about-info 返回的目录', async () => {
    mkdirSync(mocks.paths.userData, { recursive: true });
    await expect(invoke('about-open-directory', mocks.paths.userData)).resolves.toEqual({
      success: true,
    });
    expect(mocks.openPath).toHaveBeenCalledWith(mocks.paths.userData);

    await expect(invoke('about-open-directory', root)).resolves.toMatchObject({ success: false });
    await expect(invoke('about-open-directory', 42)).resolves.toMatchObject({ success: false });
    expect(mocks.openPath).toHaveBeenCalledTimes(1);
  });

  it('日志目录不存在时自动创建；示例项目未创建时给出提示', async () => {
    await expect(invoke('about-open-directory', mocks.paths.logs)).resolves.toEqual({
      success: true,
    });
    const sample = path.join(mocks.paths.documents, 'Novel Editor', 'sample-data');
    await expect(invoke('about-open-directory', sample)).resolves.toEqual({
      success: false,
      error: '示例项目尚未创建',
    });
    expect(mocks.openPath).toHaveBeenCalledTimes(1);
  });

  it('shell.openPath 返回错误信息时透传', async () => {
    mkdirSync(mocks.paths.userData, { recursive: true });
    mocks.openPath.mockResolvedValueOnce('打不开');
    await expect(invoke('about-open-directory', mocks.paths.userData)).resolves.toEqual({
      success: false,
      error: '打不开',
    });
  });
});

describe('about-open-link / about-copy-text', () => {
  it('只打开预定义的链接', async () => {
    await expect(invoke('about-open-link', 'releaseNotes')).resolves.toEqual({ success: true });
    expect(mocks.openExternal).toHaveBeenCalledWith(`${REPOSITORY_URL}/releases/tag/v1.2.0-beta.3`);
    await expect(invoke('about-open-link', 'https://evil.example')).resolves.toMatchObject({
      success: false,
    });
    await expect(invoke('about-open-link', 'toString')).resolves.toMatchObject({
      success: false,
    });
    expect(mocks.openExternal).toHaveBeenCalledTimes(1);
  });

  it('写入剪贴板并拒绝非法或超长文本', async () => {
    await expect(invoke('about-copy-text', '诊断信息')).resolves.toEqual({ success: true });
    expect(mocks.writeText).toHaveBeenCalledWith('诊断信息');
    await expect(invoke('about-copy-text', '')).resolves.toEqual({ success: false });
    await expect(invoke('about-copy-text', 1)).resolves.toEqual({ success: false });
    await expect(invoke('about-copy-text', 'x'.repeat(70 * 1024))).resolves.toEqual({
      success: false,
    });
    expect(mocks.writeText).toHaveBeenCalledTimes(1);
  });
});
