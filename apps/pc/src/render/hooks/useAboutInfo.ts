import { useCallback, useEffect, useRef, useState } from 'react';
import type { AboutInfo, AboutUpdateChannel } from '../../shared/about';

export interface AboutInfoApi {
  info: AboutInfo | null;
  loading: boolean;
  error: string | null;
  /** 切换通道失败等操作提示 */
  notice: string | null;
  channelSaving: boolean;
  reload: () => Promise<void>;
  setUpdateChannel: (channel: AboutUpdateChannel) => Promise<void>;
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

/**
 * 「关于小说编辑器」数据：读取 get-about-info；
 * 同时提供切换更新通道（设置中心「更新」分组：加入 / 退出金丝雀计划）
 */
export function useAboutInfo(active: boolean): AboutInfoApi {
  const [info, setInfo] = useState<AboutInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [channelSaving, setChannelSaving] = useState(false);
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
    setNotice(null);
    void reload();
  }, [active, reload]);

  const setUpdateChannel = useCallback(
    async (channel: AboutUpdateChannel) => {
      setChannelSaving(true);
      try {
        await window.electron.ipcRenderer.invoke('update-set-channel', channel);
        if (mountedRef.current) setNotice(null);
        await reload();
      } catch {
        if (mountedRef.current) setNotice('切换更新通道失败');
      } finally {
        if (mountedRef.current) setChannelSaving(false);
      }
    },
    [reload]
  );

  return { info, loading, error, notice, channelSaving, reload, setUpdateChannel };
}
