import { existsSync } from 'fs';
import { Menu } from 'electron';

import {
  DEFAULT_MENU_SHORTCUT_BINDINGS,
  normalizeMenuShortcutBindings,
  type MenuShortcutBindings,
} from '../../shared/app-menu';
import { clearRecentFolders, getRecentFolders, onRecentFoldersChanged } from '../recent-folders';
import { buildApplicationMenuTemplate } from './menuTemplate';

export { openAboutDialog } from './sendToRenderer';

let bindings: MenuShortcutBindings = { ...DEFAULT_MENU_SHORTCUT_BINDINGS };
let unsubscribeRecent: (() => void) | null = null;

/** 最近使用列表只展示仍然存在的目录；读取失败时降级为空列表，不影响菜单构建 */
function readRecentFolders(): string[] {
  try {
    return getRecentFolders().filter((folder) => existsSync(folder));
  } catch {
    return [];
  }
}

/**
 * 构建并设置应用菜单（快捷键通过可见菜单项的 accelerator 生效，仅在应用聚焦时响应，不影响其他程序）。
 *
 * macOS 必须包含应用菜单，否则 Cmd+Q / Cmd+H 等系统快捷键无法生效。
 * 最近使用列表变化、渲染进程同步自定义快捷键时会重新调用本函数重建菜单。
 */
export const registerAllShortcuts = () => {
  if (!unsubscribeRecent) {
    unsubscribeRecent = onRecentFoldersChanged(() => registerAllShortcuts());
  }
  const template = buildApplicationMenuTemplate({
    recentFolders: readRecentFolders(),
    bindings,
    onClearRecent: () => clearRecentFolders(),
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

/**
 * 渲染进程同步设置中心里自定义的快捷键（menu-sync-shortcuts），重建菜单使加速键与实际按键一致。
 * 入参来自渲染进程，先规范化再使用；返回规范化后的绑定。
 */
export const syncMenuShortcuts = (value: unknown): MenuShortcutBindings => {
  const next = normalizeMenuShortcutBindings(value);
  const changed =
    next.toggleSidebar !== bindings.toggleSidebar ||
    next.toggleFocusMode !== bindings.toggleFocusMode ||
    next.openInspiration !== bindings.openInspiration;
  bindings = next;
  if (changed) registerAllShortcuts();
  return next;
};
