import JSZip from 'jszip';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogUploadResult, LogUploadSettingsState } from '../../../src/shared/log-upload';
import type { FetchLike } from '../../../src/main/log-upload/uploader';

// ─── electron / electron-log / auto-updater mock ───

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  paths: {} as Record<string, string>,
  showItemInFolder: vi.fn(),
  logFile: '' as string,
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    },
  },
  shell: { showItemInFolder: mocks.showItemInFolder },
  clipboard: { writeText: vi.fn() },
  app: {
    isPackaged: false,
    getPath: (name: string) => {
      const value = mocks.paths[name];
      if (!value) throw new Error(`unknown path ${name}`);
      return value;
    },
    getVersion: () => '1.2.0-beta.3',
    getName: () => 'Novel Editor',
    getLocale: () => 'zh-CN',
  },
}));

vi.mock('electron-log/main', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    transports: { file: { getFile: () => ({ path: mocks.logFile }) } },
  },
}));

vi.mock('../../../src/main/auto-updater', () => ({
  getUpdateStatus: vi.fn(async () => ({
    channel: 'beta',
    rolloutBucket: 7,
    rolloutPercentage: null,
    rolloutEligible: null,
  })),
}));

import { registerLogUploadHandlers } from '../../../src/main/handlers/log-upload';
import {
  pruneCrashBundles,
  reportCrash,
  runManualLogUpload,
} from '../../../src/main/log-upload/service';
import { resetLogUploadSettingsCache } from '../../../src/main/log-upload/settings';

function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const handler: Handler | undefined = mocks.handlers.get(channel);
  if (!handler) throw new Error(`未注册的通道: ${channel}`);
  return Promise.resolve(handler({}, ...args)) as Promise<T>;
}

let root: string;
const NOW = new Date(2026, 9, 6, 9, 5, 7);

async function zipEntries(file: string): Promise<string[]> {
  const zip = await JSZip.loadAsync(await readFile(file));
  return Object.keys(zip.files)
    .filter((name) => !zip.files[name].dir)
    .sort();
}

beforeAll(() => {
  registerLogUploadHandlers();
});

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'ne-log-service-'));
  mocks.paths = {
    userData: path.join(root, 'userData'),
    logs: path.join(root, 'logs'),
    documents: path.join(root, 'documents'),
    downloads: path.join(root, 'Downloads'),
  };
  mocks.logFile = path.join(mocks.paths.logs, 'main.log');
  await mkdir(mocks.paths.logs, { recursive: true });
  await writeFile(mocks.logFile, '[info] 启动\n');
  // 用户数据目录里的数据库永远不应进入日志包
  await mkdir(mocks.paths.userData, { recursive: true });
  await writeFile(path.join(mocks.paths.userData, 'novel-editor.db'), 'SQLite format 3');
  mocks.showItemInFolder.mockClear();
  resetLogUploadSettingsCache();
  vi.stubEnv('NOVEL_EDITOR_LOG_UPLOAD_URL', '');
  vi.stubEnv('NOVEL_EDITOR_E2E', '');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe('runManualLogUpload', () => {
  it('未配置上传地址：保存到「下载」目录并在文件管理器中定位', async () => {
    const result = await runManualLogUpload({ now: NOW });
    expect(result.status).toBe('saved');
    if (result.status !== 'saved') return;
    expect(result.fileName).toMatch(/^novel-editor-logs-20261006-090507-[0-9a-f]{8}\.zip$/);
    expect(result.filePath).toBe(path.join(mocks.paths.downloads, result.fileName));
    expect(result.uploadError).toBeNull();
    expect(mocks.showItemInFolder).toHaveBeenCalledWith(result.filePath);

    const entries = await zipEntries(result.filePath);
    expect(entries).toEqual(['diagnostics.json', 'logs/main.log']);
    const zip = await JSZip.loadAsync(await readFile(result.filePath));
    const diagnostics = JSON.parse((await zip.file('diagnostics.json')?.async('string')) ?? '{}');
    expect(diagnostics).toMatchObject({
      reason: 'manual',
      app: { version: '1.2.0-beta.3', releaseChannel: 'beta', isPackaged: false },
      update: { channel: 'beta', rolloutBucket: 7 },
      os: { platform: process.platform, arch: process.arch },
      runtime: { node: process.versions.node },
      directories: { userData: mocks.paths.userData, logs: mocks.paths.logs },
    });
    expect(diagnostics.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof diagnostics.time.uptimeMs).toBe('number');
  });

  it('上传成功时不落盘，返回工单编号', async () => {
    const fetchImpl = vi.fn<FetchLike>(
      async () => new Response(JSON.stringify({ ok: true, ticketId: 'T-9' }), { status: 200 })
    );
    const result = await runManualLogUpload({
      endpoint: 'https://logs.example.com/up',
      fetchImpl,
      now: NOW,
    });
    expect(result).toMatchObject({ status: 'uploaded', ticketId: 'T-9' });
    const headers = fetchImpl.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['X-Upload-Reason']).toBe('manual');
    expect(existsSync(mocks.paths.downloads)).toBe(false);
  });

  it('上传失败（含重试）后兜底保存到「下载」目录', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response('', { status: 502 }));
    const result = await runManualLogUpload({
      endpoint: 'https://logs.example.com/up',
      fetchImpl,
      retryDelayMs: 0,
      now: NOW,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ status: 'saved', uploadError: '服务器返回 502' });
  });

  it('E2E 模式下不弹出文件管理器', async () => {
    vi.stubEnv('NOVEL_EDITOR_E2E', '1');
    const result = await runManualLogUpload({ now: NOW });
    expect(result.status).toBe('saved');
    expect(mocks.showItemInFolder).not.toHaveBeenCalled();
  });

  it('重复点击复用进行中的任务', async () => {
    const [a, b] = await Promise.all([
      runManualLogUpload({ now: NOW }),
      runManualLogUpload({ now: NOW }),
    ]);
    expect(a).toBe(b);
  });
});

describe('reportCrash', () => {
  const crash = { kind: 'uncaughtException', message: 'boom' };

  it('未配置上传地址：只保存到 userData/crash-reports，不写「下载」目录', async () => {
    const result = await reportCrash(crash, { now: NOW });
    expect(result.status).toBe('saved');
    if (result.status !== 'saved') return;
    expect(path.dirname(result.filePath)).toBe(path.join(mocks.paths.userData, 'crash-reports'));
    expect(await zipEntries(result.filePath)).toEqual([
      'crash.json',
      'diagnostics.json',
      'logs/main.log',
    ]);
    expect(existsSync(mocks.paths.downloads)).toBe(false);
  });

  it('开启自动上传且配置了地址时上传，X-Upload-Reason 为 crash', async () => {
    const fetchImpl = vi.fn<FetchLike>(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    const result = await reportCrash(crash, {
      endpoint: 'https://logs.example.com/up',
      fetchImpl,
      now: NOW,
    });
    expect(result).toEqual({ status: 'uploaded', ticketId: null });
    const headers = fetchImpl.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['X-Upload-Reason']).toBe('crash');
  });

  it('关闭「崩溃时自动上传日志」后不上传，只保存在本地', async () => {
    await invoke('log-upload-set-settings', { autoUploadOnCrash: false });
    const fetchImpl = vi.fn<FetchLike>();
    const result = await reportCrash(crash, {
      endpoint: 'https://logs.example.com/up',
      fetchImpl,
      now: NOW,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'saved', uploadError: null });
  });

  it('pruneCrashBundles 只保留最近 5 个', async () => {
    const dir = path.join(root, 'crash');
    await mkdir(dir);
    for (let i = 0; i < 7; i += 1) {
      await writeFile(path.join(dir, `novel-editor-logs-2026100${i}-000000-x.zip`), '');
    }
    await writeFile(path.join(dir, 'keep.txt'), '');
    await pruneCrashBundles(dir, 5);
    const left = (await readdir(dir)).sort();
    expect(left.filter((n) => n.endsWith('.zip'))).toHaveLength(5);
    expect(left).toContain('keep.txt');
    expect(left).not.toContain('novel-editor-logs-20261000-000000-x.zip');
  });
});

describe('log-upload IPC', () => {
  it('log-upload-run 返回结果', async () => {
    const result = await invoke<LogUploadResult>('log-upload-run');
    expect(result.status).toBe('saved');
  });

  it('读取 / 修改设置：默认开启，只接受已知字段并持久化', async () => {
    await expect(invoke<LogUploadSettingsState>('log-upload-get-settings')).resolves.toEqual({
      autoUploadOnCrash: true,
      endpointConfigured: false,
    });
    await expect(
      invoke<LogUploadSettingsState>('log-upload-set-settings', {
        autoUploadOnCrash: false,
        evil: true,
      })
    ).resolves.toEqual({ autoUploadOnCrash: false, endpointConfigured: false });
    const stored = JSON.parse(
      await readFile(path.join(mocks.paths.userData, 'log-upload-settings.json'), 'utf-8')
    );
    expect(stored).toEqual({ autoUploadOnCrash: false });

    // 非法参数不改变设置
    await expect(invoke('log-upload-set-settings', 'oops')).resolves.toMatchObject({
      autoUploadOnCrash: false,
    });

    vi.stubEnv('NOVEL_EDITOR_LOG_UPLOAD_URL', 'https://logs.example.com/up');
    await expect(invoke('log-upload-get-settings')).resolves.toMatchObject({
      endpointConfigured: true,
    });
  });
});
