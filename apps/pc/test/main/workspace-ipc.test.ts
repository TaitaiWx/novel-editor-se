import { rm as removeLeaseDirectory } from 'node:fs/promises';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { withWorkspaceLease } from '@novel-editor/core';

const listeners = vi.hoisted(
  () => new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>()
);
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, listener: never) => listeners.set(name, listener) },
}));
vi.mock('../../src/main/handlers/session', () => ({ getWorkspaceRootForSender: () => null }));
vi.mock('@novel-editor/store', () => ({
  getDatabase: () => {
    throw new Error('not open');
  },
}));
import { registerWorkspaceHandler } from '../../src/main/workspace-ipc';
let root = '';
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  listeners.clear();
});

it('admits a registered file write while a disjoint project holds a lease', async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ne-ipc-resources-'));
  let release!: () => void;
  let held!: () => void;
  const started = new Promise<void>((resolve) => {
    held = resolve;
  });
  const owner = withWorkspaceLease(
    async () => {
      held();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    { resources: [path.join(root, 'a')] }
  );
  await started;
  const target = path.join(root, 'chapter.md');
  registerWorkspaceHandler('write-file', async (_event, file: string, text: string) =>
    writeFile(file, text)
  );
  let written = false;
  const writer = listeners.get('write-file')!({ sender: { id: 1 } }, target, 'after').then(() => {
    written = true;
  });
  try {
    await expect.poll(() => written, { timeout: 2000 }).toBe(true);
  } finally {
    release();
    await Promise.all([owner, writer]);
  }
  expect(await readFile(target, 'utf8')).toBe('after');
});

const leaseDirectory = vi.hoisted(
  () => `${process.env.TMPDIR ?? process.cwd()}/ne-ipc-leases-${process.pid}-${Math.random()}`
);
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
afterAll(() => removeLeaseDirectory(leaseDirectory, { recursive: true, force: true }));

it.each(['db-init', 'db-close'])(
  'keeps %s outside an unfinished database initialization',
  async (channel) => {
    let release!: () => void;
    let started!: () => void;
    const begun = new Promise<void>((resolve) => {
      started = resolve;
    });
    const events: string[] = [];
    registerWorkspaceHandler('db-init', async (_event, name: string) => {
      events.push(`open ${name}`);
      if (name === 'a') {
        started();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      events.push(`prepared ${name}`);
    });
    registerWorkspaceHandler('db-close', () => {
      events.push('close');
    });
    const event = { sender: { id: 1 } };
    const first = listeners.get('db-init')!(event, 'a');
    await begun;
    const second = listeners.get(channel)!(event, 'b');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const before = [...events];
    release();
    await Promise.all([first, second]);
    expect(before).toEqual(['open a']);
    expect(events).toEqual(
      channel === 'db-close'
        ? ['open a', 'prepared a', 'close']
        : ['open a', 'prepared a', 'open b', 'prepared b']
    );
  }
);

it('releases the GUI completion initialization lease before waiting on the network result', async () => {
  let release!: () => void;
  let begun!: () => void;
  const started = new Promise<void>((resolve) => {
    begun = resolve;
  });
  registerWorkspaceHandler('ai-complete', () => {
    begun();
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  const completion = listeners.get('ai-complete')!({ sender: { id: 1 } });
  await started;
  let admitted = false;
  const other = withWorkspaceLease(() => {
    admitted = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const before = admitted;
  release();
  await Promise.all([completion, other]);
  expect(before).toBe(true);
});
