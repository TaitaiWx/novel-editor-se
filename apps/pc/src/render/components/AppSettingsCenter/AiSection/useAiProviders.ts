/**
 * 设置中心「AI」：服务列表与操作（只读 configured 标记，Key 只写不读）
 *
 * 主进程在服务配置或设置变化后广播 settings-updated，这里防抖重新读取列表
 * （总开关、默认写作 AI 变化会影响各服务的启用状态与「默认」标记）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AICustomProviderInput,
  AIIpcResult,
  AIProviderInfo,
  AIProviderUpdate,
} from '../../../types/ai-api';
import { SETTINGS_STORAGE_KEY } from '../../../utils/appSettings';

const RELOAD_DEBOUNCE_MS = 200;

export interface AiProvidersApi {
  providers: AIProviderInfo[] | null;
  error: string;
  reload: () => Promise<void>;
  /** 用主进程返回的最新信息替换一行 */
  replace: (info: AIProviderInfo) => void;
  update: (id: string, update: AIProviderUpdate) => Promise<AIIpcResult<AIProviderInfo> | null>;
  addCustom: (input: AICustomProviderInput) => Promise<AIIpcResult<AIProviderInfo> | null>;
  removeCustom: (id: string) => Promise<AIIpcResult<{ removed: boolean }> | null>;
  setDefault: (id: string | null) => Promise<AIIpcResult<AIProviderInfo[]> | null>;
}

export function useAiProviders(): AiProvidersApi {
  const [providers, setProviders] = useState<AIProviderInfo[] | null>(null);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const result = (await ipc.invoke('ai-providers-list').catch(() => undefined)) as
      | AIIpcResult<AIProviderInfo[]>
      | undefined;
    if (!result) return;
    if (result.ok) {
      setProviders(result.data);
      setError('');
    } else {
      setError(result.error.message);
    }
  }, []);

  useEffect(() => {
    void reload();
    const ipc = window.electron?.ipcRenderer;
    let dispose: (() => void) | void;
    try {
      dispose = ipc?.on?.('settings-updated', (_event: unknown, key?: string) => {
        if (key && key !== SETTINGS_STORAGE_KEY) return;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void reload(), RELOAD_DEBOUNCE_MS);
      });
    } catch {
      dispose = undefined;
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (typeof dispose === 'function') dispose();
    };
  }, [reload]);

  const replace = useCallback((info: AIProviderInfo) => {
    setProviders((prev) => prev?.map((item) => (item.id === info.id ? info : item)) ?? prev);
  }, []);

  const update = useCallback(
    async (id: string, patch: AIProviderUpdate) => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return null;
      const result = (await ipc.invoke('ai-providers-set', id, patch)) as
        | AIIpcResult<AIProviderInfo>
        | undefined;
      if (result?.ok) replace(result.data);
      return result ?? null;
    },
    [replace]
  );

  const addCustom = useCallback(async (input: AICustomProviderInput) => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return null;
    const result = (await ipc.invoke('ai-providers-add-custom', input)) as
      | AIIpcResult<AIProviderInfo>
      | undefined;
    if (result?.ok) {
      const added = result.data;
      setProviders((prev) =>
        prev ? [...prev.filter((item) => item.id !== added.id), added] : prev
      );
    }
    return result ?? null;
  }, []);

  const removeCustom = useCallback(
    async (id: string) => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return null;
      const result = (await ipc.invoke('ai-providers-remove-custom', id)) as
        | AIIpcResult<{ removed: boolean }>
        | undefined;
      // 删除的可能是默认写作 AI：重新读取以刷新「默认」标记
      if (result?.ok) await reload();
      return result ?? null;
    },
    [reload]
  );

  const setDefault = useCallback(async (id: string | null) => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return null;
    const result = (await ipc.invoke('ai-providers-set-default', id)) as
      | AIIpcResult<AIProviderInfo[]>
      | undefined;
    if (result?.ok) setProviders(result.data);
    return result ?? null;
  }, []);

  return { providers, error, reload, replace, update, addCustom, removeCustom, setDefault };
}
