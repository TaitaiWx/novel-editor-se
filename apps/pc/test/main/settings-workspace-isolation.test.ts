import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';

const { handlers, send, leaseDirectory } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  send: vi.fn(),
  leaseDirectory: `${process.env.TMPDIR ?? process.cwd()}/ne-settings-leases-${process.pid}-${Math.random()}`,
}));
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: never) => handlers.set(channel, handler) },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send } }] },
}));
vi.mock('../../src/main/handlers/session', () => ({ getWorkspaceRootForSender: () => null }));
vi.mock('../../src/main/native-binding', () => ({ getNativeBinding: () => undefined }));
vi.mock('../../src/main/ai/runtime', () => ({
  getAIService: () => ({ describeDefaultText: () => null }),
  getCredentialStore: () => {
    throw new Error('ordinary settings must not access credentials');
  },
}));
vi.mock('better-sqlite3', async () => {
  const { SqliteShim } = await import('../../../../packages/store/test/helpers/sqlite-shim');
  return {
    default: class extends SqliteShim {
      constructor(
        public readonly name: string,
        options?: unknown
      ) {
        super(name, options);
      }
    },
  };
});
vi.mock('@novel-editor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@novel-editor/core')>();
  return {
    ...actual,
    withWorkspaceLease: (task: () => unknown, options = {}) =>
      actual.withWorkspaceLease(task, { lockDirectory: leaseDirectory, ...options }),
    withWorkspaceWriterLease: (task: () => unknown, options = {}) =>
      actual.withWorkspaceWriterLease(task, { lockDirectory: leaseDirectory, ...options }),
  };
});
import { closeDatabase, getDatabase, initDatabase, settingsOps } from '@novel-editor/store';
import { SqliteShim } from '../../../../packages/store/test/helpers/sqlite-shim';
import { registerSettingsAndCacheHandlers } from '../../src/main/handlers/database/settings-cache';
import { registerWorkspaceHandler } from '../../src/main/workspace-ipc';

let root: string;
let originalDatabase: string;
const event = { sender: { id: 71 } };
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ne-settings-isolation-'));
  originalDatabase = path.join(root, 'old', 'novel-editor.db');
  initDatabase(path.join(root, 'old'));
  settingsOps.set('profile-draft', 'old draft');
  registerSettingsAndCacheHandlers();
  send.mockClear();
});
afterEach(async () => {
  closeDatabase();
  handlers.clear();
  await rm(root, { recursive: true, force: true });
});
afterAll(() => rm(leaseDirectory, { recursive: true, force: true }));

async function queueDatabaseSwitch() {
  let release!: () => void;
  let started!: () => void;
  const begun = new Promise<void>((resolve) => {
    started = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  registerWorkspaceHandler('db-init', async () => {
    started();
    await released;
    initDatabase(path.join(root, 'new'));
    settingsOps.set('profile-draft', 'new project draft');
  });
  const switching = handlers.get('db-init')!(event);
  await begun;
  return { release, switching };
}

it('finishes a queued settings save in its original database without broadcasting into the new project', async () => {
  const { release, switching } = await queueDatabaseSwitch();
  const saving = handlers.get('db-settings-set')!(event, 'profile-draft', 'last old draft');
  release();
  await Promise.all([switching, saving]);
  expect(getDatabase().name).toBe(path.join(root, 'new', 'novel-editor.db'));
  expect(settingsOps.get('profile-draft')).toBe('new project draft');
  const original = new SqliteShim(originalDatabase);
  try {
    expect(
      original.prepare('SELECT value FROM settings WHERE key = ?').get('profile-draft')
    ).toEqual({ value: 'last old draft' });
  } finally {
    original.close();
  }
  expect(send).not.toHaveBeenCalled();
  // The ordinary branch still persists and notifies the currently open project.
  await handlers.get('db-settings-set')!(event, 'profile-draft', 'newer draft');
  expect(settingsOps.get('profile-draft')).toBe('newer draft');
  expect(send).toHaveBeenCalledWith('settings-updated', 'profile-draft');
});

it('rejects queued database mutations without a stale-project handler instead of retargeting them', async () => {
  registerWorkspaceHandler('db-character-patch-profile-draft', () => {
    settingsOps.set('profile-draft', 'wrong project');
  });
  const { release, switching } = await queueDatabaseSwitch();
  const saving = handlers.get('db-character-patch-profile-draft')!(event);
  const rejection = expect(saving).rejects.toThrow('数据库已切换');
  release();
  await Promise.all([switching, rejection]);
  expect(settingsOps.get('profile-draft')).toBe('new project draft');
});
