import React from 'react';
import type { SettingsTab } from '@/render/components/AppSettingsCenter';
import type { UiState } from './state/useUiState';

export type UseOpenSettingsTabListenerContext = Pick<
  UiState,
  'setSettingsCenterTab' | 'setShowSettingsCenter'
>;

/**
 * 监听子组件通过自定义事件打开设置中心指定标签页
 */
export function useOpenSettingsTabListener(ctx: UseOpenSettingsTabListenerContext) {
  const { setSettingsCenterTab, setShowSettingsCenter } = ctx;

  // 监听子组件通过自定义事件打开设置中心指定标签页
  React.useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail as SettingsTab;
      setSettingsCenterTab(tab);
      setShowSettingsCenter(true);
    };
    window.addEventListener('open-settings-tab', handler);
    return () => window.removeEventListener('open-settings-tab', handler);
  }, []);
}
