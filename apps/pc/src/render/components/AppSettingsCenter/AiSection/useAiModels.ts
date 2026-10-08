/**
 * 设置中心「AI」：模型列表与操作（只读 configured 标记，Key 只写不读）
 *
 * 主进程在模型或设置变化后广播 settings-updated，这里防抖重新读取列表
 * （默认模型、总开关变化会影响各行的「默认」标记与状态）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AICapability,
  AIIpcResult,
  AIModelInput,
  AIProviderInfo,
  AIProviderUpdate,
} from '../../../types/ai-api';
import { SETTINGS_STORAGE_KEY } from '../../../utils/appSettings';

const RELOAD_DEBOUNCE_MS = 200;

export interface AiModelsApi {
  models: AIProviderInfo[] | null;
  error: string;
  reload: () => Promise<void>;
  add: (input: AIModelInput) => Promise<AIIpcResult<AIProviderInfo> | null>;
  update: (id: string, update: AIProviderUpdate) => Promise<AIIpcResult<AIProviderInfo> | null>;
  remove: (id: string) => Promise<AIIpcResult<{ removed: boolean }> | null>;
  setDefault: (
    capability: AICapability,
    id: string | null
  ) => Promise<AIIpcResult<AIProviderInfo[]> | null>;
  test: (id: string) => Promise<AIIpcResult<{ latencyMs: number }> | null>;
}

export function useAiModels(): AiModelsApi {
  const [models, setModels] = useState<AIProviderInfo[] | null>(null);
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
      setModels(result.data);
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

  const add = useCallback(
    async (input: AIModelInput) => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return null;
      const result = (await ipc.invoke('ai-models-add', input)) as
        | AIIpcResult<AIProviderInfo>
        | undefined;
      // 新模型可能成为默认（这个能力原来没有可用的模型）：重新读取整张列表
      if (result?.ok) await reload();
      return result ?? null;
    },
    [reload]
  );

  const update = useCallback(
    async (id: string, patch: AIProviderUpdate) => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return null;
      const result = (await ipc.invoke('ai-models-update', id, patch)) as
        | AIIpcResult<AIProviderInfo>
        | undefined;
      if (result?.ok) await reload();
      return result ?? null;
    },
    [reload]
  );

  const remove = useCallback(
    async (id: string) => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return null;
      const result = (await ipc.invoke('ai-models-remove', id)) as
        | AIIpcResult<{ removed: boolean }>
        | undefined;
      if (result?.ok) await reload();
      return result ?? null;
    },
    [reload]
  );

  const setDefault = useCallback(async (capability: AICapability, id: string | null) => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return null;
    const result = (await ipc.invoke('ai-models-set-default', capability, id)) as
      | AIIpcResult<AIProviderInfo[]>
      | undefined;
    if (result?.ok) setModels(result.data);
    return result ?? null;
  }, []);

  const test = useCallback(async (id: string) => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return null;
    return ((await ipc.invoke('ai-models-test', id)) as AIIpcResult<{ latencyMs: number }>) ?? null;
  }, []);

  return { models, error, reload, add, update, remove, setDefault, test };
}
