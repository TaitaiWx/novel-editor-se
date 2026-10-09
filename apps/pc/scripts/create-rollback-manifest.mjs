/** Immutable rollback manifests only trust the capability marker shipped with the release. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @param {string} directory @param {string} version */
export async function createRollbackManifest(directory, version) {
  if (!/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(version))
    throw new Error('Invalid release version');
  let protocol = { version: '', rollbackProtocol: 0, recoveryProtocol: 0 };
  try {
    protocol = JSON.parse(await readFile(join(directory, 'rollback-protocol.json'), 'utf8'));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
  }
  const compatible = protocol.version === version && protocol.rollbackProtocol === 1;
  const assets = [];
  for (const name of (await readdir(directory)).sort()) {
    const prefix = `Novel-Editor-${version}-`;
    if (!name.startsWith(prefix)) continue;
    const match = /^(mac|win|linux)-(arm64|x64|ia32|x86_64|amd64)\.(zip|exe|AppImage|deb)$/.exec(
      name.slice(prefix.length)
    );
    if (!match) continue;
    const [, os, arch, ext] = match;
    if (!['mac.zip', 'win.exe', 'linux.AppImage', 'linux.deb'].includes(`${os}.${ext}`)) continue;
    const path = join(directory, name);
    const file = await stat(path);
    if (!file.isFile()) continue;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    assets.push({
      name,
      platform: os === 'mac' ? 'darwin' : os === 'win' ? 'win32' : 'linux',
      arch: arch === 'x86_64' || arch === 'amd64' ? 'x64' : arch,
      size: file.size,
      sha256: hash.digest('hex'),
    });
  }
  if (!assets.length) throw new Error('No version-bound native updater artifacts');
  return {
    version,
    rollbackProtocol: compatible ? 1 : 0,
    recoveryProtocol: compatible && protocol.recoveryProtocol === 1 ? 1 : 0,
    assets,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , directory, version] = process.argv;
  const manifest = await createRollbackManifest(directory, version);
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}
