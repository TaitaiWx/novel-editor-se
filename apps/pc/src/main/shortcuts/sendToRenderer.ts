import { BrowserWindow } from 'electron';

/**
 * 把应用菜单事件发给渲染进程：优先聚焦窗口，没有聚焦窗口时（例如 macOS 窗口全部最小化）发给第一个窗口
 */
export const sendToRenderer = (channel: string, ...args: unknown[]) => {
  const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  target?.webContents.send(channel, ...args);
};

/** 通知渲染进程打开应用内「关于」对话框 */
export const openAboutDialog = () => sendToRenderer('menu-open-about');
