/**
 * E2E 后台运行：测试时窗口不出现在屏幕上、不抢焦点、不出声，也不占 Dock，不影响正在用电脑的人。
 *
 * - 默认窗口照常显示（便于看到测试在做什么）；设置 NOVEL_EDITOR_E2E_BACKGROUND=1 时才在后台运行。
 *   无论是否后台，E2E 下所有页面都静音（e2e/support/app.ts 另加 --mute-audio）
 * - 窗口照常创建并「显示」，但完全透明、忽略系统鼠标事件、显示时不激活：Chromium 认为窗口可见，
 *   渲染 / 定时器 / rAF 与前台一致（隐藏或最小化的窗口会被节流，用例会变慢变不稳）；
 *   测试经 CDP 直接向页面派发鼠标 / 键盘事件，不经过系统，所以透明、忽略鼠标不影响操作
 * - 所有页面静音；macOS 隐藏 Dock 图标，应用不会被激活到前台
 */
import { app, BrowserWindow } from 'electron';
import { isE2ETestMode } from './launch-mode';

export function isE2EBackgroundMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return isE2ETestMode() && env.NOVEL_EDITOR_E2E_BACKGROUND === '1';
}

/** 让一个窗口在后台运行（导出供单测） */
export function backgroundWindow(win: BrowserWindow): void {
  win.setOpacity(0);
  win.setIgnoreMouseEvents(true);
  win.setSkipTaskbar(true);
  win.webContents.setAudioMuted(true);
  // 显示时不激活、不抢焦点
  win.show = () => win.showInactive();
  win.focus = () => undefined;
  win.moveTop = () => undefined;
}

/** 在 app ready 之前调用 */
export function installE2EBackgroundMode(): void {
  if (!isE2ETestMode()) return;
  // 测试时不出声
  app.on('web-contents-created', (_event, contents) => contents.setAudioMuted(true));
  if (!isE2EBackgroundMode()) return;
  app.on('browser-window-created', (_event, win) => backgroundWindow(win));
  void app.whenReady().then(() => app.dock?.hide());
}
