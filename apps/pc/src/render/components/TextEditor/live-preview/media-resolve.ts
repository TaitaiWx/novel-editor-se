/**
 * 正文媒体引用（`::image` / `::video` 指令、Markdown 图片）的路径解析缓存。
 *
 * - 按（文件路径, 语法, 地址）缓存「第一个存在的候选路径」或「找不到」（null）
 * - 实时渲染的 widget、参考窗格、ReferenceButton 的空闲预热共用同一份缓存：任何一方解析过，
 *   参考窗格打开时都能同步拿到结果（peekResolvedMedia），不必等 IPC
 * - 探测走一次 `get-files-exist` 批量 IPC（≤200 个/次）；主进程未检查的路径（工作区外）回退到 `get-file-info`
 * - 资料变化（WORKSPACE_FILES_CHANGED_EVENT）或文件树刷新（重命名 / 移动 / 删除，invalidateMediaResolveCache）时清空；
 *   条目超过 STALE_AFTER_MS 后仍可同步读取，但下一次异步解析会重新探测（先用旧值，后台校正）
 */
import { WORKSPACE_FILES_CHANGED_EVENT } from '../../../utils/workspaceFiles';
import { resolveImageSource } from './image-loader';

export type MediaRefSyntax = 'directive' | 'markdown';

export interface MediaRefLike {
  src: string;
  syntax: MediaRefSyntax;
}

/** 缓存条目过了这个时间，下一次异步解析时重新探测 */
export const STALE_AFTER_MS = 30_000;
/** 一次批量 IPC 最多的路径数（与主进程一致） */
export const PROBE_BATCH_MAX = 200;
const CACHE_LIMIT = 2000;

interface Entry {
  path: string | null;
  at: number;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<string | null>>();
let generation = 0;
let listening = false;

const DIRECT_URL_RE = /^(https?:|data:|blob:)/i;
const ABSOLUTE_RE = /^([a-zA-Z]:[\\/]|\/)/;

/** 地址候选：绝对路径原样；相对路径从文件所在目录开始逐级向上拼接（最多 5 级） */
export function mediaPathCandidates(filePath: string | null, src: string): string[] {
  const value = src.trim();
  if (!value) return [];
  if (ABSOLUTE_RE.test(value)) return [value];
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

/** 某个引用的全部候选路径（只保留本地绝对路径） */
export function candidatesForRef(filePath: string | null, ref: MediaRefLike): string[] {
  const raw =
    ref.syntax === 'directive'
      ? mediaPathCandidates(filePath, ref.src)
      : [resolveImageSource(ref.src, filePath)];
  return raw.filter((item) => item && !DIRECT_URL_RE.test(item) && ABSOLUTE_RE.test(item));
}

export function mediaResolveKey(filePath: string | null, ref: MediaRefLike): string {
  return `${filePath ?? ''}\n${ref.syntax}\n${ref.src}`;
}

function ensureListener(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener(WORKSPACE_FILES_CHANGED_EVENT, () => invalidateMediaResolveCache());
}

/** 清空缓存（资料变化、文件树刷新、测试） */
export function invalidateMediaResolveCache(): void {
  generation += 1;
  cache.clear();
  inflight.clear();
}

/**
 * 同步读取缓存：string = 已找到的路径；null = 确认找不到；undefined = 还没解析过。
 */
export function peekResolvedMedia(
  filePath: string | null,
  ref: MediaRefLike
): string | null | undefined {
  ensureListener();
  return cache.get(mediaResolveKey(filePath, ref))?.path;
}

function store(key: string, path: string | null): void {
  cache.delete(key);
  cache.set(key, { path, at: Date.now() });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value as string;
    cache.delete(oldest);
  }
}

function ipcRenderer() {
  return typeof window !== 'undefined' ? window.electron?.ipcRenderer : undefined;
}

async function existsSingle(path: string): Promise<boolean> {
  const ipc = ipcRenderer();
  if (!ipc) return false;
  try {
    const info = (await ipc.invoke('get-file-info', path)) as { isFile?: boolean } | null;
    return Boolean(info) && info?.isFile !== false;
  } catch {
    return false;
  }
}

/** 批量探测：返回存在的路径集合 */
export async function probeExistingPaths(paths: readonly string[]): Promise<Set<string>> {
  const ipc = ipcRenderer();
  const found = new Set<string>();
  if (!ipc || paths.length === 0) return found;
  const unique = [...new Set(paths)];
  const unchecked: string[] = [];
  for (let start = 0; start < unique.length; start += PROBE_BATCH_MAX) {
    const chunk = unique.slice(start, start + PROBE_BATCH_MAX);
    let answers: unknown = null;
    try {
      answers = await ipc.invoke('get-files-exist', chunk);
    } catch {
      answers = null;
    }
    chunk.forEach((path, index) => {
      const answer = Array.isArray(answers) ? (answers[index] as unknown) : null;
      if (answer === true) found.add(path);
      else if (answer !== false) unchecked.push(path);
    });
  }
  // 主进程没有回答的（工作区外 / 旧版主进程）：逐个查询
  const fallback = await Promise.all(unchecked.map((path) => existsSingle(path)));
  unchecked.forEach((path, index) => {
    if (fallback[index]) found.add(path);
  });
  return found;
}

/**
 * 解析一组引用（按顺序返回找到的路径或 null）。新鲜的缓存直接用，其余合并为一次批量探测；
 * 同一引用正在解析时复用同一个 Promise。
 */
export async function resolveMediaRefs(
  filePath: string | null,
  refs: readonly MediaRefLike[]
): Promise<Array<string | null>> {
  ensureListener();
  const now = Date.now();
  const results: Array<string | null | Promise<string | null>> = [];
  const pending: Array<{ index: number; key: string; candidates: string[] }> = [];
  refs.forEach((ref, index) => {
    const key = mediaResolveKey(filePath, ref);
    const entry = cache.get(key);
    if (entry && now - entry.at < STALE_AFTER_MS) {
      results[index] = entry.path;
      return;
    }
    const running = inflight.get(key);
    if (running) {
      results[index] = running;
      return;
    }
    results[index] = null;
    pending.push({ index, key, candidates: candidatesForRef(filePath, ref) });
  });
  if (pending.length > 0) {
    const startedAt = generation;
    const probe = probeExistingPaths(pending.flatMap((item) => item.candidates));
    for (const item of pending) {
      const promise = probe.then((found) => {
        const path = item.candidates.find((candidate) => found.has(candidate)) ?? null;
        if (startedAt === generation) {
          store(item.key, path);
          inflight.delete(item.key);
        }
        return path;
      });
      inflight.set(item.key, promise);
      results[item.index] = promise;
    }
  }
  return Promise.all(results);
}

/** 解析单个引用 */
export async function resolveMediaPath(
  filePath: string | null,
  ref: MediaRefLike
): Promise<string | null> {
  const [path] = await resolveMediaRefs(filePath, [ref]);
  return path;
}
