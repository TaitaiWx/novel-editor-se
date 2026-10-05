/** Windows / macOS 默认文件系统大小写不敏感，Linux 大小写敏感 */
function isCaseInsensitivePlatform(platform: NodeJS.Platform): boolean {
  return platform === 'win32' || platform === 'darwin';
}

function normalizeWorkspacePath(pathValue: string, platform: NodeJS.Platform): string {
  const slashed = pathValue.replace(/\\/g, '/');
  return isCaseInsensitivePlatform(platform) ? slashed.toLowerCase() : slashed;
}

/** 判断路径是否位于工作区内；仅在大小写不敏感的平台上忽略大小写 */
export function isPathInWorkspace(
  pathValue: string,
  folderPath: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  const normalizedFolder = normalizeWorkspacePath(folderPath, platform).replace(/\/+$/, '');
  const normalizedPath = normalizeWorkspacePath(pathValue, platform);
  return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
}
