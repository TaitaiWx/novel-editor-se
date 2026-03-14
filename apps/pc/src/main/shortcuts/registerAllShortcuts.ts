import { Menu } from 'electron';
import { shortcutConfigs } from './config';

/**
 * 通过应用菜单注册快捷键（仅在应用聚焦时生效，不影响其他程序）
 */
export const registerAllShortcuts = () => {
  // 将 shortcutConfigs 中的快捷键转换为 Electron Menu accelerator 格式
  // accelerator 格式: Cmd+S → CommandOrControl+S
  const normalizeAccelerator = (acc: string): string => {
    return acc.replace(/Cmd\+/g, 'CommandOrControl+').replace(/Ctrl\+/g, 'CommandOrControl+');
  };

  const menuItems = shortcutConfigs.map((config) => ({
    label: config.description,
    accelerator: normalizeAccelerator(config.accelerator),
    click: config.action,
    visible: false, // 隐藏菜单项，只保留快捷键功能
  }));

  const menu = Menu.buildFromTemplate([
    {
      label: 'App',
      submenu: menuItems,
    },
    {
      role: 'editMenu',
    },
  ]);

  Menu.setApplicationMenu(menu);
};
