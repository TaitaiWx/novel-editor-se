// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

describe.skipIf(process.platform !== 'win32')('native Windows recovery guardian', () => {
  const roots: string[] = [];
  const children: ChildProcess[] = [];
  afterEach(async () => {
    await Promise.all(
      children.splice(0).map(async (child) => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      })
    );
    await Promise.all(
      roots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }))
    );
  });
  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'ne-win-guardian-'));
    roots.push(root);
    await Promise.all(
      Object.entries({ nonce: 'nonce123', target: '2.0.0', previous: '1.0.0', timeout: '2' }).map(
        ([name, value]) => writeFile(join(root, name), value)
      )
    );
    return root;
  }
  function start(root: string) {
    const child = spawn(
      join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32/WindowsPowerShell/v1.0/powershell.exe'
      ),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'RemoteSigned',
        '-File',
        resolve('apps/pc/recovery/guardian.ps1'),
        root,
      ],
      { stdio: 'ignore' }
    );
    children.push(child);
    return child;
  }
  async function phase(root: string, expected: string) {
    await expect
      .poll(async () => (await readFile(join(root, 'phase'), 'utf8').catch(() => '')).trim(), {
        timeout: 15000,
      })
      .toBe(expected);
  }
  it('accepts exact target health without invoking any installer', async () => {
    const root = await fixture();
    start(root);
    await phase(root, 'ready');
    await writeFile(join(root, 'healthy'), 'nonce123:2.0.0');
    await writeFile(join(root, 'commit'), '2147483647');
    await phase(root, 'healthy');
    expect(
      await stat(join(root, 'attempted')).then(
        () => true,
        () => false
      )
    ).toBe(false);
  }, 25000);
  it('releases exclusive ownership after a killed guardian and respects cancellation', async () => {
    const root = await fixture();
    const owner = start(root);
    await phase(root, 'ready');
    const contender = start(root);
    expect((await once(contender, 'exit'))[0]).toBe(0);
    const exited = once(owner, 'exit');
    owner.kill();
    await exited;
    start(root);
    await writeFile(join(root, 'cancel'), '1');
    await phase(root, 'cancelled');
  }, 25000);
  it('fails closed on a tampered installer without executing it or replaying recovery', async () => {
    const root = await fixture();
    const artifact = join(root, 'never-execute.exe');
    await writeFile(artifact, 'not an executable');
    await writeFile(join(root, 'artifact'), artifact);
    await writeFile(join(root, 'sha256'), '0'.repeat(64));
    start(root);
    await phase(root, 'ready');
    await writeFile(join(root, 'commit'), '2147483647');
    await phase(root, 'failed');
    expect(await readFile(join(root, 'error.log'), 'utf16le')).toContain('checksum mismatch');
    const restarted = start(root);
    expect((await once(restarted, 'exit'))[0]).toBe(0);
    await phase(root, 'failed');
  }, 25000);
});
