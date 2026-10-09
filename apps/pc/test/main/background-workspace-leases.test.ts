import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  database: { name: '' },
  workspace: '',
  rows: new Map<string, any>(),
  snapshot: vi.fn(),
  download: vi.fn(),
  leaseDirectory: `${process.env.TMPDIR ?? process.cwd()}/ne-background-leases-${process.pid}-${Math.random()}`,
}));
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, handler: any) => state.handlers.set(name, handler) },
  BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock('@novel-editor/store', () => ({
  getDatabase: () => state.database,
  isDatabaseReady: () => true,
  versionOps: { createSnapshot: (...args: any[]) => state.snapshot(...args) },
  videoTaskOps: {
    list: () => [...state.rows.values()],
    get: (id: string) => state.rows.get(id),
    save: (task: any) => state.rows.set(task.id, task),
  },
}));
vi.mock('../../src/main/handlers/session', () => ({
  getWorkspaceRootForSender: () => state.workspace,
}));
vi.mock('../../src/main/path-access', () => ({ getPathAccessLeaseRoot: () => null }));
vi.mock('../../src/main/handlers/video-scene', () => ({ registerVideoSceneHandlers: () => {} }));
vi.mock('../../src/main/handlers/scene-audio', () => ({ registerSceneAudioHandlers: () => {} }));
vi.mock('../../src/main/ai/runtime', () => ({
  onDatabaseOpened: () => {},
  getAIService: () => ({ getVideoProvider: () => ({}), fetchFor: () => undefined }),
  getProviderConfigStore: () => ({ getVideoSettings: () => ({ maxConcurrent: 2 }) }),
}));
vi.mock('../../src/main/video/download', () => ({
  resolveInsideWork: async (work: string, file: string) => path.join(work, file),
  downloadToFile: (...args: any[]) => state.download(...args),
  writeJsonFile: async () => {},
}));
vi.mock('@novel-editor/core', async (original) => {
  const actual = await original<typeof import('@novel-editor/core')>();
  return {
    ...actual,
    withWorkspaceLease: (task: () => unknown, options = {}) =>
      actual.withWorkspaceLease(task, { lockDirectory: state.leaseDirectory, ...options }),
    withWorkspaceWriterLease: (task: () => unknown, options = {}) =>
      actual.withWorkspaceWriterLease(task, { lockDirectory: state.leaseDirectory, ...options }),
  };
});
import { registerVersionHandlers } from '../../src/main/handlers/versioning';
import { registerVideoHandlers } from '../../src/main/handlers/video';
import { registerWorkspaceHandler } from '../../src/main/workspace-ipc';
import {
  withWorkspaceMutation,
  withWorkspaceSnapshot,
} from '../../src/main/workspace-mutation-gate';
const event = { sender: { id: 1 } };
const call = (name: string, ...args: unknown[]) => state.handlers.get(name)!(event, ...args);
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ne-background-scope-'));
  state.workspace = root;
  state.database = { name: path.join(root, '.novel-editor', 'project.sqlite') };
  state.rows.clear();
  state.handlers.clear();
  state.snapshot.mockReset().mockResolvedValue(1);
  state.download.mockReset();
});
afterEach(() => rm(root, { recursive: true, force: true }));
afterAll(() => rm(state.leaseDirectory, { recursive: true, force: true }));

it('keeps a detached snapshot lease until its asynchronous persistence completes and permits status polling', async () => {
  const started = deferred();
  const finish = deferred();
  const target = path.join(root, 'snapshot.txt');
  state.snapshot.mockImplementation(async () => {
    started.resolve();
    await finish.promise;
    await writeFile(target, 'persisted');
    return 1;
  });
  registerVersionHandlers();
  const id = await call('db-version-start-create', root);
  await started.promise;
  let read = false;
  const reader = withWorkspaceSnapshot(
    async () => {
      read = true;
      return readFile(target, 'utf8');
    },
    { resources: [root] }
  ).catch(() => 'missing');
  const poll = call('db-version-job-status', id);
  let polled = false;
  Promise.resolve(poll).then(() => {
    polled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  const before = { read, polled };
  finish.resolve();
  const result = await reader.catch(() => 'missing');
  await poll;
  await expect.poll(async () => (await call('db-version-job-status', id)).status).toBe('completed');
  expect(before).toEqual({ read: false, polled: true });
  expect(result).toBe('persisted');
});

it('rejects a detached snapshot if an earlier queued database switch wins admission', async () => {
  registerVersionHandlers();
  registerWorkspaceHandler('db-init', () => {
    state.database = { name: path.join(root, 'other.sqlite') };
  });
  const held = deferred();
  const release = deferred();
  const owner = withWorkspaceMutation(
    async () => {
      held.resolve();
      await release.promise;
      return call('db-version-start-create', root);
    },
    { resources: [root] }
  );
  await held.promise;
  const switching = call('db-init');
  release.resolve();
  const id = await owner;
  await switching;
  await expect.poll(async () => (await call('db-version-job-status', id)).status).toBe('failed');
  expect(state.snapshot).not.toHaveBeenCalled();
});

it('cancels an in-flight video download through the real gate before the network wait finishes', async () => {
  const work = path.join(root, 'novels', 'work');
  const secondWork = path.join(root, 'other-work');
  await mkdir(work, { recursive: true });
  const task = {
    id: 'video',
    status: 'succeeded',
    providerId: 'fake',
    workPath: work,
    chapter: 'chapter',
    scene: 'scene',
    shotIndex: 1,
    version: 1,
    prompt: 'prompt',
    resultUrl: 'https://test/video',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  state.rows.set(task.id, task);
  // A second work must be part of both foreground and background declarations.
  state.rows.set('other', { ...task, id: 'other', workPath: secondWork, status: 'cancelled' });
  const started = deferred();
  const finish = deferred();
  let aborted = false;
  state.download.mockImplementation(async (_url, _file, options) => {
    started.resolve();
    options.signal.addEventListener('abort', () => {
      aborted = true;
      finish.resolve();
    });
    await finish.promise;
    if (options.signal.aborted) throw new Error('aborted');
  });
  const runner = registerVideoHandlers();
  await runner.tick();
  await started.promise;
  const cancel = call('video-task-cancel', task.id);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const before = aborted;
  finish.resolve();
  await cancel;
  runner.stop();
  expect(before).toBe(true);
  expect(state.rows.get(task.id).status).toBe('cancelled');
});
