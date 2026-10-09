import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createRollbackManifest } from '../../../scripts/create-rollback-manifest.mjs';
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'rollback-manifest-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
it('only emits exact version native artifacts, their published digests, and matching protocol capability', async () => {
  await writeFile(join(directory, 'Novel-Editor-1.0.0-mac-arm64.zip'), 'old-binary');
  await writeFile(join(directory, 'mac-arm64.zip'), 'wrong-shortcut');
  await writeFile(join(directory, 'Novel-Editor-2.0.0-mac-arm64.zip'), 'new-binary');
  const legacy = await createRollbackManifest(directory, '1.0.0');
  expect(legacy.rollbackProtocol).toBe(0);
  expect(legacy.assets).toHaveLength(1);
  await writeFile(
    join(directory, 'rollback-protocol.json'),
    JSON.stringify({ version: '1.0.0', rollbackProtocol: 1 })
  );
  const supported = await createRollbackManifest(directory, '1.0.0');
  expect(supported.rollbackProtocol).toBe(1);
  expect(supported.assets[0]).toMatchObject({
    name: 'Novel-Editor-1.0.0-mac-arm64.zip',
    platform: 'darwin',
    arch: 'arm64',
    sha256: createHash('sha256').update('old-binary').digest('hex'),
  });
  expect((await createRollbackManifest(directory, '2.0.0')).rollbackProtocol).toBe(0);
});
it('rejects unsafe version paths and directories without version-bound installers', async () => {
  await expect(createRollbackManifest(directory, '../latest')).rejects.toThrow(
    'Invalid release version'
  );
  await expect(createRollbackManifest(directory, '1.0.0')).rejects.toThrow('No version-bound');
});
it('recovery capability is separate and only trusted from the matching shipped marker', async () => {
  await writeFile(join(directory, 'Novel-Editor-1.0.0-mac-arm64.zip'), 'old-binary');
  expect((await createRollbackManifest(directory, '1.0.0')).recoveryProtocol).toBe(0);
  for (const [markerVersion, recoveryProtocol, expected] of [
    ['1.0.0', 1, 1],
    ['2.0.0', 1, 0],
    ['1.0.0', undefined, 0],
  ] as const) {
    await writeFile(
      join(directory, 'rollback-protocol.json'),
      JSON.stringify({ version: markerVersion, rollbackProtocol: 1, recoveryProtocol })
    );
    expect((await createRollbackManifest(directory, '1.0.0')).recoveryProtocol).toBe(expected);
  }
});
it('includes shipped Debian packages with canonical architecture and digest', async () => {
  await writeFile(join(directory, 'Novel-Editor-1.0.0-linux-amd64.deb'), 'debian-package');
  const manifest = await createRollbackManifest(directory, '1.0.0');
  expect(manifest.assets).toEqual([
    {
      name: 'Novel-Editor-1.0.0-linux-amd64.deb',
      platform: 'linux',
      arch: 'x64',
      size: 14,
      sha256: createHash('sha256').update('debian-package').digest('hex'),
    },
  ]);
});
