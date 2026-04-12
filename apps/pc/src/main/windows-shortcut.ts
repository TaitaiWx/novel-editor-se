import { app, shell } from 'electron';
import { mkdir } from 'fs/promises';
import { dirname, join } from 'path';

const SHORTCUT_NAME = 'Novel Editor.lnk';

function buildShortcutOptions() {
  return {
    target: process.execPath,
    cwd: dirname(process.execPath),
    description: 'Novel Editor',
    icon: process.execPath,
    iconIndex: 0,
  };
}

async function ensureShortcut(shortcutPath: string) {
  await mkdir(dirname(shortcutPath), { recursive: true });
  const options = buildShortcutOptions();
  // 使用 replace 模式保证升级后目标路径变化时快捷方式可被覆盖修复。
  const replaced = shell.writeShortcutLink(shortcutPath, 'replace', options);
  if (!replaced) {
    shell.writeShortcutLink(shortcutPath, options);
  }
}

/**
 * Windows 升级后自愈快捷方式：
 * 1) 桌面快捷方式
 * 2) 开始菜单快捷方式
 */
export async function ensureWindowsShortcuts(): Promise<void> {
  if (process.platform !== 'win32' || !app.isPackaged) {
    return;
  }

  const desktopShortcutPath = join(app.getPath('desktop'), SHORTCUT_NAME);
  const startMenuShortcutPath = join(
    app.getPath('appData'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    SHORTCUT_NAME
  );

  await Promise.all([ensureShortcut(desktopShortcutPath), ensureShortcut(startMenuShortcutPath)]);
}
