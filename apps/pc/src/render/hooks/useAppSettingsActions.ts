import { useCallback } from 'react';
import {
  DEFAULT_SETTINGS_DRAFT,
  SETTINGS_STORAGE_KEY,
  type SettingsDraft,
  getAIConfigMissingMessage,
  getAIConfigStatus,
  mergeSettingsDraft,
} from '@/render/utils/appSettings';
import type { SettingsState } from './state/useSettingsState';
import type { UiState } from './state/useUiState';

export type UseAppSettingsActionsContext = Pick<
  SettingsState,
  'appSettingsRef' | 'setAppSettings'
> &
  Pick<UiState, 'toast'>;

/**
 * 应用设置的读取、更新与持久化
 */
export function useAppSettingsActions(ctx: UseAppSettingsActionsContext) {
  const { appSettingsRef, setAppSettings, toast } = ctx;

  const loadPersistedSettingsDraft = useCallback(async (): Promise<SettingsDraft> => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return DEFAULT_SETTINGS_DRAFT;
    const rawSettings = (await ipc.invoke('db-settings-get', SETTINGS_STORAGE_KEY)) as
      | string
      | null;
    return mergeSettingsDraft(rawSettings);
  }, []);

  const persistSettingsDraft = useCallback(async (settings: SettingsDraft) => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    await ipc.invoke('db-settings-set', SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, []);

  const handleAppSettingsChange = useCallback((settings: SettingsDraft) => {
    appSettingsRef.current = settings;
    setAppSettings(settings);
  }, []);

  const updateAppSettings = useCallback(
    (updater: (current: SettingsDraft) => SettingsDraft) => {
      const nextSettings = updater(appSettingsRef.current);
      appSettingsRef.current = nextSettings;
      setAppSettings(nextSettings);
      void persistSettingsDraft(nextSettings);
    },
    [persistSettingsDraft]
  );

  const ensurePersistedAiReady = useCallback(async (): Promise<SettingsDraft | null> => {
    const persistedSettings = await loadPersistedSettingsDraft();
    const aiStatus = getAIConfigStatus(persistedSettings);
    if (aiStatus.ready) return persistedSettings;
    toast.warning(getAIConfigMissingMessage(aiStatus) || '请先在设置中心启用并配置 AI');
    return null;
  }, [loadPersistedSettingsDraft, toast]);

  const handleToggleThousandCharMarkers = useCallback(() => {
    updateAppSettings((current) => ({
      ...current,
      general: {
        ...current.general,
        showThousandCharMarkers: !current.general.showThousandCharMarkers,
      },
    }));
  }, [updateAppSettings]);

  return {
    loadPersistedSettingsDraft,
    persistSettingsDraft,
    handleAppSettingsChange,
    updateAppSettings,
    ensurePersistedAiReady,
    handleToggleThousandCharMarkers,
  };
}

export type AppSettingsActions = ReturnType<typeof useAppSettingsActions>;
