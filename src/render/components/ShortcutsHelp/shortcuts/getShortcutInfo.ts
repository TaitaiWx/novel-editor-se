/**
 * 获取快捷键信息
 */
import type { ShortcutInfo } from '../../../../types';

export const getShortcutInfo = async (): Promise<ShortcutInfo[]> => {
  try {
    if (window.electron?.ipcRenderer) {
      return await window.electron.ipcRenderer.invoke('get-shortcuts');
    }
    return [];
  } catch (error) {
    console.error('Failed to get shortcuts:', error);
    return [];
  }
};
