import type { RollbackTarget } from '../auto-updater-state';

export function assertRollbackVersion(version: string) {
  if (!/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(version)) {
    throw new Error('回退版本号无效');
  }
}

export function rollbackAssetNames(
  version: string,
  platform = process.platform,
  arch: string = process.arch
) {
  assertRollbackVersion(version);
  if (platform === 'darwin') return [`Novel-Editor-${version}-mac-${arch}.zip`];
  if (platform === 'win32') return [`Novel-Editor-${version}-win-${arch}.exe`];
  if (platform === 'linux' && !process.env.APPIMAGE)
    return [...new Set([arch, arch === 'x64' ? 'amd64' : arch])].map(
      (a) => `Novel-Editor-${version}-linux-${a}.deb`
    );
  if (platform === 'linux')
    return [...new Set([arch, arch === 'x64' ? 'x86_64' : arch])].map(
      (a) => `Novel-Editor-${version}-linux-${a}.AppImage`
    );
  throw new Error(`当前平台不支持自动回退: ${platform}`);
}

export function supportsNativeRollback() {
  return (
    process.platform === 'darwin' || process.platform === 'win32' || process.platform === 'linux'
  );
}

export function isBoundRollbackTarget(target: RollbackTarget): boolean {
  try {
    return (
      supportsNativeRollback() &&
      target.rollbackProtocol === 1 &&
      target.tag === `v${target.version}` &&
      target.platform === process.platform &&
      target.arch === process.arch &&
      /^[a-f0-9]{64}$/.test(target.sha256 ?? '') &&
      rollbackAssetNames(target.version).includes(target.assetName) &&
      new URL(target.assetUrl).protocol === 'https:'
    );
  } catch {
    return false;
  }
}

export function targetFromManifest(
  value: unknown,
  version: string,
  baseUrl: string
): RollbackTarget {
  const manifest = value as {
    rollbackProtocol?: unknown;
    recoveryProtocol?: unknown;
    version?: unknown;
    assets?: unknown[];
  } | null;
  if (manifest?.rollbackProtocol !== 1) throw new Error('旧版本不支持自动回退确认协议');
  if (!manifest || manifest.version !== version || !Array.isArray(manifest.assets))
    throw new Error('回退清单版本不匹配');
  const names = rollbackAssetNames(version);
  const asset = manifest.assets.find((entry) => {
    const a = entry as Record<string, unknown> | null;
    return (
      a &&
      names.includes(String(a.name)) &&
      a.platform === process.platform &&
      a.arch === process.arch &&
      /^[a-f0-9]{64}$/.test(String(a.sha256))
    );
  }) as { name: string; sha256: string } | undefined;
  if (!asset) throw new Error('回退清单缺少当前版本和架构的校验信息');
  return {
    rollbackProtocol: 1,
    ...(manifest.recoveryProtocol === 1 ? { recoveryProtocol: 1 } : {}),
    version,
    tag: `v${version}`,
    assetName: asset.name,
    assetUrl: `${baseUrl}/${encodeURIComponent(asset.name)}`,
    sha256: asset.sha256,
    platform: process.platform,
    arch: process.arch,
    cachedInstallerPath: null,
    cachedInstallerHash: null,
  };
}
