import { useRef, useState } from 'react';
import { DEFAULT_SETTINGS_DRAFT, type SettingsDraft } from '@/render/utils/appSettings';

/**
 * 应用设置领域状态：当前生效的设置草稿及其最新值 ref（只声明，不含副作用）
 */
export function useSettingsState() {
  const [appSettings, setAppSettings] = useState<SettingsDraft>(DEFAULT_SETTINGS_DRAFT);
  const appSettingsRef = useRef(appSettings);
  appSettingsRef.current = appSettings;

  return { appSettings, setAppSettings, appSettingsRef };
}

export type SettingsState = ReturnType<typeof useSettingsState>;
