import { Menu, app, BrowserWindow } from 'electron';
import { shortcutConfigs } from './config';
import { APP_DISPLAY_NAME } from '../../shared/about';

/** 通知渲染进程打开应用内「关于」对话框（无聚焦窗口时发给第一个窗口） */
export const openAboutDialog = () => {
  const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  target?.webContents.send('menu-open-about');
};

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
        // 不使用原生 role: 'about'，改为打开应用内的「关于」对话框
        { label: `关于 ${APP_DISPLAY_NAME}`, click: openAboutDialog },
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

  // 文件菜单（导出）
  template.push({
    label: '文件',
    submenu: [
      {
        label: '导出项目',
        accelerator: 'CommandOrControl+Shift+E',
        click: () => {
          BrowserWindow.getFocusedWindow()?.webContents.send('menu-export-project');
        },
      },
    ],
  });

  // 编辑菜单（Cmd+C / V / X / A 等）
  template.push({ role: 'editMenu' });

  // Windows / Linux：「关于」放在帮助菜单（macOS 已在应用菜单中）
  if (process.platform !== 'darwin') {
    template.push({
      label: '帮助',
      submenu: [{ label: `关于 ${APP_DISPLAY_NAME}`, click: openAboutDialog }],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};
