/** 回滚安装包的选择与缓存清理策略（纯函数） */

export interface ReleaseAssetLike {
  name: string;
  browser_download_url: string;
}

/** 判断 release 资源是否为当前平台可用的安装包 */
export function isPreferredAssetName(name: string, platform: NodeJS.Platform = process.platform) {
  const lowerName = name.toLowerCase();
  if (
    lowerName.endsWith('.blockmap') ||
    lowerName.endsWith('.yml') ||
    lowerName.endsWith('.yaml')
  ) {
    return false;
  }

  if (platform === 'darwin') {
    return lowerName.endsWith('.dmg') || lowerName.endsWith('.zip');
  }

  if (platform === 'win32') {
    return lowerName.endsWith('.exe') || lowerName.endsWith('.msi');
  }

  return (
    lowerName.endsWith('.appimage') || lowerName.endsWith('.deb') || lowerName.endsWith('.rpm')
  );
}

/** 为安装包打分：架构匹配 +100，平台首选格式 +20 */
export function scoreReleaseAsset(
  name: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
) {
  const lowerName = name.toLowerCase();
  const matchesArch = lowerName.includes(arch);
  let score = matchesArch ? 100 : 0;

  if (platform === 'darwin' && lowerName.endsWith('.dmg')) score += 20;
  if (platform === 'win32' && lowerName.endsWith('.exe')) score += 20;
  if (platform === 'linux' && lowerName.endsWith('.appimage')) score += 20;

  return score;
}

/** 从 release 资源列表中挑选最合适的安装包 */
export function selectReleaseAsset<T extends ReleaseAssetLike>(
  assets: T[],
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): T | undefined {
  return assets
    .filter((asset) => isPreferredAssetName(asset.name, platform))
    .sort(
      (left, right) =>
        scoreReleaseAsset(right.name, platform, arch) - scoreReleaseAsset(left.name, platform, arch)
    )[0];
}

/** 根据当前平台和架构返回镜像的快捷文件名 */
export function getMirrorShortcutName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): string | null {
  if (platform === 'darwin') return `mac-${arch}.dmg`;
  if (platform === 'win32') return `win-${arch}.exe`;
  if (platform === 'linux') return `linux-${arch}.AppImage`;
  return null;
}

/** 回滚缓存目录中的文件是否为完整安装包（排除下载中间产物） */
export function isRollbackCacheCandidate(name: string): boolean {
  return (
    !name.endsWith('.download') &&
    !name.endsWith('.tmp') &&
    !name.endsWith('.part') &&
    !name.endsWith('.dl-meta')
  );
}

export interface CacheFileStat {
  name: string;
  path: string;
  mtimeMs: number;
}

/** 选出需要清理的旧缓存：按修改时间保留最新的 maxEntries 个，且永不删除 keepName */
export function selectCacheFilesToPrune(
  files: CacheFileStat[],
  maxEntries: number,
  keepName?: string
): CacheFileStat[] {
  if (files.length <= maxEntries) return [];
  const sorted = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs);
  return sorted.slice(maxEntries).filter((file) => file.name !== keepName);
}
