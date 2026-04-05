import React, { useState, useEffect, useCallback, useContext, createContext } from 'react';
import type { ReactNode } from 'react';
import { SETTINGS_STORAGE_KEY } from './constants';
import {
  getAIConfigStatus,
  mergeSettingsDraft,
  type AIConfigStatus as PersistedAIConfigStatus,
} from '../../utils/appSettings';

export interface AiConfigStatus extends PersistedAIConfigStatus {
  /** 是否已从 DB 完成加载 */
  loaded: boolean;
}

const EMPTY_STATUS: AiConfigStatus = {
  loaded: false,
  enabled: false,
  hasApiKey: false,
  hasBaseUrl: false,
  hasModel: false,
  ready: false,
};

const AiConfigContext = createContext<AiConfigStatus>(EMPTY_STATUS);

/**
 * 全局 AI 配置 Provider。
 * 在应用根节点挂载，所有子组件通过 useAiConfig() 获取同一份状态，
 * 避免多处重复查询 DB 和状态不同步。
 */
export function AiConfigProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AiConfigStatus>(EMPTY_STATUS);

  const loadConfig = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) {
      setStatus({ ...EMPTY_STATUS, loaded: true });
      return;
    }
    try {
      const raw = (await ipc.invoke('db-settings-get', SETTINGS_STORAGE_KEY)) as string | null;
      const nextStatus = getAIConfigStatus(mergeSettingsDraft(raw));
      setStatus({
        loaded: true,
        ...nextStatus,
      });
    } catch {
      setStatus({ ...EMPTY_STATUS, loaded: true });
    }
  }, []);

  useEffect(() => {
    void loadConfig();

    // 每次窗口获得焦点时重新读取配置（覆盖用户在设置中心修改后返回的场景）
    const handleFocus = () => void loadConfig();
    window.addEventListener('focus', handleFocus);

    // 主进程设置写入后主动推送，实时同步 AI 状态
    const ipc = window.electron?.ipcRenderer;
    let disposeSettingsUpdated: (() => void) | void;
    try {
      disposeSettingsUpdated = ipc?.on?.('settings-updated', (_event, key?: string) => {
        if (!key || key === SETTINGS_STORAGE_KEY) {
          void loadConfig();
        }
      });
    } catch {
      // preload 尚未更新时退回到 focus 刷新，避免渲染层直接崩溃
      disposeSettingsUpdated = undefined;
    }

    return () => {
      window.removeEventListener('focus', handleFocus);
      if (typeof disposeSettingsUpdated === 'function') disposeSettingsUpdated();
    };
  }, [loadConfig]);

  return <AiConfigContext.Provider value={status}>{children}</AiConfigContext.Provider>;
}

/**
 * 从全局 AiConfigContext 读取 AI 配置状态。
 * 必须在 <AiConfigProvider> 内使用。
 */
export function useAiConfig(): AiConfigStatus {
  return useContext(AiConfigContext);
}
