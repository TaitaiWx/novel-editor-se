import { useCallback, useEffect, useRef, useState } from 'react';
import type { AboutInfo } from '../../shared/about';

export interface AboutInfoApi {
  info: AboutInfo | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/** 写入剪贴板：优先走主进程（不依赖窗口焦点），失败时退回 navigator.clipboard */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    const result = await window.electron?.ipcRenderer.invoke('about-copy-text', text);
    if (result?.success) return true;
  } catch {
    // 主进程不可用时退回浏览器剪贴板
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 「关于小说编辑器」数据：读取 get-about-info（更新通道由我们决定，界面不提供切换） */
export function useAboutInfo(active: boolean): AboutInfoApi {
  const [info, setInfo] = useState<AboutInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    setLoading(true);
    try {
      const next = await ipc.invoke('get-about-info');
      if (!mountedRef.current) return;
      setInfo(next);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : '读取应用信息失败');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void reload();
  }, [active, reload]);

  return { info, loading, error, reload };
}
