import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTodayStats, initProject, readGuiSession, readWritingLog } from '@novel-editor/core';

// ─── electron mock：捕获 ipcMain.handle 注册 ───

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  closePause: null as null | (() => Promise<void>),
  leaseDirectory: `${process.env.TMPDIR ?? process.cwd()}/ne-session-leases-${process.pid}-${Math.random()}`,
}));

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn(),
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    },
  },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  app: { isPackaged: false, getPath: vi.fn(), getAppPath: vi.fn(), getVersion: () => '9.9.9' },
  clipboard: { read: vi.fn(), availableFormats: vi.fn(), readText: vi.fn() },
}));

vi.mock('@novel-editor/core', async (original) => {
  const actual = await original<typeof import('@novel-editor/core')>();
  return {
    ...actual,
    withWorkspaceLease: (task: () => unknown, options = {}) =>
      actual.withWorkspaceLease(task, { lockDirectory: mocks.leaseDirectory, ...options }),
    withWorkspaceWriterLease: (task: () => unknown, options = {}) =>
      actual.withWorkspaceWriterLease(task, { lockDirectory: mocks.leaseDirectory, ...options }),
    markGuiSessionClosed: async (...args: Parameters<typeof actual.markGuiSessionClosed>) => {
      await mocks.closePause?.();
      return actual.markGuiSessionClosed(...args);
    },
  };
});
import {
  withWorkspaceMutation,
  withWorkspaceSnapshot,
} from '../../src/main/workspace-mutation-gate';
afterAll(() => rm(mocks.leaseDirectory, { recursive: true, force: true }));

vi.mock('../../src/main/recent-folders', () => ({
  addRecentFolder: vi.fn(),
  getRecentFolders: () => [],
}));

import { grantPathAccess, resetPathAccessForTest } from '../../src/main/path-access';
import { registerFileSystemHandlers } from '../../src/main/handlers/file-system';
import {
  registerSessionHandlers,
  resetGuiSessionsForTest,
  moveGuiSessionRoot,
} from '../../src/main/handlers/session';

/** 模拟 webContents：记录 destroyed 监听，便于手动触发窗口关闭 */
function createSender(id: number) {
  const listeners: Array<() => void> = [];
  return {
    id,
    once: vi.fn((_event: 'destroyed', listener: () => void) => {
      listeners.push(listener);
    }),
    destroy: () => listeners.splice(0).forEach((listener) => listener()),
  };
}

function invoke<T = unknown>(channel: string, event: unknown, ...args: unknown[]): Promise<T> {
  const handler: Handler | undefined = mocks.handlers.get(channel);
  if (!handler) throw new Error(`未注册的通道: ${channel}`);
  return Promise.resolve(handler(event, ...args)) as Promise<T>;
}

let dir: string;

beforeAll(() => {
  registerFileSystemHandlers();
  registerSessionHandlers();
});

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'ne-session-'));
  resetGuiSessionsForTest();
  resetPathAccessForTest();
  for (const id of [1, 2, 3, 4, 5, 7]) await grantPathAccess({ id }, dir, true);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('write-file 记录写作日志', () => {
  it('ne init 项目内保存正文：按字数差写入 core 写作日志', async () => {
    const { project } = await initProject(dir);
    const file = path.join(project.novelsPath, '书', '001.md');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '一二三', 'utf-8');

    await expect(invoke('write-file', { sender: { id: 1 } }, file, '一二三四五')).resolves.toEqual({
      success: true,
    });
    expect(await readFile(file, 'utf-8')).toBe('一二三四五');
    await vi.waitFor(async () => {
      const today = await getTodayStats(project.root);
      expect(today).toMatchObject({ added: 2, removed: 0, writes: 1 });
      expect(today.files).toEqual(['novels/书/001.md']);
    });

    // 内容不变：不再计入
    await invoke('write-file', { sender: { id: 1 } }, file, '一二三四五');
    // 新建文件：从 0 计
    await invoke(
      'write-file',
      { sender: { id: 1 } },
      path.join(project.novelsPath, '书', '002.md'),
      '甲乙'
    );
    await vi.waitFor(async () => {
      expect(await getTodayStats(project.root)).toMatchObject({ added: 4, writes: 2 });
    });
  });

  it('资料/ 与非正文文件不计入；未 init 且未上报会话时不写日志', async () => {
    const { project } = await initProject(dir);
    await mkdir(path.join(dir, '资料'), { recursive: true });
    await invoke('write-file', { sender: { id: 1 } }, path.join(dir, '资料', 'a.md'), '资料内容');
    await invoke('write-file', { sender: { id: 1 } }, path.join(dir, 'data.json'), '{}');
    // 给异步记录留出时间
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await readWritingLog(project.root)).days).toEqual({});

    const plain = await mkdtemp(path.join(os.tmpdir(), 'ne-plain-'));
    try {
      await grantPathAccess({ id: 1 }, plain, true);
      await invoke('write-file', { sender: { id: 1 } }, path.join(plain, 'a.md'), '正文');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect((await readWritingLog(plain)).days).toEqual({});
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });

  it('未 init 的文件夹：回退到该窗口上报的 GUI 文件夹', async () => {
    const sender = createSender(7);
    await invoke(
      'gui-session-publish',
      { sender },
      {
        workspaceRoot: dir,
        activeFile: null,
        openFiles: [],
      }
    );
    await mkdir(path.join(dir, '卷一'), { recursive: true });
    await invoke('write-file', { sender }, path.join(dir, '卷一', '001.md'), '春眠不觉晓');
    await vi.waitFor(async () => {
      const day = Object.values((await readWritingLog(dir)).days)[0];
      expect(day).toMatchObject({ added: 5, files: ['卷一/001.md'] });
    });
  });
});

describe('gui-session-publish', () => {
  it('写入 session.json，窗口销毁后标记 closed', async () => {
    const sender = createSender(1);
    const file = path.join(dir, 'a.md');
    await expect(
      invoke(
        'gui-session-publish',
        { sender },
        {
          workspaceRoot: dir,
          activeFile: file,
          openFiles: [
            { path: file, dirty: true },
            { path: path.join(dir, 'b.md'), dirty: false },
          ],
        }
      )
    ).resolves.toEqual({ success: true });

    const active = await readGuiSession(dir);
    expect(active.status).toBe('active');
    expect(active.session).toMatchObject({
      pid: process.pid,
      appVersion: '9.9.9',
      activeFile: file,
      dirtyFiles: [file],
    });
    expect(sender.once).toHaveBeenCalledTimes(1);

    // 再次发布不重复注册监听，startedAt 保持不变
    await invoke(
      'gui-session-publish',
      { sender },
      {
        workspaceRoot: dir,
        activeFile: null,
        openFiles: [],
      }
    );
    expect(sender.once).toHaveBeenCalledTimes(1);
    const again = await readGuiSession(dir);
    expect(again.session?.startedAt).toBe(active.session?.startedAt);
    expect(again.session?.dirtyFiles).toEqual([]);

    sender.destroy();
    await vi.waitFor(async () => {
      expect((await readGuiSession(dir)).status).toBe('closed');
    });
  });

  it('切换文件夹或上报 null 时关闭旧会话', async () => {
    const other = await mkdtemp(path.join(os.tmpdir(), 'ne-session-other-'));
    try {
      const sender = createSender(2);
      await grantPathAccess(sender, other, true);
      const snapshot = (root: string) => ({ workspaceRoot: root, activeFile: null, openFiles: [] });
      await invoke('gui-session-publish', { sender }, snapshot(dir));
      await invoke('gui-session-publish', { sender }, snapshot(other));
      expect((await readGuiSession(dir)).status).toBe('closed');
      expect((await readGuiSession(other)).status).toBe('active');

      await invoke('gui-session-publish', { sender }, null);
      expect((await readGuiSession(other)).status).toBe('closed');
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it('同一文件夹仍被其他窗口使用时不标记关闭', async () => {
    const a = createSender(3);
    const b = createSender(4);
    const snapshot = { workspaceRoot: dir, activeFile: null, openFiles: [] };
    await invoke('gui-session-publish', { sender: a }, snapshot);
    await invoke('gui-session-publish', { sender: b }, snapshot);
    await invoke('gui-session-publish', { sender: a }, null);
    expect((await readGuiSession(dir)).status).toBe('active');
  });

  it('写入失败时返回 success: false 而不抛错', async () => {
    const blocker = path.join(dir, 'file-not-dir');
    await writeFile(blocker, 'x', 'utf-8');
    const sender = createSender(5);
    await expect(
      invoke(
        'gui-session-publish',
        { sender },
        {
          workspaceRoot: blocker,
          activeFile: null,
          openFiles: [],
        }
      )
    ).resolves.toEqual({ success: false });
  });
});

it('renderer session publication cannot authorize an arbitrary directory', async () => {
  const unapproved = await mkdtemp(path.join(os.tmpdir(), 'ne-session-unapproved-'));
  try {
    const sender = createSender(1);
    expect(
      await invoke(
        'gui-session-publish',
        { sender },
        { workspaceRoot: unapproved, activeFile: null, openFiles: [] }
      )
    ).toEqual({ success: false });
    await expect(
      invoke('write-file', { sender }, path.join(unapproved, 'attack.md'), 'bad')
    ).rejects.toThrow('未授权');
    await expect(readFile(path.join(unapproved, '.novel-editor/session.json'))).rejects.toThrow();
  } finally {
    await rm(unapproved, { recursive: true, force: true });
  }
});

it('gives a session destroy callback its own lease when triggered inside an admitted operation', async () => {
  const sender = createSender(1);
  await invoke(
    'gui-session-publish',
    { sender },
    { workspaceRoot: dir, activeFile: null, openFiles: [] }
  );
  let started!: () => void;
  let release!: () => void;
  const begun = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pause = new Promise<void>((resolve) => {
    release = resolve;
  });
  mocks.closePause = async () => {
    started();
    await pause;
  };
  const owner = withWorkspaceMutation(
    async () => {
      sender.destroy();
      await begun;
    },
    { resources: [dir] }
  );
  await owner;
  let read = false;
  const snapshot = withWorkspaceSnapshot(
    async () => {
      read = true;
      return readGuiSession(dir);
    },
    { resources: [dir] }
  );
  await new Promise((resolve) => setTimeout(resolve, 40));
  const before = read;
  release();
  const result = await snapshot;
  mocks.closePause = null;
  await vi.waitFor(async () => expect((await readGuiSession(dir)).status).toBe('closed'));
  expect(before).toBe(false);
  expect(result.status).toBe('closed');
});

it('redeclares a destroyed session root after an earlier queued workspace rename', async () => {
  const sender = createSender(1);
  await invoke(
    'gui-session-publish',
    { sender },
    { workspaceRoot: dir, activeFile: null, openFiles: [] }
  );
  const destination = `${dir}-moved`;
  let held!: () => void;
  let destroy!: () => void;
  const begun = new Promise<void>((resolve) => {
    held = resolve;
  });
  const trigger = new Promise<void>((resolve) => {
    destroy = resolve;
  });
  const owner = withWorkspaceMutation(
    async () => {
      held();
      await trigger;
      sender.destroy();
    },
    { resources: [dir] }
  );
  await begun;
  const moving = withWorkspaceSnapshot(
    async () => {
      await rename(dir, destination);
      moveGuiSessionRoot(dir, destination);
    },
    { resources: [dir, destination] }
  );
  destroy();
  await Promise.all([owner, moving]);
  try {
    await vi.waitFor(async () => expect((await readGuiSession(destination)).status).toBe('closed'));
    expect(await stat(dir).catch(() => null)).toBeNull();
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});
