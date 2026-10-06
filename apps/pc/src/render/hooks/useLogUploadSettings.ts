import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogUploadSettingsState } from '../../shared/log-upload';

export interface LogUploadSettingsApi {
  settings: LogUploadSettingsState | null;
  saving: boolean;
  error: string | null;
  setAutoUploadOnCrash: (enabled: boolean) => Promise<void>;
}

/** 「崩溃时自动上传日志」开关（主进程持久化，崩溃时由主进程直接读取） */
export function useLogUploadSettings(): LogUploadSettingsApi {
  const [settings, setSettings] = useState<LogUploadSettingsState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const ipc = window.electron?.ipcRenderer;
    if (ipc) {
      ipc
        .invoke('log-upload-get-settings')
        .then((next) => {
          if (mountedRef.current) setSettings(next);
        })
        .catch(() => {
          if (mountedRef.current) setError('读取日志上传设置失败');
        });
    }
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setAutoUploadOnCrash = useCallback(async (enabled: boolean) => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    setSaving(true);
    // 乐观更新，失败时回滚
    setSettings((prev) => (prev ? { ...prev, autoUploadOnCrash: enabled } : prev));
    try {
      const next = await ipc.invoke('log-upload-set-settings', { autoUploadOnCrash: enabled });
      if (mountedRef.current) {
        setSettings(next);
        setError(null);
      }
    } catch {
      if (mountedRef.current) {
        setSettings((prev) => (prev ? { ...prev, autoUploadOnCrash: !enabled } : prev));
        setError('保存失败，请重试');
      }
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, []);

  return { settings, saving, error, setAutoUploadOnCrash };
}
