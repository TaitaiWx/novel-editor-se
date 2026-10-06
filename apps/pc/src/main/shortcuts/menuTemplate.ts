import { app, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { basename } from 'path';

import { APP_DISPLAY_NAME } from '../../shared/about';
import {
  APP_MENU_EVENTS,
  FEEDBACK_URL,
  toMenuAccelerator,
  type MenuShortcutBindings,
} from '../../shared/app-menu';
import { getMenuAccelerator, getShortcutConfigs } from './config';
import { toggleDevTools } from './devtools';
import { newFile } from './newFile';
import { openFolder } from './openFolder';
import { reloadWindow } from './reloadWindow';
import { saveAsFile } from './saveAsFile';
import { saveFile } from './saveFile';
import { openAboutDialog, sendToRenderer } from './sendToRenderer';
import { toggleFullscreen } from './toggleFullscreen';

export interface MenuTemplateOptions {
  /** 最近打开的文件夹（已过滤不存在的目录） */
  recentFolders: string[];
  /** 设置中心可自定义的快捷键（渲染进程格式） */
  bindings: MenuShortcutBindings;
  /** 清除最近使用记录 */
  onClearRecent: () => void;
}

const separator: MenuItemConstructorOptions = { type: 'separator' };

/** 只把有值的 accelerator 写进菜单项，避免出现 accelerator: undefined 覆盖 role 默认值 */
const withAccelerator = (
  item: MenuItemConstructorOptions,
  accelerator: string | null | undefined
): MenuItemConstructorOptions => (accelerator ? { ...item, accelerator } : item);

/** 「打开最近使用」子菜单：点击后走与 `ne open` 相同的 open-folder-request 流程 */
function buildRecentSubmenu(options: MenuTemplateOptions): MenuItemConstructorOptions[] {
  if (options.recentFolders.length === 0) {
    return [{ label: '无最近使用的文件夹', enabled: false }];
  }
  return [
    ...options.recentFolders.map(
      (folder): MenuItemConstructorOptions => ({
        // 同名目录较常见，标签带上完整路径便于区分
        label: `${basename(folder) || folder}  —  ${folder}`,
        click: () => sendToRenderer('open-folder-request', folder),
      })
    ),
    separator,
    { label: '清除最近使用', click: options.onClearRecent },
  ];
}

/**
 * 生成应用菜单模板（纯函数，便于测试）。
 *
 * macOS:  小说编辑器 / 文件 / 编辑 / 视图 / 窗口 / 帮助
 * Win/Linux: 文件（含设置、退出）/ 编辑 / 视图 / 窗口 / 帮助（含关于）
 */
export function buildApplicationMenuTemplate(
  options: MenuTemplateOptions
): MenuItemConstructorOptions[] {
  const isMac = process.platform === 'darwin';
  const isDev = !app.isPackaged;
  const configs = getShortcutConfigs();
  const acc = (id: Parameters<typeof getMenuAccelerator>[1]) => getMenuAccelerator(configs, id);

  const aboutItem: MenuItemConstructorOptions = {
    // 不使用原生 role: 'about'，改为打开应用内的「关于」对话框
    label: `关于 ${APP_DISPLAY_NAME}`,
    click: openAboutDialog,
  };
  const checkUpdatesItem: MenuItemConstructorOptions = {
    label: '检查更新…',
    click: () => sendToRenderer(APP_MENU_EVENTS.checkUpdates),
  };
  const settingsItem = withAccelerator(
    { label: '设置…', click: () => sendToRenderer(APP_MENU_EVENTS.openSettings) },
    acc('settings')
  );
  const quitItem = withAccelerator(
    { role: 'quit', label: isMac ? `退出 ${APP_DISPLAY_NAME}` : '退出' },
    acc('quit')
  );
  const toggleDevToolsItem = withAccelerator(
    { label: '切换开发者工具', click: toggleDevTools },
    acc('toggleDevTools')
  );

  const template: MenuItemConstructorOptions[] = [];

  // macOS 第一项必须是应用菜单（菜单栏标题由 Info.plist 的 CFBundleName 决定，见 electron-builder.yml）
  if (isMac) {
    template.push({
      label: APP_DISPLAY_NAME,
      submenu: [
        aboutItem,
        checkUpdatesItem,
        separator,
        settingsItem,
        separator,
        { role: 'services', label: '服务' },
        separator,
        withAccelerator({ role: 'hide', label: `隐藏 ${APP_DISPLAY_NAME}` }, acc('hide')),
        withAccelerator({ role: 'hideOthers', label: '隐藏其他' }, acc('hideOthers')),
        { role: 'unhide', label: '全部显示' },
        separator,
        quitItem,
      ],
    });
  }

  template.push({
    label: '文件',
    submenu: [
      withAccelerator({ label: '新建文件', click: newFile }, acc('newFile')),
      withAccelerator({ label: '打开文件夹…', click: openFolder }, acc('openFolder')),
      { label: '打开最近使用', submenu: buildRecentSubmenu(options) },
      separator,
      withAccelerator({ label: '保存', click: saveFile }, acc('save')),
      withAccelerator({ label: '另存为…', click: saveAsFile }, acc('saveAs')),
      separator,
      withAccelerator(
        { label: '导出项目…', click: () => sendToRenderer('menu-export-project') },
        acc('exportProject')
      ),
      // Windows / Linux：设置与退出放在文件菜单（macOS 在应用菜单中）
      ...(isMac ? [] : [separator, settingsItem, separator, quitItem]),
    ],
  });

  template.push({
    label: '编辑',
    submenu: [
      withAccelerator({ role: 'undo', label: '撤销' }, acc('undo')),
      withAccelerator({ role: 'redo', label: '重做' }, acc('redo')),
      separator,
      { role: 'cut', label: '剪切' },
      { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' },
      { role: 'selectAll', label: '全选' },
      separator,
      withAccelerator(
        { label: '查找', click: () => sendToRenderer(APP_MENU_EVENTS.find) },
        acc('find')
      ),
    ],
  });

  template.push({
    label: '视图',
    submenu: [
      withAccelerator(
        { label: '切换侧边栏', click: () => sendToRenderer(APP_MENU_EVENTS.toggleSidebar) },
        toMenuAccelerator(options.bindings.toggleSidebar)
      ),
      { label: '切换右侧面板', click: () => sendToRenderer(APP_MENU_EVENTS.toggleRightPanel) },
      withAccelerator(
        { label: '专注写作', click: () => sendToRenderer(APP_MENU_EVENTS.toggleFocusMode) },
        toMenuAccelerator(options.bindings.toggleFocusMode)
      ),
      separator,
      withAccelerator({ role: 'zoomIn', label: '放大' }, acc('zoomIn')),
      withAccelerator({ role: 'zoomOut', label: '缩小' }, acc('zoomOut')),
      withAccelerator({ role: 'resetZoom', label: '实际大小' }, acc('resetZoom')),
      separator,
      withAccelerator({ label: '切换全屏', click: toggleFullscreen }, acc('toggleFullscreen')),
      ...(isDev
        ? [
            separator,
            withAccelerator({ label: '重新加载', click: reloadWindow }, acc('reload')),
            { ...toggleDevToolsItem, label: '开发者工具' },
          ]
        : []),
    ],
  });

  template.push({
    role: 'windowMenu',
    label: '窗口',
    submenu: isMac
      ? [
          withAccelerator({ role: 'minimize', label: '最小化' }, acc('minimize')),
          { role: 'zoom', label: '缩放' },
          separator,
          { role: 'front', label: '前置全部窗口' },
        ]
      : [withAccelerator({ role: 'minimize', label: '最小化' }, acc('minimize'))],
  });

  template.push({
    role: 'help',
    label: '帮助',
    submenu: [
      { label: '快捷键说明', click: () => sendToRenderer(APP_MENU_EVENTS.showShortcuts) },
      { label: '更新日志', click: () => sendToRenderer(APP_MENU_EVENTS.openChangelog) },
      separator,
      { label: '上传日志…', click: () => sendToRenderer(APP_MENU_EVENTS.uploadLogs) },
      { label: '问题反馈', click: () => void shell.openExternal(FEEDBACK_URL) },
      // 打包版本的开发者工具入口放在帮助菜单（VS Code 同款），开发模式在视图菜单
      ...(isDev ? [] : [separator, toggleDevToolsItem]),
      ...(isMac ? [] : [separator, checkUpdatesItem, aboutItem]),
    ],
  });

  return template;
}
