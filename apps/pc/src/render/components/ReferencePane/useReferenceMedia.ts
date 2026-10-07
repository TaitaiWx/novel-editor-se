import { useEffect, useState } from 'react';
import type { ReferenceItem } from '../../utils/referencePane';

interface BinaryResult {
  base64Content: string;
  mimeType: string;
}

function toBlobUrl(data: BinaryResult): string {
  const binary = atob(data.base64Content);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type: data.mimeType }));
}

interface MediaEntry {
  count: number;
  promise: Promise<string>;
}

/**
 * 按路径共享 blob 地址（主画面与缩略图读同一个文件只读一次）：引用计数归零时释放。
 * 读取失败的条目立即移除，下次重新读取。
 */
const entries = new Map<string, MediaEntry>();

async function readAsBlobUrl(path: string): Promise<string> {
  const ipc = window.electron?.ipcRenderer;
  if (!ipc) throw new Error('没有打开项目');
  const data = (await ipc.invoke('read-file-binary', path)) as BinaryResult | null;
  if (!data?.base64Content) throw new Error('文件为空');
  return toBlobUrl(data);
}

function acquire(path: string): { entry: MediaEntry; promise: Promise<string> } {
  let entry = entries.get(path);
  if (!entry) {
    const created: MediaEntry = { count: 0, promise: readAsBlobUrl(path) };
    created.promise.catch(() => {
      if (entries.get(path) === created) entries.delete(path);
    });
    entries.set(path, created);
    entry = created;
  }
  entry.count += 1;
  return { entry, promise: entry.promise };
}

function release(path: string, entry: MediaEntry): void {
  entry.count -= 1;
  if (entry.count > 0) return;
  if (entries.get(path) === entry) entries.delete(path);
  entry.promise.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
}

/** 读取参考窗格里的一张图 / 一段视频（经 read-file-binary），生成 blob 地址；切换或卸载时释放 */
export function useReferenceMedia(item: Pick<ReferenceItem, 'path'> | null): {
  url: string | null;
  error: string;
} {
  const path = item?.path ?? null;
  const [state, setState] = useState<{ path: string; url: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!path) {
      setState(null);
      return;
    }
    let cancelled = false;
    setError('');
    const { entry, promise } = acquire(path);
    promise
      .then((url) => {
        if (!cancelled) setState({ path, url });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setState(null);
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
      release(path, entry);
    };
  }, [path]);
  return { url: state && path && state.path === path ? state.url : null, error };
}
