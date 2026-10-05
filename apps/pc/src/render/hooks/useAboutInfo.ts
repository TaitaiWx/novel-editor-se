import { useCallback, useEffect, useRef, useState } from 'react';
import {
  formatAboutDiagnostics,
  type AboutInfo,
  type AboutLinkKey,
  type AboutUpdateChannel,
} from '../../shared/about';

/** 「已复制」提示的显示时长 */
const COPIED_FEEDBACK_MS = 1600;

export type AboutCopyTarget = 'deviceId' | 'diagnostics';

export interface AboutInfoApi {
  info: AboutInfo | null;
  loading: boolean;
  error: string | null;
  /** 最近一次复制成功的目标（短暂显示「已复制」） */
  copied: AboutCopyTarget | null;
  /** 打开目录 / 链接 / 切换通道失败时的提示 */
  notice: string | null;
  channelSaving: boolean;
  reload: () => Promise<void>;
  copy: (target: AboutCopyTarget) => Promise<boolean>;
  openDirectory: (dirPath: string) => Promise<void>;
  openLink: (key: AboutLinkKey) => Promise<void>;
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
 * 「关于小说编辑器」数据与操作：读取 get-about-info，复制设备 ID / 诊断信息，
 * 打开数据目录与外部链接，切换更新通道（加入 / 退出金丝雀计划）
 */
export function useAboutInfo(active: boolean): AboutInfoApi {
  const [info, setInfo] = useState<AboutInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<AboutCopyTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [channelSaving, setChannelSaving] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
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

  const copy = useCallback(
    async (target: AboutCopyTarget) => {
      if (!info) return false;
      const text = target === 'deviceId' ? info.deviceId : formatAboutDiagnostics(info);
      const ok = await writeClipboard(text);
      if (!mountedRef.current) return ok;
      if (!ok) {
        setNotice('复制失败，请手动选择文本复制');
        return false;
      }
      setCopied(target);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(null), COPIED_FEEDBACK_MS);
      return true;
    },
    [info]
  );

  const openDirectory = useCallback(async (dirPath: string) => {
    try {
      const result = await window.electron.ipcRenderer.invoke('about-open-directory', dirPath);
      if (mountedRef.current) setNotice(result.success ? null : (result.error ?? '无法打开目录'));
    } catch {
      if (mountedRef.current) setNotice('无法打开目录');
    }
  }, []);

  const openLink = useCallback(async (key: AboutLinkKey) => {
    try {
      const result = await window.electron.ipcRenderer.invoke('about-open-link', key);
      if (mountedRef.current) setNotice(result.success ? null : (result.error ?? '无法打开链接'));
    } catch {
      if (mountedRef.current) setNotice('无法打开链接');
    }
  }, []);

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

  return {
    info,
    loading,
    error,
    copied,
    notice,
    channelSaving,
    reload,
    copy,
    openDirectory,
    openLink,
    setUpdateChannel,
  };
}
