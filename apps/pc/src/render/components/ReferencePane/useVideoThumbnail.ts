import { useEffect, useState, type RefObject } from 'react';
import { captureVideoThumbnail } from '@novel-editor/media-player';
import { acquireReferenceMedia } from './useReferenceMedia';
import { fileSignature } from './useReferenceHotReload';

const covers = new Map<string, string>();
const queue: (() => Promise<void>)[] = [];
let active = 0;
function drain() {
  while (active < 2 && queue.length) {
    const job = queue.shift()!;
    active += 1;
    void job().finally(() => {
      active -= 1;
      drain();
    });
  }
}
function asDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function useVideoThumbnail(
  path: string | null,
  version: number,
  anchor: RefObject<HTMLElement>
): string | null {
  const [visiblePath, setVisiblePath] = useState<string | null>(null);
  const [poster, setPoster] = useState<{ key: string; url: string } | null>(null);
  const key = JSON.stringify([path, version]);
  useEffect(() => {
    const element = anchor.current;
    if (!path || !element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisiblePath(path);
        observer.disconnect();
      },
      { rootMargin: '160px' }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [path, anchor]);
  useEffect(() => {
    if (!path || visiblePath !== path) return;
    const controller = new AbortController();
    const { signal } = controller;
    const job = async () => {
      if (signal.aborted) return;
      try {
        const files = (await window.electron.ipcRenderer.invoke('get-file-info-batch', [path])) as {
          path: string;
          info: { size?: number; modified?: string | number | Date };
        }[];
        const signature = fileSignature(files.find((file) => file.path === path)?.info);
        if (signal.aborted || !signature) return;
        // 文件签名使关闭再打开窗格时也不会误用被覆盖文件的旧封面。
        const cacheKey = JSON.stringify([path, signature]);
        let url = covers.get(cacheKey);
        if (!url) {
          const media = acquireReferenceMedia(path, version);
          try {
            const source = await media.promise;
            if (signal.aborted) return;
            url = await asDataUrl(await captureVideoThumbnail(source, signal));
          } finally {
            media.release();
          }
        }
        if (signal.aborted) return;
        covers.delete(cacheKey);
        covers.set(cacheKey, url);
        while (covers.size > 64) covers.delete(covers.keys().next().value!);
        setPoster({ key, url });
      } catch {
        // 文件缺失或格式不支持时保留播放图标，不影响选择与播放。
      }
    };
    queue.push(job);
    drain();
    return () => {
      controller.abort();
      const queuedIndex = queue.indexOf(job);
      if (queuedIndex >= 0) queue.splice(queuedIndex, 1);
    };
  }, [key, path, version, visiblePath]);
  return poster?.key === key ? poster.url : null;
}
