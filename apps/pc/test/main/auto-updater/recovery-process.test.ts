// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
describe.skipIf(process.platform === 'win32')('POSIX recovery guardian processes', () => {
  const dirs: string[] = [];
  const children: ChildProcess[] = [];
  afterEach(async () => {
    for (const child of children.splice(0)) child.kill('SIGKILL');
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });
  async function until(path: string, expected: string) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if ((await readFile(path, 'utf8').catch(() => '')).trim() === expected) return;
      await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error(`Expected ${expected}; got ${await readFile(path, 'utf8').catch(String)}`);
  }
  async function fixture(recovery = 'printf restored >> "$1/attempts"') {
    const dir = await mkdtemp(join(tmpdir(), 'ne-guardian-'));
    dirs.push(dir);
    await Promise.all(
      Object.entries({
        nonce: 'nonce123',
        target: '2.0.0',
        previous: '1.0.0',
        timeout: '2',
        'recover.sh': `#!/bin/sh\nset -eu\n${recovery}\n`,
      }).map(([name, value]) => writeFile(join(dir, name), value))
    );
    return dir;
  }
  function start(dir: string) {
    const child = spawn('/bin/sh', [resolve('apps/pc/recovery/guardian.sh'), dir], {
      stdio: 'ignore',
    });
    children.push(child);
    return child;
  }
  async function commit(dir: string, pid = 2147483647) {
    await writeFile(join(dir, 'commit'), String(pid));
  }
  it('waits for commit, acknowledges only the exact nonce/version, and never recovers a healthy target', async () => {
    const dir = await fixture();
    start(dir);
    await until(join(dir, 'phase'), 'ready');
    await writeFile(join(dir, 'healthy'), 'wrong:2.0.0');
    await commit(dir);
    await until(join(dir, 'phase'), 'watching');
    await writeFile(join(dir, 'healthy'), 'nonce123:2.0.0');
    await until(join(dir, 'phase'), 'healthy');
    expect(await readFile(join(dir, 'attempts'), 'utf8').catch(() => '')).toBe('');
  });
  it.each(['abort', 'kill', 'no-health'] as const)(
    'restores after real child %s without target JS health acknowledgement',
    async (failure) => {
      const dir = await fixture();
      const target =
        failure === 'abort'
          ? spawn('/bin/sh', ['-c', 'ulimit -c 0; kill -ABRT $$'], { stdio: 'ignore' })
          : spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
      children.push(target);
      start(dir);
      await until(join(dir, 'phase'), 'ready');
      if (failure === 'kill') target.kill('SIGKILL');
      await commit(dir);
      await until(join(dir, 'phase'), 'restored-awaiting-health');
      expect(await readFile(join(dir, 'attempts'), 'utf8')).toBe('restored');
      // Installer exit alone is never successful recovery.
      await writeFile(join(dir, 'healthy'), 'nonce123:1.0.0');
      await until(join(dir, 'phase'), 'recovered');
    }
  );
  it('persists an attempted restore and never repeats it after supervisor restart', async () => {
    const dir = await fixture('printf attempted >> "$1/attempts"; exit 7');
    start(dir);
    await until(join(dir, 'phase'), 'ready');
    await commit(dir);
    await until(join(dir, 'phase'), 'failed');
    start(dir);
    await new Promise((r) => setTimeout(r, 300));
    expect(await readFile(join(dir, 'attempts'), 'utf8')).toBe('attempted');
    expect((await readFile(join(dir, 'phase'), 'utf8')).trim()).toBe('failed');
  });
  it('cancel before installation cannot restore or overwrite anything', async () => {
    const dir = await fixture();
    start(dir);
    await until(join(dir, 'phase'), 'ready');
    await writeFile(join(dir, 'cancel'), '1');
    await until(join(dir, 'phase'), 'cancelled');
    expect(await readFile(join(dir, 'attempts'), 'utf8').catch(() => '')).toBe('');
  });
  it('does not start the health timeout while the old application is saving', async () => {
    const dir = await fixture();
    start(dir);
    await until(join(dir, 'phase'), 'ready');
    await commit(dir, process.pid);
    await new Promise((r) => setTimeout(r, 1300));
    expect((await readFile(join(dir, 'phase'), 'utf8')).trim()).toBe('ready');
    await writeFile(join(dir, 'cancel'), '1');
    await until(join(dir, 'phase'), 'cancelled');
  });

  it('two guardians share one persistent recovery claim', async () => {
    const dir = await fixture();
    start(dir);
    start(dir);
    await until(join(dir, 'phase'), 'ready');
    await commit(dir);
    await until(join(dir, 'phase'), 'restored-awaiting-health');
    await writeFile(join(dir, 'healthy'), 'nonce123:1.0.0');
    await until(join(dir, 'phase'), 'recovered');
    expect(await readFile(join(dir, 'attempts'), 'utf8')).toBe('restored');
  });
  it('a guardian restarted before restore resumes the persisted deadline', async () => {
    const dir = await fixture();
    const first = start(dir);
    await until(join(dir, 'phase'), 'ready');
    await commit(dir);
    await until(join(dir, 'phase'), 'watching');
    first.kill('SIGKILL');
    await new Promise<void>((r) => first.once('exit', () => r()));
    start(dir);
    await until(join(dir, 'phase'), 'restored-awaiting-health');
    await writeFile(join(dir, 'healthy'), 'nonce123:1.0.0');
    await until(join(dir, 'phase'), 'recovered');
    expect(await readFile(join(dir, 'attempts'), 'utf8')).toBe('restored');
  });

  it('next-login recovery ignores a reused parent PID from the previous boot', async () => {
    const dir = await fixture();
    await writeFile(join(dir, 'armed-boot'), 'previous-boot');
    await commit(dir, process.pid);
    start(dir);
    await until(join(dir, 'phase'), 'restored-awaiting-health');
    await writeFile(join(dir, 'healthy'), 'nonce123:1.0.0');
    await until(join(dir, 'phase'), 'recovered');
  });

  it('a paused owner remains exclusive beyond one second without a lease takeover', async () => {
    const dir = await fixture();
    const owner = start(dir);
    await until(join(dir, 'phase'), 'ready');
    owner.kill('SIGSTOP');
    await new Promise((r) => setTimeout(r, 1200));
    await writeFile(join(dir, 'phase'), 'owner-paused');
    const contender = start(dir);
    await new Promise<void>((r) => contender.once('exit', () => r()));
    expect((await readFile(join(dir, 'phase'), 'utf8')).trim()).toBe('owner-paused');
    owner.kill('SIGCONT');
    await writeFile(join(dir, 'cancel'), '1');
    await until(join(dir, 'phase'), 'cancelled');
  });
  it('resumes the same mac directory publication after a killed guardian leaves the app path missing', async () => {
    const publish = resolve('apps/pc/recovery/publish-mac.sh');
    const dir = await fixture(`if [ "\${2-}" != --resume ]; then
    /bin/mv "$1/installed" "$1/failed-app"
    kill -KILL "$PPID"
    exit 1
  fi
  /bin/sh '${publish}' "$1/staged" "$1/installed" "$1/failed-app"`);
    await writeFile(join(dir, 'mode'), 'mac');
    await mkdir(join(dir, 'installed'));
    await mkdir(join(dir, 'staged'));
    await writeFile(join(dir, 'installed', 'version'), 'broken');
    await writeFile(join(dir, 'staged', 'version'), 'verified-old');
    const first = start(dir);
    await until(join(dir, 'phase'), 'ready');
    await commit(dir);
    await new Promise<void>((r) => first.once('exit', () => r()));
    await new Promise((r) => setTimeout(r, 100));
    expect(await readFile(join(dir, 'installed', 'version'), 'utf8').catch(() => 'missing')).toBe(
      'missing'
    );
    start(dir);
    await until(join(dir, 'phase'), 'restored-awaiting-health');
    expect(await readFile(join(dir, 'installed', 'version'), 'utf8')).toBe('verified-old');
    await writeFile(join(dir, 'healthy'), 'nonce123:1.0.0');
    await until(join(dir, 'phase'), 'recovered');
  });

  it('resumes a fully published restore decision after death before the attempt marker', async () => {
    const dir = await fixture();
    await writeFile(join(dir, 'decision'), 'restore:nonce123');
    await writeFile(join(dir, 'phase'), 'watching');
    start(dir);
    await until(join(dir, 'phase'), 'restored-awaiting-health');
    await writeFile(join(dir, 'healthy'), 'nonce123:1.0.0');
    await until(join(dir, 'phase'), 'recovered');
    expect(await readFile(join(dir, 'attempts'), 'utf8')).toBe('restored');
  });
  it('a fully published healthy decision survives death before the separate acknowledgement file', async () => {
    const dir = await fixture();
    await writeFile(join(dir, 'decision'), 'healthy:nonce123:2.0.0');
    await commit(dir);
    start(dir);
    await until(join(dir, 'phase'), 'healthy');
    expect(await readFile(join(dir, 'attempts'), 'utf8').catch(() => '')).toBe('');
  });

  it('resumes a mac attempt marker published before its recovering phase', async () => {
    const dir = await fixture();
    await writeFile(join(dir, 'mode'), 'mac');
    await writeFile(join(dir, 'phase'), 'watching');
    await writeFile(join(dir, 'decision'), 'restore:nonce123');
    await mkdir(join(dir, 'attempted'));
    start(dir);
    await until(join(dir, 'phase'), 'restored-awaiting-health');
    await writeFile(join(dir, 'healthy'), 'nonce123:1.0.0');
    await until(join(dir, 'phase'), 'recovered');
    expect(await readFile(join(dir, 'attempts'), 'utf8')).toBe('restored');
  });
});
