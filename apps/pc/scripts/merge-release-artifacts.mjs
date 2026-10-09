/** Merge architecture jobs before publication; download-artifact must retain their directories. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRollbackManifest } from './create-rollback-manifest.mjs';

// Use the same YAML parser as the installed updater, without relying on pnpm's hoisted layout.
const require = createRequire(import.meta.url);
const updaterRequire = createRequire(require.resolve('electron-updater/package.json'));
/** @typedef {{url: string, sha512: string, size?: number}} ArtifactInfo */
/** @typedef {{version: string, channel?: string, stagingPercentage?: number, files: ArtifactInfo[]}} UpdateMetadata */
/** @type {{load: (text: string) => unknown, dump: (value: unknown, options: {lineWidth: number}) => string}} */
const yaml = updaterRequire('js-yaml');
const REQUIRED = [
  ['mac', 'x64', 'zip'],
  ['mac', 'arm64', 'zip'],
  ['win', 'x64', 'exe'],
  ['win', 'ia32', 'exe'],
  ['win', 'arm64', 'exe'],
  ['linux', 'x64', 'AppImage'],
];

/** @param {string} file @param {string} [algorithm] @param {import("node:crypto").BinaryToTextEncoding} [encoding] */
async function digest(file, algorithm = 'sha512', encoding = 'base64') {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}

/** @param {string} directory @returns {Promise<string[]>} */
async function listFiles(directory) {
  const result = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await listFiles(file)));
    else if (entry.isFile()) result.push(file);
    else throw new Error(`Unsupported release artifact: ${file}`);
  }
  return result;
}

/** Validate all six native updater targets, hashes, version/channel and rollback marker before publish. */
/** @param {string} input @param {string} output @param {string} version @param {string} channel */
export async function mergeReleaseArtifacts(input, output, version, channel) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error('Invalid release version');
  if (!['latest', 'beta', 'alpha'].includes(channel)) throw new Error('Invalid release channel');
  /** @type {Map<string, string>} */
  const assets = new Map();
  /** @type {Map<string, UpdateMetadata[]>} */
  const groups = new Map();
  for (const file of await listFiles(input)) {
    const name = basename(file);
    if (name === 'builder-debug.yml') continue;
    if (name.endsWith('.yml')) {
      const match = /^(latest|beta|alpha)(-mac|-linux)?\.yml$/.exec(name);
      if (!match || match[1] !== channel) throw new Error(`Unexpected metadata channel: ${name}`);
      const info = /** @type {UpdateMetadata} */ (yaml.load(await readFile(file, 'utf8')));
      if (info?.channel !== undefined && info.channel !== channel)
        throw new Error(`Metadata channel mismatch: ${name}`);
      if (info?.version !== version) throw new Error(`Metadata version mismatch: ${name}`);
      if (!Array.isArray(info.files) || info.files.length === 0)
        throw new Error(`Missing metadata files: ${name}`);
      const group = groups.get(name) ?? [];
      group.push(info);
      groups.set(name, group);
    } else {
      const existing = assets.get(name);
      if (existing && (await digest(existing)) !== (await digest(file)))
        throw new Error(`Conflicting artifact bytes: ${name}`);
      assets.set(name, file);
    }
  }
  const marker = assets.get('rollback-protocol.json');
  if (!marker) throw new Error('Missing rollback-protocol.json');
  const protocol = JSON.parse(await readFile(marker, 'utf8'));
  if (protocol.version !== version || protocol.rollbackProtocol !== 1)
    throw new Error('Rollback protocol/version mismatch');
  if (protocol.recoveryProtocol !== 1) throw new Error('Recovery protocol missing');
  const merged = new Map();
  const referenced = new Set();
  const checksums = new Map();
  for (const [name, documents] of groups) {
    const files = new Map();
    const os = name.endsWith('-mac.yml') ? 'mac' : name.endsWith('-linux.yml') ? 'linux' : 'win';
    for (const document of documents) {
      if (document.stagingPercentage !== documents[0].stagingPercentage)
        throw new Error(`Conflicting rollout: ${name}`);
      for (const info of document.files) {
        if (
          typeof info.url !== 'string' ||
          basename(info.url) !== info.url ||
          !info.url.startsWith(`Novel-Editor-${version}-${os}-`)
        )
          throw new Error(`Invalid metadata asset URL: ${info.url}`);
        const source = assets.get(info.url);
        if (!source) throw new Error(`Missing metadata asset: ${info.url}`);
        if (!checksums.has(info.url)) checksums.set(info.url, await digest(source));
        if (info.sha512 !== checksums.get(info.url))
          throw new Error(`Artifact checksum mismatch: ${info.url}`);
        if (info.size !== undefined && info.size !== (await stat(source)).size)
          throw new Error(`Artifact size mismatch: ${info.url}`);
        const existing = files.get(info.url);
        if (existing && JSON.stringify(existing) !== JSON.stringify(info))
          throw new Error(`Conflicting metadata asset: ${info.url}`);
        files.set(info.url, info);
        referenced.add(info.url);
      }
    }
    const sorted = [...files.values()].sort((a, b) => a.url.localeCompare(b.url));
    const suffix =
      os === 'mac' ? '-mac-x64.zip' : os === 'win' ? '-win-x64.exe' : '-linux-x64.AppImage';
    const preferred =
      sorted.find((file) => file.url.endsWith(suffix)) ??
      sorted.find((file) => file.url.endsWith('-linux-x86_64.AppImage'));
    if (!preferred) throw new Error(`Missing default architecture in ${name}`);
    const original = documents.find((doc) => doc.files.some((file) => file.url === preferred.url));
    // Current updater selects from files by process.arch (Mac also filters ARM/Rosetta).
    // Legacy path/sha512 consistently use x64, independent of matrix completion order.
    merged.set(name, { ...original, files: sorted, path: preferred.url, sha512: preferred.sha512 });
  }
  for (const [os, arch, extension] of REQUIRED) {
    const names = [`Novel-Editor-${version}-${os}-${arch}.${extension}`];
    if (os === 'linux') names.push(`Novel-Editor-${version}-linux-x86_64.AppImage`);
    if (!names.some((name) => referenced.has(name)))
      throw new Error(`Missing updater architecture: ${os}-${arch}`);
  }
  await mkdir(dirname(resolve(output)), { recursive: true });
  const staging = await mkdtemp(join(dirname(resolve(output)), '.release-artifacts-'));
  try {
    for (const [name, source] of assets) await copyFile(source, join(staging, name));
    for (const [name, info] of merged)
      await writeFile(join(staging, name), yaml.dump(info, { lineWidth: -1 }));
    const manifest = await createRollbackManifest(staging, version);
    if (manifest.rollbackProtocol !== 1 || manifest.assets.length < REQUIRED.length)
      throw new Error('Incomplete rollback manifest');
    await writeFile(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(staging, output);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , input, output, version, channel] = process.argv;
  await mergeReleaseArtifacts(input, output, version, channel);
}
