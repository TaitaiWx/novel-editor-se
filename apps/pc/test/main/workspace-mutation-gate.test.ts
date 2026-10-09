import { rm as removeLeaseDirectory } from 'node:fs/promises';
import { afterAll, expect, it, vi } from 'vitest';
import {
  withWorkspaceMutation,
  withWorkspaceSnapshot,
  withBackgroundWorkspaceMutation,
} from '../../src/main/workspace-mutation-gate';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

it('drains an already running save and holds later writes until the snapshot completes', async () => {
  const first = deferred();
  const copying = deferred();
  const snapshotStarted = deferred();
  const events: string[] = [];
  const save = withWorkspaceMutation(async () => {
    await first.promise;
    events.push('saved');
  });
  const snapshot = withWorkspaceSnapshot(async () => {
    events.push('snapshot');
    snapshotStarted.resolve();
    await copying.promise;
    events.push('published');
  });
  const later = withWorkspaceMutation(() => {
    events.push('later save');
  });
  expect(events).toEqual([]);
  first.resolve();
  await snapshotStarted.promise;
  expect(events).toEqual(['saved', 'snapshot']);
  copying.resolve();
  await Promise.all([save, snapshot, later]);
  expect(events).toEqual(['saved', 'snapshot', 'published', 'later save']);
});

it('allows nested admitted mutations to finish while an export is waiting', async () => {
  const continueSave = deferred();
  const save = withWorkspaceMutation(async () => {
    await continueSave.promise;
    return withWorkspaceMutation(() => 'saved');
  });
  const snapshot = withWorkspaceSnapshot(async () => 'snapshot');
  continueSave.resolve();
  expect(await save).toBe('saved');
  expect(await snapshot).toBe('snapshot');
});

it('releases blocked writes on failed exports and serializes two export snapshots', async () => {
  const copying = deferred();
  const started = deferred();
  const events: string[] = [];
  const first = withWorkspaceSnapshot(async () => {
    events.push('first');
    started.resolve();
    await copying.promise;
    throw new Error('backup failed');
  });
  const failure = expect(first).rejects.toThrow('backup failed');
  const second = withWorkspaceSnapshot(async () => {
    events.push('second');
  });
  const save = withWorkspaceMutation(() => {
    events.push('save');
  });
  await started.promise;
  expect(events).toEqual(['first']);
  copying.resolve();
  await Promise.all([failure, second, save]);
  expect(events).toEqual(['first', 'second', 'save']);
});

it('keeps a detached background download admitted after its parent handler returns', async () => {
  const download = deferred();
  const snapshotStarted = deferred();
  let background!: Promise<void>;
  let snapshotRan = false;
  await withWorkspaceMutation(() => {
    background = withBackgroundWorkspaceMutation(() => download.promise);
  });
  const snapshot = withWorkspaceSnapshot(async () => {
    snapshotRan = true;
    snapshotStarted.resolve();
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(snapshotRan).toBe(false);
  download.resolve();
  await Promise.all([background, snapshot, snapshotStarted.promise]);
  expect(snapshotRan).toBe(true);
});

it('does not suspend writes in a disjoint workspace while a scoped snapshot is active', async () => {
  const copying = deferred();
  const started = deferred();
  const snapshot = withWorkspaceSnapshot(
    async () => {
      started.resolve();
      await copying.promise;
    },
    { resources: ['/tmp/novel-gate-project-a'] }
  );
  await started.promise;
  let written = false;
  const writer = withWorkspaceMutation(
    () => {
      written = true;
    },
    { resources: ['/tmp/novel-gate-project-b'] }
  );
  try {
    await expect.poll(() => written, { timeout: 2000 }).toBe(true);
  } finally {
    copying.resolve();
    await Promise.all([snapshot, writer]);
  }
});

it('preserves overlapping writer call order when the first resource declaration resolves late', async () => {
  let resolve!: (value: { resources: string[] }) => void;
  const options = new Promise<{ resources: string[] }>((r) => {
    resolve = r;
  });
  const events: string[] = [];
  const first = withWorkspaceMutation(() => {
    events.push('first');
  }, options);
  const second = withWorkspaceMutation(
    () => {
      events.push('second');
    },
    { resources: ['/tmp/novel-gate-order'] }
  );
  await new Promise((r) => setTimeout(r, 30));
  const before = [...events];
  resolve({ resources: ['/tmp/novel-gate-order'] });
  await Promise.all([first, second]);
  expect(before).toEqual([]);
  expect(events).toEqual(['first', 'second']);
});

const leaseDirectory = vi.hoisted(
  () => `${process.env.TMPDIR ?? process.cwd()}/ne-gate-leases-${process.pid}-${Math.random()}`
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
