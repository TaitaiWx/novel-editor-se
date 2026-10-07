/**
 * 应用菜单（主进程 Menu）与渲染进程之间的约定：事件通道、可配置快捷键同步、加速键转换。
 * 主进程与渲染进程共用，不依赖 Electron / DOM。
 */

/** 主进程菜单 → 渲染进程的事件通道（均需加入 preload.ts 的 on 白名单） */
export const APP_MENU_EVENTS = {
  /** 设置…（打开设置中心「通用」） */
  openSettings: 'menu-open-settings',
  /** 检查更新…（渲染进程调用 update-check 后以提示展示结果） */
  checkUpdates: 'menu-check-updates',
  /** 视图 → 切换侧边栏 */
  toggleSidebar: 'menu-toggle-sidebar',
  /** 视图 → 切换右侧面板 */
  toggleRightPanel: 'menu-toggle-right-panel',
  /** 视图 → 专注写作 */
  toggleFocusMode: 'menu-toggle-focus-mode',
  /** 编辑 → 查找（打开最近聚焦编辑器的查找面板） */
  find: 'menu-find',
  /** 编辑 → 灵感抽签…（打开灵感抽签弹窗） */
  openInspiration: 'menu-open-inspiration',
  /** 帮助 → 快捷键说明 */
  showShortcuts: 'menu-show-shortcuts',
  /** 帮助 → 更新日志 */
  openChangelog: 'menu-open-changelog',
  /** 帮助 → 上传日志… */
  uploadLogs: 'menu-upload-logs',
} as const;

export type AppMenuEvent = (typeof APP_MENU_EVENTS)[keyof typeof APP_MENU_EVENTS];

/** 渲染进程 → 主进程：同步用户自定义的快捷键，主进程据此重建菜单加速键 */
export const MENU_SYNC_SHORTCUTS_CHANNEL = 'menu-sync-shortcuts';

/** 菜单中展示、且可在设置中心自定义的快捷键（取值为渲染进程格式，如 Mod+Shift+F） */
export interface MenuShortcutBindings {
  toggleSidebar: string;
  toggleFocusMode: string;
  openInspiration: string;
}

/** 与渲染进程 DEFAULT_SHORTCUT_SETTINGS 保持一致（渲染进程同步前使用） */
export const DEFAULT_MENU_SHORTCUT_BINDINGS: MenuShortcutBindings = {
  toggleSidebar: 'Mod+B',
  toggleFocusMode: 'Mod+Shift+F',
  openInspiration: 'Mod+Shift+Y',
};

/** 帮助 → 问题反馈 */
export const FEEDBACK_URL = 'https://github.com/TaitaiWx/novel-editor-se/issues';

/** 更新日志工作区标签路径 */
export const CHANGELOG_TAB_PATH = '__changelog__:更新日志';

const MODIFIER_TOKENS: Record<string, string> = {
  MOD: 'CommandOrControl',
  CMD: 'CommandOrControl',
  COMMAND: 'CommandOrControl',
  CTRL: 'CommandOrControl',
  CONTROL: 'CommandOrControl',
  COMMANDORCONTROL: 'CommandOrControl',
  SHIFT: 'Shift',
  ALT: 'Alt',
  OPTION: 'Alt',
};

const NAMED_KEYS: Record<string, string> = {
  ESC: 'Escape',
  ESCAPE: 'Escape',
  ENTER: 'Enter',
  RETURN: 'Enter',
  SPACE: 'Space',
  TAB: 'Tab',
};

/**
 * 把渲染进程快捷键（Mod+Shift+F）转换为 Electron 菜单加速键（CommandOrControl+Shift+F）。
 * 输入来自渲染进程，按白名单校验：格式不合法或为空时返回 null（菜单项不显示加速键）。
 */
export function toMenuAccelerator(shortcut: unknown): string | null {
  if (typeof shortcut !== 'string') return null;
  const tokens = shortcut
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0 || tokens.length > 4) return null;

  const modifiers: string[] = [];
  let key: string | null = null;
  for (const token of tokens) {
    const upper = token.toUpperCase();
    const modifier = MODIFIER_TOKENS[upper];
    if (modifier) {
      if (!modifiers.includes(modifier)) modifiers.push(modifier);
      continue;
    }
    // 只允许一个主键
    if (key !== null) return null;
    if (/^[A-Z0-9]$/.test(upper)) key = upper;
    else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(upper)) key = upper;
    else if (NAMED_KEYS[upper]) key = NAMED_KEYS[upper];
    else if (/^[=\-,./;'[\]\\`]$/.test(token)) key = token;
    else return null;
  }
  if (!key) return null;
  // 单字母 / 数字必须带修饰键，否则会拦截正常输入
  if (modifiers.length === 0 && !/^F\d+$/.test(key)) return null;

  const order = ['CommandOrControl', 'Shift', 'Alt'];
  modifiers.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [...modifiers, key].join('+');
}

/** 规范化渲染进程同步来的绑定：缺失或非字符串字段回退到默认值，空字符串表示「未绑定」 */
export function normalizeMenuShortcutBindings(value: unknown): MenuShortcutBindings {
  const record =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const pick = (key: keyof MenuShortcutBindings): string =>
    typeof record[key] === 'string' ? (record[key] as string) : DEFAULT_MENU_SHORTCUT_BINDINGS[key];
  return {
    toggleSidebar: pick('toggleSidebar'),
    toggleFocusMode: pick('toggleFocusMode'),
    openInspiration: pick('openInspiration'),
  };
}
