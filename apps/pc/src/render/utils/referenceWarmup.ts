/**
 * 参考窗格的预解析：当前文档变化后（防抖 + 浏览器空闲时）把正文引用的媒体路径解析进共享缓存
 * （TextEditor/live-preview/media-resolve），点「参考」时窗格可以同一帧打开并直接显示本章第一张图。
 */
import {
  invalidateMediaResolveCache,
  resolveMediaRefs,
} from '../components/TextEditor/live-preview/media-resolve';
import type { ReferenceAutoSource } from './referencePane';
import { extractDocumentMediaRefs } from './referenceSources';

/** 文档变化后多久开始预解析 */
export const WARMUP_DEBOUNCE_MS = 300;
/** 空闲回调最长等待 */
const IDLE_TIMEOUT_MS = 1000;

let timer: ReturnType<typeof setTimeout> | null = null;
let idleHandle: number | null = null;

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function whenIdle(callback: () => void): void {
  const host = typeof window !== 'undefined' ? (window as IdleWindow) : undefined;
  if (host?.requestIdleCallback) {
    idleHandle = host.requestIdleCallback(
      () => {
        idleHandle = null;
        callback();
      },
      { timeout: IDLE_TIMEOUT_MS }
    );
    return;
  }
  callback();
}

/** 立即解析文档里的全部媒体引用（结果进缓存） */
export async function warmDocumentMedia(source: ReferenceAutoSource): Promise<void> {
  if (!source.documentPath) return;
  const refs = extractDocumentMediaRefs(source.text);
  if (refs.length === 0) return;
  await resolveMediaRefs(source.documentPath, refs);
}

export function cancelReferenceWarmup(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  const host = typeof window !== 'undefined' ? (window as IdleWindow) : undefined;
  if (idleHandle !== null) host?.cancelIdleCallback?.(idleHandle);
  idleHandle = null;
}

/** 防抖后在空闲时预解析（新的调用取代尚未开始的上一次） */
export function scheduleReferenceWarmup(
  source: ReferenceAutoSource | undefined,
  delay = WARMUP_DEBOUNCE_MS
): void {
  cancelReferenceWarmup();
  if (!source?.documentPath || !source.text) return;
  timer = setTimeout(() => {
    timer = null;
    whenIdle(() => void warmDocumentMedia(source).catch(() => undefined));
  }, delay);
}

/** 文件树换了（刷新、重命名、移动、删除之后）：缓存的路径可能已失效 */
export function invalidateReferencePaths(): void {
  invalidateMediaResolveCache();
}
