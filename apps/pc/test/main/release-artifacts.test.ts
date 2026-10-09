import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mergeReleaseArtifacts } from '../../scripts/merge-release-artifacts.mjs';
const require = createRequire(import.meta.url);
const updaterRequire = createRequire(require.resolve('electron-updater/package.json'));
const yaml = updaterRequire('js-yaml') as {
  load: (value: string) => unknown;
  dump: (value: unknown) => string;
};
const provider = updaterRequire('./out/providers/Provider.js') as {
  findFile: (
    files: Array<{ url: URL; info: { url: string } }>,
    ext: string
  ) => { info: { url: string } };
};
let dir: string;
let input: string;
let output: string;
const version = '1.2.3-canary.1';
const targets = [
  ['mac', 'x64', 'zip'],
  ['mac', 'arm64', 'zip'],
  ['win', 'x64', 'exe'],
  ['win', 'ia32', 'exe'],
  ['win', 'arm64', 'exe'],
  ['linux', 'x86_64', 'AppImage'],
];
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ne-release-artifacts-'));
  input = path.join(dir, 'input');
  output = path.join(dir, 'output');
  for (const [os, arch, ext] of targets) {
    const folder = path.join(input, `${os}-${arch}`);
    await mkdir(folder, { recursive: true });
    const name = `Novel-Editor-${version}-${os}-${arch}.${ext}`;
    const content = `binary-${os}-${arch}`;
    await writeFile(path.join(folder, name), content);
    await writeFile(
      path.join(folder, 'rollback-protocol.json'),
      JSON.stringify({ version, rollbackProtocol: 1, recoveryProtocol: 1 })
    );
    const sha512 = createHash('sha512').update(content).digest('base64');
    const metadataName = `alpha${os === 'win' ? '' : `-${os}`}.yml`;
    await writeFile(
      path.join(folder, metadataName),
      yaml.dump({
        version,
        files: [{ url: name, sha512, size: Buffer.byteLength(content) }],
        path: name,
        sha512,
        stagingPercentage: 10,
      })
    );
  }
});
afterEach(async () => rm(dir, { recursive: true, force: true }));

it('retains all architectures and lets the installed updater select each native Windows/macOS asset', async () => {
  await mergeReleaseArtifacts(input, output, version, 'alpha');
  const windows = yaml.load(await readFile(path.join(output, 'alpha.yml'), 'utf8')) as {
    path: string;
    files: Array<{ url: string }>;
  };
  expect(windows.files).toHaveLength(3);
  expect(windows.path).toContain('-win-x64.exe');
  const originalArch = Object.getOwnPropertyDescriptor(process, 'arch')!;
  try {
    for (const arch of ['ia32', 'x64', 'arm64']) {
      Object.defineProperty(process, 'arch', { value: arch });
      const resolved = windows.files.map((info) => ({
        info,
        url: new URL(info.url, 'https://example.test/'),
      }));
      expect(provider.findFile(resolved, 'exe').info.url).toContain(`-win-${arch}.exe`);
    }
  } finally {
    Object.defineProperty(process, 'arch', originalArch);
  }
  const mac = yaml.load(await readFile(path.join(output, 'alpha-mac.yml'), 'utf8')) as {
    path: string;
    files: Array<{ url: string }>;
  };
  expect(mac.path).toContain('-mac-x64.zip');
  expect(mac.files.map((file) => file.url).sort()).toEqual(
    targets
      .filter(([os]) => os === 'mac')
      .map(([os, arch, ext]) => `Novel-Editor-${version}-${os}-${arch}.${ext}`)
      .sort()
  );
  // Exercise the installed MacUpdater selector, including an x64 process under Rosetta.
  const { MacUpdater } = updaterRequire('./out/MacUpdater.js') as {
    MacUpdater: {
      prototype: { doDownloadUpdate: (options: unknown) => Promise<{ info: { url: string } }> };
    };
  };
  const childProcess = require('node:child_process') as {
    execFileSync: (command: string) => string;
  };
  const originalExec = childProcess.execFileSync;
  try {
    for (const [arch, rosetta, expected] of [
      ['x64', false, 'x64'],
      ['arm64', false, 'arm64'],
      ['x64', true, 'arm64'],
    ] as const) {
      Object.defineProperty(process, 'arch', { value: arch });
      childProcess.execFileSync = (command) =>
        command === 'sysctl' ? `sysctl.proc_translated: ${rosetta ? 1 : 0}` : arch;
      const resolved = mac.files.map((info) => ({
        info,
        url: new URL(info.url, 'https://example.test/'),
      }));
      const selected = await MacUpdater.prototype.doDownloadUpdate.call(
        {
          _logger: { info: () => undefined, warn: () => undefined },
          debug: () => undefined,
          executeDownload: (options: { fileInfo: { info: { url: string } } }) => options.fileInfo,
        },
        { updateInfoAndProvider: { info: mac, provider: { resolveFiles: () => resolved } } }
      );
      expect(selected.info.url).toContain(`-mac-${expected}.zip`);
    }
  } finally {
    childProcess.execFileSync = originalExec;
    Object.defineProperty(process, 'arch', originalArch);
  }
  const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
  expect(manifest.assets).toHaveLength(6);
  expect(manifest.rollbackProtocol).toBe(1);
});

it('rejects missing architecture artifacts before exposing a publish directory', async () => {
  await rm(path.join(input, 'win-ia32'), { recursive: true });
  await expect(mergeReleaseArtifacts(input, output, version, 'alpha')).rejects.toThrow('win-ia32');
  await expect(readdir(output)).rejects.toThrow();
});

it('rejects a version/channel mismatch and corrupt binary hashes', async () => {
  const metaPath = path.join(input, 'mac-x64/alpha-mac.yml');
  const original = await readFile(metaPath, 'utf8');
  await writeFile(metaPath, original.replace(version, '2.0.0'));
  await expect(mergeReleaseArtifacts(input, output, version, 'alpha')).rejects.toThrow('version');
  await writeFile(metaPath, original);
  await expect(mergeReleaseArtifacts(input, output, version, 'beta')).rejects.toThrow('channel');
  await writeFile(path.join(input, `mac-x64/Novel-Editor-${version}-mac-x64.zip`), 'corrupted');
  await expect(mergeReleaseArtifacts(input, output, version, 'alpha')).rejects.toThrow('checksum');
});

it('classifies both canary spellings as alpha prereleases', () => {
  for (const tag of ['v1.2.3-canary.1', 'v1.2.3-alpha.1']) {
    const result = JSON.parse(
      execFileSync(process.execPath, [path.resolve('scripts/resolve-release-channel.mjs')], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: '', RELEASE_TAG: tag },
      })
    );
    expect(result).toEqual({ publishChannel: 'alpha', releaseType: 'prerelease' });
  }
});

it('requires startup recovery capability before publishing a new release', async () => {
  for (const [os, arch] of targets) {
    await writeFile(
      path.join(input, `${os}-${arch}`, 'rollback-protocol.json'),
      JSON.stringify({ version, rollbackProtocol: 1 })
    );
  }
  await expect(mergeReleaseArtifacts(input, output, version, 'alpha')).rejects.toThrow(
    'Recovery protocol'
  );
});
it('retains a Debian fallback in addition to the six required native updater targets', async () => {
  const name = `Novel-Editor-${version}-linux-amd64.deb`;
  await writeFile(path.join(input, 'linux-x86_64', name), 'debian-package');
  await mergeReleaseArtifacts(input, output, version, 'alpha');
  const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
  expect(manifest.assets).toHaveLength(7);
  expect(manifest.assets.find((asset: { name: string }) => asset.name === name)).toMatchObject({
    arch: 'x64',
    platform: 'linux',
    sha256: createHash('sha256').update('debian-package').digest('hex'),
  });
});
