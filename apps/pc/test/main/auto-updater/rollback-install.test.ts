// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { EventEmitter } from 'events';
import { app } from 'electron';
const env = vi.hoisted(() => ({
  actions: [] as string[],
  feed: '',
  targetVersion: '1.0.0',
  allowed: true,
  failDownload: false,
  forward: { autoInstallOnAppQuit: true },
}));
class Updater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowDowngrade = false;
  setFeedURL(options: { url: string }) {
    env.feed = options.url;
  }
  async checkForUpdates() {
    const metadata = await (await fetch(`${env.feed}latest.yml`)).json();
    env.actions.push('check');
    return { isUpdateAvailable: true, updateInfo: { ...metadata, version: env.targetVersion } };
  }
  async downloadUpdate() {
    if (env.failDownload) throw new Error('disk full');
    env.actions.push('download');
  }
  quitAndInstall(silent: boolean, launch: boolean) {
    expect([silent, launch]).toEqual([true, true]);
    env.actions.push('install');
    app.emit('will-quit');
  }
}
vi.mock('electron', () => {
  const native = new EventEmitter() as EventEmitter & { checkForUpdates: () => void };
  native.checkForUpdates = () => {
    native.emit('update-downloaded');
  };
  return { autoUpdater: native, app: new EventEmitter() };
});
vi.mock('electron-updater', () => ({
  MacUpdater: class extends Updater {},
  NsisUpdater: class extends Updater {},
  AppImageUpdater: class extends Updater {},
}));
vi.mock('electron-log/main', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../src/main/auto-updater/loader', () => ({
  getAutoUpdater: async () => env.forward,
}));
vi.mock('../../../src/main/graceful-shutdown', () => ({
  prepareAppForExit: async (exit: () => void | Promise<void>) => {
    env.actions.push('save');
    if (!env.allowed) return false;
    await exit();
    return true;
  },
}));
import {
  installRollbackArtifact,
  serveRollbackArtifact,
} from '../../../src/main/auto-updater/rollback-install';
const target = {
  sha256: createHash('sha256').update('verified bytes').digest('hex'),
  version: '1.0.0',
  tag: 'v1.0.0',
  assetName: 'Novel-Editor-1.0.0-mac-arm64.zip',
  assetUrl: 'https://example.invalid/a.zip',
  cachedInstallerPath: null,
  cachedInstallerHash: null,
};
let dir: string;
let artifact: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rollback-native-'));
  artifact = join(dir, 'artifact.zip');
  await writeFile(artifact, 'verified bytes');
  env.actions = [];
  env.targetVersion = '1.0.0';
  env.allowed = true;
  env.failDownload = false;
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});
describe('native rollback handoff', () => {
  it('serves only scoped metadata and exact artifact bytes, with SHA512 for native verification', async () => {
    const feed = await serveRollbackArtifact(target, artifact);
    try {
      const info = await (await fetch(`${feed.url}latest-mac.yml`)).json();
      expect(info.version).toBe('1.0.0');
      const bytes = await (await fetch(`${feed.url}${info.files[0].url}`)).text();
      expect(bytes).toBe('verified bytes');
      expect(info.files[0].sha512).toBe(createHash('sha512').update(bytes).digest('base64'));
      expect((await fetch(new URL('/latest.yml', feed.url))).status).toBe(404);
      expect((await fetch(`${feed.url}updater-state.json`)).status).toBe(404);
    } finally {
      feed.close();
    }
  });
  it.each(['darwin', 'win32', 'linux'])(
    'uses the native %s updater and awaits save before install/relaunch',
    async (platform) => {
      vi.stubGlobal('process', {
        ...process,
        platform,
        env: { ...process.env, APPIMAGE: '/app/Novel.AppImage' },
      });
      await installRollbackArtifact(target, artifact);
      expect(env.actions).toEqual(['check', 'download', 'save', 'install']);
      expect(env.forward.autoInstallOnAppQuit).toBe(false);
    }
  );
  describe.each(['darwin', 'win32', 'linux'])('%s failure handling', (platform) => {
    beforeEach(() => {
      vi.stubGlobal('process', {
        ...process,
        platform,
        env: { ...process.env, APPIMAGE: '/app/Novel.AppImage' },
      });
    });

    it('save failure prevents installer execution', async () => {
      env.allowed = false;
      await expect(installRollbackArtifact(target, artifact)).rejects.toThrow('安全保存');
      expect(env.actions).toEqual(['check', 'download', 'save']);
    });
    it('metadata version mismatch prevents downloading and installation', async () => {
      env.targetVersion = '2.0.0';
      await expect(installRollbackArtifact(target, artifact)).rejects.toThrow('目标回退版本');
      expect(env.actions).toEqual(['check']);
    });
    it('download failure prevents installation', async () => {
      env.failDownload = true;
      await expect(installRollbackArtifact(target, artifact)).rejects.toThrow('disk full');
      expect(env.actions).toEqual(['check']);
    });
  });
  it('fails closed for Linux package-manager installations', async () => {
    vi.stubGlobal('process', { ...process, platform: 'linux', env: {} });
    await expect(installRollbackArtifact(target, artifact)).rejects.toThrow('不支持自动回退');
    expect(env.actions).toEqual([]);
  });
});
