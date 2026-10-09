import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { withWorkspaceLease } from '../src/workspace-lock';

vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
}));
const realFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
let root: string;
let locks: string;
let otherTicket: string;
const options = () => ({ lockDirectory: locks, resources: [path.join(root, 'chapter.md')] });
const contention = (code: string) => Object.assign(new Error('ticket sharing conflict'), { code });

beforeEach(async () => {
  root = await realFs.realpath(await realFs.mkdtemp(path.join(tmpdir(), 'ne-ticket-contention-')));
  locks = path.join(root, 'locks');
  await realFs.mkdir(locks);
  otherTicket = path.join(locks, `${process.pid}-00000000-0000-0000-0000-000000000000.ticket`);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await realFs.rm(root, { recursive: true, force: true });
});

async function writeOtherTicket(text = JSON.stringify({ number: 1, resources: null })) {
  await realFs.writeFile(otherTicket, text);
}

it.each(['EPERM', 'EACCES', 'EBUSY'])(
  'retries transient %s reads without admitting a writer before the conflicting ticket disappears',
  async (code) => {
    await writeOtherTicket();
    let reads = 0;
    let entered = false;
    vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
      if (String(args[0]) === otherTicket && ++reads <= 3) throw contention(code);
      return realFs.readFile(...args);
    });
    // Attach rejection handling immediately so RED failures cannot leak an unhandled rejection.
    const result = withWorkspaceLease(() => {
      entered = true;
    }, options()).then(
      () => null,
      (error: unknown) => error
    );
    try {
      await expect.poll(() => reads).toBeGreaterThanOrEqual(4);
      expect(entered).toBe(false);
      expect(await realFs.readFile(otherTicket, 'utf8')).toContain('"number":1');
    } finally {
      await realFs.unlink(otherTicket);
      await result;
    }
    expect(await result).toBeNull();
    expect(entered).toBe(true);
    expect(await realFs.readdir(locks)).toEqual([]);
  }
);

it('accepts absence only when a retried ticket read actually returns ENOENT', async () => {
  await writeOtherTicket();
  let reads = 0;
  vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
    if (String(args[0]) === otherTicket && ++reads === 1) {
      await realFs.unlink(otherTicket);
      throw contention('EPERM');
    }
    return realFs.readFile(...args);
  });
  let entered = false;
  await withWorkspaceLease(() => {
    entered = true;
  }, options());
  expect(reads).toBe(2);
  expect(entered).toBe(true);
  expect(await realFs.readdir(locks)).toEqual([]);
});

it.each(['EPERM', 'EACCES', 'EBUSY', 'EIO'])(
  'fails closed on persistent %s reading an existing ticket and cleans its own admission files',
  async (code) => {
    await writeOtherTicket();
    let reads = 0;
    const task = vi.fn();
    vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
      if (String(args[0]) === otherTicket) {
        reads++;
        throw contention(code);
      }
      return realFs.readFile(...args);
    });
    await expect(withWorkspaceLease(task, options())).rejects.toMatchObject({ code });
    expect(reads).toBe(code === 'EIO' ? 1 : 9);
    expect(task).not.toHaveBeenCalled();
    expect(await realFs.readdir(locks)).toEqual([path.basename(otherTicket)]);
    expect(await realFs.readFile(otherTicket, 'utf8')).toContain('"number":1');
  }
);

it('does not retry malformed ticket JSON or interpret it as an absent owner', async () => {
  await writeOtherTicket('{ malformed');
  let reads = 0;
  const task = vi.fn();
  vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
    if (String(args[0]) === otherTicket) reads++;
    return realFs.readFile(...args);
  });
  await expect(withWorkspaceLease(task, options())).rejects.toBeInstanceOf(SyntaxError);
  expect(reads).toBe(1);
  expect(task).not.toHaveBeenCalled();
  expect(await realFs.readdir(locks)).toEqual([path.basename(otherTicket)]);
});

it('honors the lease deadline during repeated ticket read contention', async () => {
  await writeOtherTicket();
  const task = vi.fn();
  let reads = 0;
  vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
    if (String(args[0]) === otherTicket) {
      reads++;
      throw contention('EPERM');
    }
    return realFs.readFile(...args);
  });
  await expect(withWorkspaceLease(task, { ...options(), timeoutMs: 1 })).rejects.toThrow(
    '工作区正在'
  );
  expect(reads).toBeLessThan(9);
  expect(task).not.toHaveBeenCalled();
  expect(await realFs.readdir(locks)).toEqual([path.basename(otherTicket)]);
});

it('checks the expired lease deadline before a retry that would confirm absence', async () => {
  await writeOtherTicket();
  const task = vi.fn();
  let reads = 0;
  vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
    if (String(args[0]) === otherTicket && ++reads === 1) {
      await realFs.unlink(otherTicket);
      throw contention('EPERM');
    }
    return realFs.readFile(...args);
  });
  await expect(withWorkspaceLease(task, { ...options(), timeoutMs: 5 })).rejects.toThrow(
    '工作区正在'
  );
  expect(reads).toBe(1);
  expect(task).not.toHaveBeenCalled();
  expect(await realFs.readdir(locks)).toEqual([]);
});

it.each(['EPERM', 'EACCES', 'EBUSY'])(
  'retries transient %s removing its completed ticket rather than leaving a live-PID blocker',
  async (code) => {
    let removals = 0;
    vi.spyOn(fs, 'unlink').mockImplementation(async (...args) => {
      if (String(args[0]).endsWith('.ticket') && ++removals <= 3) throw contention(code);
      return realFs.unlink(...args);
    });
    await withWorkspaceLease(() => {}, options());
    expect(removals).toBe(4);
    expect(await realFs.readdir(locks)).toEqual([]);
  }
);

it('retries transient removal of a verified dead process ticket', async () => {
  const deadPid = 2147483647;
  otherTicket = path.join(locks, `${deadPid}-00000000-0000-0000-0000-000000000000.ticket`);
  await writeOtherTicket();
  const kill = process.kill.bind(process);
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (pid === deadPid) throw Object.assign(new Error('dead fixture'), { code: 'ESRCH' });
    return kill(pid, signal);
  });
  let removals = 0;
  vi.spyOn(fs, 'unlink').mockImplementation(async (...args) => {
    if (String(args[0]) === otherTicket && ++removals <= 3) throw contention('EPERM');
    return realFs.unlink(...args);
  });
  await withWorkspaceLease(() => {}, options());
  expect(removals).toBe(4);
  expect(await realFs.readdir(locks)).toEqual([]);
});
