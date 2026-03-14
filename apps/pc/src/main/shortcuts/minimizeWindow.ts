import { BrowserWindow } from 'electron';

/**
 * 最小化窗口
 */
export const minimizeWindow = () => {
  const window = BrowserWindow.getFocusedWindow();
  if (window) {
    window.minimize();
  }
};
