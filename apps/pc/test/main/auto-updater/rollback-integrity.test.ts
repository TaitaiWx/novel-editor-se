import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
const env = vi.hoisted(() => ({ dir: '', version: '1.0.0', download: vi.fn() }));
vi.mock('electron', () => ({
  app: { getVersion: () => env.version, getPath: () => env.dir },
  BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock('../../../src/main/auto-updater/rollback-install', () => ({
  installRollbackArtifact: vi.fn(),
}));
vi.mock('electron-log/main', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../src/main/resilient-downloader', () => ({ download: env.download }));
const bytes = Buffer.alloc(1_100_000, 7);
const digest = createHash('sha256').update(bytes).digest('hex');
const assetName = `Novel-Editor-1.0.0-${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'}-${process.platform === 'linux' && process.arch === 'x64' ? 'x86_64' : process.arch}.${process.platform === 'darwin' ? 'zip' : process.platform === 'win32' ? 'exe' : 'AppImage'}`;
const manifest = {
  rollbackProtocol: 1,
  version: '1.0.0',
  assets: [
    {
      name: assetName,
      platform: process.platform,
      arch: process.arch,
      sha256: digest,
      size: bytes.length,
    },
  ],
};
describe('rollback artifact identity', () => {
  beforeEach(async () => {
    vi.stubEnv('APPIMAGE', '/test/Novel.AppImage');
    vi.resetModules();
    env.dir = await mkdtemp(join(tmpdir(), 'rollback-identity-'));
    env.download.mockReset();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await rm(env.dir, { recursive: true, force: true });
  });
  it('rejects latest metadata claiming a different version even if installer exists', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValue({ ok: true, json: async () => ({ ...manifest, version: '2.0.0' }) });
    vi.stubGlobal('fetch', fetcher);
    const { preCacheCurrentVersion } = await import('../../../src/main/auto-updater/rollback');
    expect(await preCacheCurrentVersion()).toBeNull();
    expect(env.download).not.toHaveBeenCalled();
  });
  it('uses immutable version URL and refuses downloaded bytes that differ from published digest', async () => {
    const fetcher = vi.fn((url: string) =>
      Promise.resolve(
        url.includes('api.github.com') ? { ok: false } : { ok: true, json: async () => manifest }
      )
    );
    vi.stubGlobal('fetch', fetcher);
    env.download.mockImplementation(async ({ destPath }) => {
      await writeFile(destPath, Buffer.alloc(bytes.length, 8));
      return { path: destPath, hash: 'a'.repeat(64) };
    });
    const { preCacheCurrentVersion } = await import('../../../src/main/auto-updater/rollback');
    const result = await preCacheCurrentVersion();
    expect(result?.cachedInstallerPath).toBeNull();
    expect(fetcher.mock.calls.some(([url]) => url.includes('/releases/v1.0.0/manifest.json'))).toBe(
      true
    );
  });
  it('never trusts a large installer without a published digest', async () => {
    const { isCachedInstallerValid } = await import('../../../src/main/auto-updater/rollback');
    const path = join(env.dir, assetName);
    await writeFile(path, bytes);
    expect(await isCachedInstallerValid(path)).toBe(false);
  });
});

describe('bound rollback manifests', () => {
  it('rejects wrong architecture, unversioned names and missing release digests', async () => {
    const { targetFromManifest } = await import('../../../src/main/auto-updater/rollback-metadata');
    for (const patch of [{ arch: 'wrong' }, { name: 'mac-arm64.zip' }, { sha256: '' }]) {
      expect(() =>
        targetFromManifest(
          { ...manifest, assets: [{ ...manifest.assets[0], ...patch }] },
          '1.0.0',
          'https://mirror/releases/v1.0.0'
        )
      ).toThrow();
    }
  });
  it('rejects historical releases without the rollback acknowledgement protocol', async () => {
    const { targetFromManifest } = await import('../../../src/main/auto-updater/rollback-metadata');
    expect(() =>
      targetFromManifest(
        { ...manifest, rollbackProtocol: 0 },
        '1.0.0',
        'https://mirror/releases/v1.0.0'
      )
    ).toThrow('不支持自动回退确认协议');
  });
  it('selects native installer formats for each platform without an architecture fallback', async () => {
    const { rollbackAssetNames } = await import('../../../src/main/auto-updater/rollback-metadata');
    expect(rollbackAssetNames('1.0.0', 'darwin', 'arm64')).toEqual([
      'Novel-Editor-1.0.0-mac-arm64.zip',
    ]);
    expect(rollbackAssetNames('1.0.0', 'win32', 'x64')).toEqual(['Novel-Editor-1.0.0-win-x64.exe']);
    vi.stubEnv('APPIMAGE', '/test/Novel.AppImage');
    expect(rollbackAssetNames('1.0.0', 'linux', 'arm64')).toEqual([
      'Novel-Editor-1.0.0-linux-arm64.AppImage',
    ]);
  });
});
