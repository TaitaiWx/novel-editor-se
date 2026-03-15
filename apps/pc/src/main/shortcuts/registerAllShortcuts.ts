import { Menu, app } from 'electron';
import { shortcutConfigs } from './config';

/**
 * 通过应用菜单注册快捷键（仅在应用聚焦时生效，不影响其他程序）
 *
 * macOS 必须包含 appMenu 角色的子菜单，否则 Cmd+Q / Cmd+H 等系统快捷键无法生效。
 */
export const registerAllShortcuts = () => {
  const normalizeAccelerator = (acc: string): string => {
    return acc.replace(/Cmd\+/g, 'CommandOrControl+').replace(/Ctrl\+/g, 'CommandOrControl+');
  };

  // 将配置中的快捷键转为隐藏菜单项（仅保留 accelerator）
  const menuItems = shortcutConfigs
    .filter((c) => {
      // macOS 下 Cmd+Q 由 appMenu role 处理，不重复注册
      if (process.platform === 'darwin' && c.accelerator === 'Cmd+Q') return false;
      return true;
    })
    .map((config) => ({
      label: config.description,
      accelerator: normalizeAccelerator(config.accelerator),
      click: config.action,
      visible: false,
    }));

  const template: Electron.MenuItemConstructorOptions[] = [];

  // macOS: 第一项必须是 appMenu，提供 Cmd+Q / Cmd+H 等系统快捷键
  if (process.platform === 'darwin') {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about', label: `关于 ${app.name}` },
        { type: 'separator' },
        { role: 'hide', label: `隐藏 ${app.name}` },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: `退出 ${app.name}` },
      ],
    });
  }

  // 自定义快捷键菜单
  template.push({
    label: '快捷键',
    submenu: menuItems,
  });

  // 编辑菜单（Cmd+C / V / X / A 等）
  template.push({ role: 'editMenu' });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};
