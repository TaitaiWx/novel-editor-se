// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acknowledgeRecoveryHealth,
  armRecovery,
} from '../../../src/main/auto-updater/recovery-supervisor';
const roots: string[] = [];
const id = 'f'.repeat(48);
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ne-health-'));
  roots.push(root);
  const dir = join(root, 'update-recovery', id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(root, 'update-recovery', 'active.json'),
    JSON.stringify({ protocol: 1, id, target: '2.0.0', previous: '1.0.0' })
  );
  await writeFile(join(dir, 'phase'), 'watching');
  return { root, dir };
}
it('rejects a late target acknowledgement when recovery claimed decision but phase still reads watching', async () => {
  const { root, dir } = await fixture();
  await writeFile(join(dir, 'decision'), '');
  expect(await acknowledgeRecoveryHealth(root, '2.0.0')).toBe(false);
  expect(await readFile(join(dir, 'healthy'), 'utf8').catch(() => 'missing')).toBe('missing');
});
it('an actual healthy target claims the same atomic decision used by the guardian', async () => {
  const { root, dir } = await fixture();
  expect(await acknowledgeRecoveryHealth(root, '2.0.0')).toBe(true);
  await expect(writeFile(join(dir, 'decision'), '', { flag: 'wx' })).rejects.toMatchObject({
    code: 'EEXIST',
  });
  expect(await readFile(join(dir, 'healthy'), 'utf8')).toBe(`${id}:2.0.0`);
});
it('refuses legacy artifacts before touching recovery resources or registering login hooks', async () => {
  await expect(
    armRecovery({
      userData: '/unused',
      executable: '/unused',
      resourcesPath: '/unused',
      targetVersion: '2.0.0',
      previous: {
        version: '1.0.0',
        rollbackProtocol: 1,
        tag: 'v1.0.0',
        assetName: 'old.zip',
        assetUrl: 'https://invalid/old.zip',
        cachedInstallerPath: '/unused',
        cachedInstallerHash: null,
        sha256: 'a'.repeat(64),
      },
    })
  ).rejects.toThrow('独立恢复确认协议');
});

it('late healthy old startup resolves a failed recovery only for the exact previous version', async () => {
  const { root, dir } = await fixture();
  await writeFile(join(dir, 'phase'), 'failed');
  expect(await acknowledgeRecoveryHealth(root, '2.0.0')).toBe(false);
  expect(await acknowledgeRecoveryHealth(root, '1.0.0')).toBe(true);
  expect(await readFile(join(dir, 'healthy'), 'utf8')).toBe(`${id}:1.0.0`);
  expect(await readFile(join(dir, 'phase'), 'utf8')).toBe('recovered');
});
