import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readGuiSession } from '@novel-editor/core';
const env = vi.hoisted(() => ({ windows: [] as unknown[], release: vi.fn(), prepare: vi.fn() }));
vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0' },
  BrowserWindow: { getAllWindows: () => env.windows },
  ipcMain: { handle: vi.fn() },
}));
vi.mock('../../src/main/renderer-preparation', () => ({ requestRendererPreparation: env.prepare }));
vi.mock('../../src/main/handlers/file-system', () => ({ drainFileWrites: async () => {} }));
vi.mock('../../src/main/path-access', () => ({
  assertDirectoryAccess: async () => {},
  assertPathAccess: async () => {},
  assertNoPathMutation: () => {},
}));
import { guardWindowClose, prepareAppForExit } from '../../src/main/graceful-shutdown';
import {
  publishGuiSession,
  getWorkspaceRootForSender,
  resetGuiSessionsForTest,
} from '../../src/main/handlers/session';
import { withWorkspaceMutation } from '../../src/main/workspace-mutation-gate';
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'ne-shutdown-restore-'));
  resetGuiSessionsForTest();
  env.windows = [];
  env.release.mockReset();
  env.prepare.mockResolvedValue({ release: env.release });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  resetGuiSessionsForTest();
});
it('an async installer failure restores live sender roots and the last flushed session before releasing writers or UI', async () => {
  const live = Object.assign(new EventEmitter(), {
    webContents: { id: 1 },
    isDestroyed: () => false,
  });
  let otherDestroyed = false;
  const other = Object.assign(new EventEmitter(), {
    webContents: { id: 2 },
    isDestroyed: () => otherDestroyed,
  });
  env.windows = [live, other];
  guardWindowClose(live as never);
  guardWindowClose(other as never);
  const otherRoot = path.join(dir, 'other');
  await mkdir(otherRoot);
  const latestFile = path.join(dir, 'last.md');
  await publishGuiSession({ id: 1 }, { workspaceRoot: dir, activeFile: null, openFiles: [] });
  await publishGuiSession(
    { id: 1 },
    { workspaceRoot: dir, activeFile: latestFile, openFiles: [{ path: latestFile, dirty: false }] }
  );
  await publishGuiSession({ id: 2 }, { workspaceRoot: otherRoot, activeFile: null, openFiles: [] });
  const before = (await readGuiSession(dir)).session!;
  let resumedRoot: string | null | undefined;
  let resumedStatus: string | undefined;
  let laterWrite: Promise<void> | undefined;
  env.release.mockImplementation(() => {
    expect(getWorkspaceRootForSender(1)).toBe(dir);
  });
  const result = await prepareAppForExit(async () => {
    expect((await readGuiSession(dir)).status).toBe('closed');
    expect(getWorkspaceRootForSender(1)).toBeNull();
    laterWrite = withWorkspaceMutation(async () => {
      resumedRoot = getWorkspaceRootForSender(1);
      resumedStatus = (await readGuiSession(dir)).status;
    });
    otherDestroyed = true;
    await Promise.resolve();
    throw new Error('native handoff failed');
  });
  await laterWrite;
  expect(result).toBe(false);
  expect(getWorkspaceRootForSender(1)).toBe(dir);
  expect(getWorkspaceRootForSender(2)).toBeNull();
  expect(resumedRoot).toBe(dir);
  expect(resumedStatus).toBe('active');
  expect((await readGuiSession(dir)).session).toMatchObject({
    state: 'open',
    activeFile: latestFile,
    openFiles: before.openFiles,
    startedAt: before.startedAt,
  });
  expect((await readGuiSession(otherRoot)).status).toBe('closed');
  expect(env.release).toHaveBeenCalledTimes(2);
});
