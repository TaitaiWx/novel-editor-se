/** Serve verified bytes to electron-updater, which owns native installation and relaunch. */
import { app } from 'electron';
import { installDebianArtifact } from './debian-install';
import { createHash, randomBytes } from 'crypto';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import type { AppUpdater } from 'electron-updater';
import log from 'electron-log/main';
import type { RollbackTarget } from '../auto-updater-state';
import { prepareAppForExit } from '../graceful-shutdown';
import { getAutoUpdater } from './loader';
import { prepareNativeUpdate, handoffNativeUpdate } from './native-install';

export async function serveRollbackArtifact(target: RollbackTarget, installerPath: string) {
  const hash = createHash('sha512');
  const publishedHash = createHash('sha256');
  for await (const chunk of createReadStream(installerPath)) {
    hash.update(chunk);
    publishedHash.update(chunk);
  }
  if (publishedHash.digest('hex') !== target.sha256) throw new Error('回退包与发布摘要不匹配');
  const sha512 = hash.digest('base64');
  const size = (await stat(installerPath)).size;
  const prefix = `/${randomBytes(24).toString('hex')}/`;
  const assetPath = `${prefix}${encodeURIComponent(target.assetName)}`;
  const manifest = JSON.stringify({
    version: target.version,
    files: [{ url: target.assetName, sha512, size }],
    path: target.assetName,
    sha512,
    releaseDate: new Date().toISOString(),
  });
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    if (pathname === assetPath) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = createReadStream(installerPath);
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } else if (
      pathname.startsWith(prefix) &&
      /^latest(?:-mac|-linux(?:-arm64|-armv7l)?)?\.yml$/.test(pathname.slice(prefix.length))
    ) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(manifest);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  server.unref();
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}${prefix}`,
    close: () => {
      server.close();
      server.closeAllConnections();
    },
  };
}

export async function createRollbackUpdater(): Promise<AppUpdater> {
  const module = await import('electron-updater');
  if (process.platform === 'darwin') return new module.MacUpdater();
  if (process.platform === 'win32') return new module.NsisUpdater();
  if (process.platform === 'linux' && process.env.APPIMAGE) return new module.AppImageUpdater();
  throw new Error('当前安装形式不支持自动回退，请使用 AppImage 或系统安装包恢复旧版本');
}

export async function installRollbackArtifact(target: RollbackTarget, installerPath: string) {
  const forwardUpdater = await getAutoUpdater();
  if (forwardUpdater) forwardUpdater.autoInstallOnAppQuit = false;
  if (process.platform === 'linux' && !process.env.APPIMAGE) {
    if (!target.assetName.endsWith('.deb') || !target.sha256)
      throw new Error('当前安装形式不支持自动回退：需要当前架构的 Debian 安装包');
    if (
      !(await prepareAppForExit(async () => {
        await installDebianArtifact(installerPath, { algorithm: 'sha256', value: target.sha256! });
        app.relaunch();
        app.quit();
      }))
    )
      throw new Error('未能安全保存当前内容，已取消回退安装');
    return;
  }
  const updater = await createRollbackUpdater();
  updater.logger = log;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.autoRunAppAfterInstall = true;
  updater.allowDowngrade = true;
  updater.allowPrerelease = true;
  updater.disableDifferentialDownload = true;
  updater.channel = 'latest';
  let installationError: Error | null = null;
  updater.on('error', (error) => {
    installationError = error;
    log.error('回退安装失败，保留待确认状态:', error);
  });
  const server = await serveRollbackArtifact(target, installerPath);
  try {
    updater.setFeedURL({ provider: 'generic', url: server.url, useMultipleRangeRequest: false });
    const result = await updater.checkForUpdates();
    if (!result?.isUpdateAvailable || result.updateInfo.version !== target.version)
      throw new Error('原生更新器未确认目标回退版本');
    await updater.downloadUpdate();
    if (installationError) throw installationError;
    await prepareNativeUpdate();
    const accepted = await prepareAppForExit(() => handoffNativeUpdate(updater));
    if (!accepted) throw new Error('未能安全保存当前内容，已取消回退安装');
  } finally {
    server.close();
  }
}
