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

/** 读取参考窗格里的一张图 / 一段视频（经 read-file-binary），生成 blob 地址；切换或卸载时释放 */
export function useReferenceMedia(item: ReferenceItem | null): {
  url: string | null;
  error: string;
} {
  const [state, setState] = useState<{ path: string; url: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!item) {
      setState(null);
      return;
    }
    let cancelled = false;
    let created: string | null = null;
    setError('');
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) {
      setError('没有打开项目');
      return;
    }
    void ipc
      .invoke('read-file-binary', item.path)
      .then((result) => {
        if (cancelled) return;
        const data = result as BinaryResult | null;
        if (!data?.base64Content) throw new Error('文件为空');
        created = toBlobUrl(data);
        setState({ path: item.path, url: created });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setState(null);
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [item]);
  return { url: state && item && state.path === item.path ? state.url : null, error };
}
