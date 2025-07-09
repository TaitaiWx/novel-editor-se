import { shortcutHandlerMapping } from './shortcutHandlerMapping';

/**
 * 清理快捷键监听
 */
export const cleanupKeyboardShortcuts = () => {
  if (window.electron?.ipcRenderer) {
    // 清理所有快捷键事件监听
    Object.keys(shortcutHandlerMapping).forEach((event) => {
      window.electron.ipcRenderer.removeAllListeners(event);
    });
  }
};
