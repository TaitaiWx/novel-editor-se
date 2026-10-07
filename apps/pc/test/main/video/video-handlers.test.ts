import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
const userData = mkdtempSync(path.join(os.tmpdir(), 'ne-video-ipc-'));
const rows = new Map<string, unknown>();
const sent: Array<{ channel: string; payload: unknown }> = [];

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
  },
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(`enc:${text}`),
    decryptString: (buffer: Buffer) => buffer.toString().slice(4),
  },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
        },
      },
    ],
  },
}));

vi.mock('@novel-editor/store', () => ({
  isDatabaseReady: () => true,
  settingsOps: { get: () => undefined, set: () => undefined },
  videoTaskOps: {
    save: (task: { id: string }) => void rows.set(task.id, structuredClone(task)),
    get: (id: string) => rows.get(id),
    list: (filter: { workPath?: string } = {}) =>
      Array.from(rows.values()).filter(
        (task) => !filter.workPath || (task as { workPath: string }).workPath === filter.workPath
      ),
  },
}));

let workspaceRoot: string | null = null;
const runtime = await import('../../../src/main/ai/runtime');
const { registerVideoHandlers, assertWorkPath, sanitizeSubmitPayload } = await import(
  '../../../src/main/handlers/video'
);
const runner = registerVideoHandlers(undefined, () => workspaceRoot);
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`未注册: ${channel}`);
  return (await handler({ sender: { id: 1 } }, ...args)) as T;
}

const project = path.join(userData, 'project');
const work = path.join(project, 'novels', '作品');

beforeEach(async () => {
  rows.clear();
  sent.length = 0;
  workspaceRoot = null;
  fetchMock.mockReset();
  await mkdir(work, { recursive: true });
});

afterAll(() => {
  runner.stop();
  rmSync(userData, { recursive: true, force: true });
});

const payload = () => ({
  providerId: 'minimax-video',
  workPath: work,
  chapter: '第一章',
  scene: '雪夜',
  shotIndex: 1,
  prompt: '月夜雪原',
  durationSec: 6,
});

describe('视频任务 IPC', () => {
  it('未配置服务时拒绝提交', async () => {
    expect(await call('video-task-submit', payload())).toMatchObject({
      ok: false,
      error: { kind: 'not-configured' },
    });
  });

  it('提交 → 列表 → 广播 → 取消 → 重试', async () => {
    runtime.getCredentialStore().set('minimax-video', 'mm');
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ task_id: 'remote-1', base_resp: { status_code: 0 } }))
    );
    const submitted = await call<{
      ok: true;
      data: { id: string; status: string; version: number };
    }>('video-task-submit', payload());
    expect(submitted).toMatchObject({ ok: true, data: { status: 'queued', version: 1 } });
    expect(sent.some((item) => item.channel === 'video-task-updated')).toBe(true);
    const listed = await call<{ ok: true; data: unknown[] }>('video-task-list', { workPath: work });
    expect(listed.data).toHaveLength(1);
    expect(
      (await call<{ ok: true; data: unknown[] }>('video-task-list', { workPath: '/elsewhere' }))
        .data
    ).toHaveLength(0);
    expect((await call<{ ok: true; data: unknown[] }>('video-task-list')).data).toHaveLength(1);
    expect(await call('video-task-cancel', submitted.data.id)).toMatchObject({
      ok: true,
      data: { status: 'cancelled' },
    });
    expect(await call('video-task-retry', submitted.data.id)).toMatchObject({
      ok: true,
      data: { status: 'queued' },
    });
    expect(await call('video-task-cancel', 'missing')).toMatchObject({
      ok: false,
      error: { message: '视频任务不存在' },
    });
  });

  it('打开数据库后恢复任务队列', async () => {
    const start = vi.spyOn(runner, 'start');
    runtime.handleDatabaseOpened();
    expect(start).toHaveBeenCalled();
    runner.stop();
  });

  it('视频设置读写与范围校验', async () => {
    expect(await call('video-settings-get')).toEqual({ ok: true, data: { maxConcurrent: 2 } });
    expect(
      await call('video-settings-set', { maxConcurrent: 99, dailyLimit: 20, perTaskLimit: -1 })
    ).toEqual({ ok: true, data: { maxConcurrent: 8, dailyLimit: 20 } });
    expect(await call('video-settings-set', { dailyLimit: 0 })).toEqual({
      ok: true,
      data: { maxConcurrent: 8 },
    });
    expect(await call('video-settings-set', null)).toEqual({
      ok: true,
      data: { maxConcurrent: 8 },
    });
  });
});

describe('参数校验', () => {
  it('作品目录：绝对路径、存在、位于窗口的工作区内', async () => {
    await expect(assertWorkPath('relative', null)).rejects.toThrow('无效的作品目录');
    await expect(assertWorkPath(42, null)).rejects.toThrow('无效的作品目录');
    await expect(assertWorkPath(path.join(work, 'missing'), null)).rejects.toThrow('不存在');
    expect(await assertWorkPath(work, project)).toBe(work);
    const other = mkdtempSync(path.join(os.tmpdir(), 'ne-other-'));
    await expect(assertWorkPath(other, project)).rejects.toThrow('不在当前打开的项目内');
    rmSync(other, { recursive: true, force: true });
    workspaceRoot = path.join(userData, 'another-project');
    expect(await call('video-task-submit', payload())).toMatchObject({ ok: false });
  });

  it('提交参数白名单', () => {
    expect(() => sanitizeSubmitPayload(null)).toThrow('无效的视频任务');
    expect(() => sanitizeSubmitPayload({ ...payload(), shotIndex: 0 })).toThrow('镜头序号');
    expect(() => sanitizeSubmitPayload({ ...payload(), shotIndex: 1.5 })).toThrow('镜头序号');
    expect(() => sanitizeSubmitPayload({ ...payload(), durationSec: 0 })).toThrow('时长');
    expect(() => sanitizeSubmitPayload({ ...payload(), prompt: '' })).toThrow('画面描述');
    expect(() => sanitizeSubmitPayload({ ...payload(), prompt: 'x'.repeat(5000) })).toThrow('过长');
    expect(() =>
      sanitizeSubmitPayload({ ...payload(), firstFrameImage: 'file:///etc/passwd' })
    ).toThrow('首帧图');
    expect(
      sanitizeSubmitPayload({
        ...payload(),
        extra: 'dropped',
        firstFrameImage: 'data:image/png;base64,AA',
        model: '',
      })
    ).toEqual({
      providerId: 'minimax-video',
      model: undefined,
      chapter: '第一章',
      scene: '雪夜',
      shotIndex: 1,
      prompt: '月夜雪原',
      durationSec: 6,
      aspectRatio: undefined,
      resolution: undefined,
      firstFrameImage: 'data:image/png;base64,AA',
    });
  });
});
