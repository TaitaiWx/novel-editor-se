import { globalShortcut } from 'electron';

/**
 * 注销所有快捷键
 */
export const unregisterAllShortcuts = () => {
  globalShortcut.unregisterAll();
  console.log('All shortcuts unregistered');
};
