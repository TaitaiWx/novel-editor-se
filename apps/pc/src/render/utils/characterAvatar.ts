/**
 * 人物头像：attributes.avatar 可以是 data URL / 网络地址（旧数据），
 * 也可以是相对作品目录的路径（资料/人物头像/xxx.png，由 character-avatar-save 保存）。
 * 本地文件经 read-file-binary 读成 data URL，按绝对路径缓存。
 */

interface BinaryReadResult {
  base64Content: string;
  mimeType: string;
}

const MAX_CACHE = 64;
const cache = new Map<string, Promise<string | null>>();

export function isDirectAvatarSource(avatar: string): boolean {
  return /^(data:image\/|https?:|blob:)/i.test(avatar.trim());
}

/** 相对路径 → 作品目录下的绝对路径；拒绝 `..` 越界 */
export function resolveAvatarPath(avatar: string, workPath: string | null): string | null {
  const value = avatar.trim();
  if (!value || isDirectAvatarSource(value)) return null;
  if (value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value)) return value;
  if (!workPath) return null;
  const parts = value.split(/[\\/]+/).filter(Boolean);
  if (parts.some((part) => part === '..')) return null;
  const separator = workPath.includes('\\') && !workPath.includes('/') ? '\\' : '/';
  return [workPath.replace(/[\\/]+$/, ''), ...parts].join(separator);
}

type ReadBinary = (filePath: string) => Promise<unknown>;

const defaultReader: ReadBinary = (filePath) =>
  window.electron.ipcRenderer.invoke('read-file-binary', filePath);

/** 头像的可显示地址；没有头像或读取失败时为 null */
export function loadAvatarSource(
  avatar: string | undefined,
  workPath: string | null,
  readBinary: ReadBinary = defaultReader
): Promise<string | null> {
  if (!avatar?.trim()) return Promise.resolve(null);
  if (isDirectAvatarSource(avatar)) return Promise.resolve(avatar.trim());
  const absolute = resolveAvatarPath(avatar, workPath);
  if (!absolute) return Promise.resolve(null);
  const cached = cache.get(absolute);
  if (cached) return cached;
  const promise = readBinary(absolute)
    .then((result) => {
      const data = result as BinaryReadResult | null;
      if (!data?.base64Content || !/^image\//.test(data.mimeType)) return null;
      return `data:${data.mimeType};base64,${data.base64Content}`;
    })
    .catch(() => {
      cache.delete(absolute);
      return null;
    });
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(absolute, promise);
  return promise;
}

export function clearAvatarCache(): void {
  cache.clear();
}
