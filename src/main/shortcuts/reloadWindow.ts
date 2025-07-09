import { BrowserWindow } from 'electron';

/**
 * 刷新页面
 */
export const reloadWindow = () => {
  const window = BrowserWindow.getFocusedWindow();
  if (window) {
    window.reload();
  }
};
