import { globalShortcut } from 'electron';
import { shortcutConfigs } from './config';

/**
 * 注册所有快捷键
 */
export const registerAllShortcuts = () => {
  shortcutConfigs.forEach((config) => {
    const success = globalShortcut.register(config.accelerator, config.action);
    if (!success) {
      console.warn(`Failed to register shortcut: ${config.accelerator}`);
    } else {
      console.log(`Registered shortcut: ${config.accelerator} - ${config.description}`);
    }
  });
};
