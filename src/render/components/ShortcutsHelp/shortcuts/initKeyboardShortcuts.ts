import { shortcutHandlerMapping } from './shortcutHandlerMapping';

/**
 * 初始化快捷键监听
 */
export const initKeyboardShortcuts = () => {
  if (window.electron?.ipcRenderer) {
    // 注册所有快捷键事件监听
    Object.entries(shortcutHandlerMapping).forEach(([event, handler]) => {
      window.electron.ipcRenderer.on(event, handler);
    });
  }
};
