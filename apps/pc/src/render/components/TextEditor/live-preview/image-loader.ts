/**
 * 实时预览中的图片：解析相对 / 绝对路径，经已有的 `read-file-binary` IPC
 * 读取为 data URL（结果按路径缓存，同一图片只读一次）。
 * 网络图片与 data URL 直接使用，不经过主进程。
 */
import { LruCache } from './lru';

interface BinaryReadResult {
  base64Content: string;
  mimeType: string;
}

const IMAGE_CACHE_SIZE = 40;
const imageCache = new LruCache<string, Promise<string>>(IMAGE_CACHE_SIZE);

const isDirectUrl = (src: string) => /^(https?:|data:|blob:)/i.test(src);
const isWindowsAbsolute = (src: string) => /^[a-zA-Z]:[\\/]/.test(src);

/** 规范化路径中的 `.` / `..`，保留原有分隔符风格 */
function normalizePath(path: string): string {
  const sep = path.includes('\\') && !path.includes('/') ? '\\' : '/';
  const parts = path.split(/[\\/]/);
  const out: string[] = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      if (out.length > 1 || (out.length === 1 && out[0] !== '')) out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join(sep);
}

/** 文件所在目录 */
function dirnameOf(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return index >= 0 ? filePath.slice(0, index) : '';
}

/**
 * 解析 Markdown 图片地址：
 * - http(s) / data / blob → 原样返回
 * - file:// 与绝对路径 → 本地路径
 * - 其余视为相对当前文件所在目录
 */
export function resolveImageSource(src: string, filePath: string | null): string {
  const raw = src.trim().replace(/^<|>$/g, '');
  if (isDirectUrl(raw)) return raw;
  let decoded = raw;
  try {
    decoded = decodeURI(raw);
  } catch {
    // 非法转义保持原样
  }
  if (/^file:\/\//i.test(decoded)) {
    const local = decoded.replace(/^file:\/\//i, '');
    return /^\/[a-zA-Z]:[\\/]/.test(local) ? local.slice(1) : local;
  }
  if (decoded.startsWith('/') || isWindowsAbsolute(decoded)) return normalizePath(decoded);
  if (!filePath) return decoded;
  const base = dirnameOf(filePath);
  const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  return normalizePath(`${base}${sep}${decoded}`);
}

/** 读取图片为可直接放进 <img src> 的地址（带缓存；失败时 Promise 拒绝） */
export function loadImageUrl(resolved: string): Promise<string> {
  if (isDirectUrl(resolved)) return Promise.resolve(resolved);
  const cached = imageCache.get(resolved);
  if (cached) return cached;
  const ipc = typeof window !== 'undefined' ? window.electron?.ipcRenderer : undefined;
  const promise = ipc
    ? (ipc.invoke('read-file-binary', resolved) as Promise<BinaryReadResult>).then(
        (result) => `data:${result.mimeType || 'image/png'};base64,${result.base64Content}`
      )
    : Promise.reject(new Error('当前环境无法读取本地图片'));
  // 失败的结果不缓存，便于文件补上后重试
  promise.catch(() => imageCache.delete(resolved));
  imageCache.set(resolved, promise);
  return promise;
}

export function clearImageCache(): void {
  imageCache.clear();
}
