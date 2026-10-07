/**
 * 小说格式指令（`::video` / `::image`）引用的本地媒体：
 * - 地址相对作品目录（推荐写法），先试文件所在目录，再逐级向上（最多 4 级）
 * - 找到后经 `read-file-binary` 读取为 blob 地址（按路径缓存，淘汰时释放）
 */
import { LruCache } from './lru';

interface BinaryReadResult {
  base64Content: string;
  mimeType: string;
}

export interface LoadedMedia {
  /** 实际找到的本地路径 */
  path: string;
  url: string;
}

const MEDIA_CACHE_SIZE = 16;
const mediaCache = new LruCache<string, Promise<LoadedMedia>>(MEDIA_CACHE_SIZE);
const blobUrls = new Map<string, string>();

/** 地址候选：绝对路径原样；相对路径从文件所在目录开始逐级向上拼接 */
export function mediaPathCandidates(filePath: string | null, src: string): string[] {
  const value = src.trim();
  if (!value) return [];
  if (/^([a-zA-Z]:[\\/]|\/)/.test(value)) return [value];
  if (!filePath) return [];
  const separator = filePath.includes('\\') && !filePath.includes('/') ? '\\' : '/';
  const parts = filePath.split(/[\\/]/);
  parts.pop();
  const candidates: string[] = [];
  for (let depth = 0; depth < 5 && parts.length > 0; depth += 1) {
    candidates.push([...parts, ...value.split(/[\\/]+/).filter(Boolean)].join(separator));
    parts.pop();
  }
  return candidates;
}

function ipcRenderer() {
  return typeof window !== 'undefined' ? window.electron?.ipcRenderer : undefined;
}

/** 第一个存在的候选路径；都不存在时为 null */
export async function findExistingMedia(
  filePath: string | null,
  src: string
): Promise<string | null> {
  const ipc = ipcRenderer();
  if (!ipc) return null;
  for (const candidate of mediaPathCandidates(filePath, src)) {
    const exists = await ipc
      .invoke('get-file-info', candidate)
      .then(() => true)
      .catch(() => false);
    if (exists) return candidate;
  }
  return null;
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

/** 找到并读取媒体为 blob 地址（带缓存；找不到或读取失败时拒绝，且不缓存失败结果） */
export function loadDirectiveMedia(filePath: string | null, src: string): Promise<LoadedMedia> {
  const key = `${filePath ?? ''}\n${src}`;
  const cached = mediaCache.get(key);
  if (cached) return cached;
  const promise = (async () => {
    const ipc = ipcRenderer();
    if (!ipc) throw new Error('当前环境无法读取本地文件');
    const path = await findExistingMedia(filePath, src);
    if (!path) throw new Error(`找不到文件：${src}`);
    const result = (await ipc.invoke('read-file-binary', path)) as BinaryReadResult;
    const previous = blobUrls.get(key);
    if (previous) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(base64ToBlob(result.base64Content, result.mimeType));
    blobUrls.set(key, url);
    // 缓存淘汰后 blob 仍可能被页面上的旧 widget 使用，这里只限制总数
    while (blobUrls.size > MEDIA_CACHE_SIZE * 2) {
      const [oldestKey, oldestUrl] = blobUrls.entries().next().value as [string, string];
      URL.revokeObjectURL(oldestUrl);
      blobUrls.delete(oldestKey);
    }
    return { path, url };
  })();
  promise.catch(() => mediaCache.delete(key));
  mediaCache.set(key, promise);
  return promise;
}

/** 测试用：清空缓存 */
export function clearDirectiveMediaCache(): void {
  for (const url of blobUrls.values()) URL.revokeObjectURL(url);
  blobUrls.clear();
  mediaCache.clear();
}
