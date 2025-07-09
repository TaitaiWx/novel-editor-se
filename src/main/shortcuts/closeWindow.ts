import { BrowserWindow } from 'electron';

/**
 * 关闭当前窗口
 */
export const closeWindow = () => {
  const window = BrowserWindow.getFocusedWindow();
  if (window) {
    window.close();
  }
};
