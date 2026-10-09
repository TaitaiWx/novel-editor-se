// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const run = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: (...args: unknown[]) => run(...args) }));
import { installDebianArtifact } from '../../../src/main/auto-updater/debian-install';
const dirs: string[] = [];
afterEach(async () => {
  run.mockReset();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function fixture() {
  const d = await mkdtemp(join(tmpdir(), 'ne-deb-'));
  dirs.push(d);
  const path = join(d, "weird '$` space.deb");
  await writeFile(path, 'verified');
  return path;
}
it('passes a verified local deb as one literal pkexec/dpkg argument', async () => {
  run.mockImplementation((_cmd, _args, _opts, cb) => cb(null, '', ''));
  const path = await fixture();
  await installDebianArtifact(path, {
    algorithm: 'sha256',
    value: createHash('sha256').update('verified').digest('hex'),
  });
  expect(run.mock.calls[0].slice(0, 3)).toEqual([
    '/usr/bin/pkexec',
    ['/usr/bin/dpkg', '--install', path],
    expect.objectContaining({ timeout: 120_000 }),
  ]);
});
it('rejects modified bytes before authorization and reports cancelled authorization as failure', async () => {
  const path = await fixture();
  await expect(
    installDebianArtifact(path, { algorithm: 'sha256', value: 'a'.repeat(64) })
  ).rejects.toThrow('校验');
  expect(run).not.toHaveBeenCalled();
  run.mockImplementation((_cmd, _args, _opts, cb) => cb(new Error('authorization cancelled')));
  await expect(
    installDebianArtifact(path, {
      algorithm: 'sha256',
      value: createHash('sha256').update('verified').digest('hex'),
    })
  ).rejects.toThrow('authorization cancelled');
});
