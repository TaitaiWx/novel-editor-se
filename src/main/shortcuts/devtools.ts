import { BrowserWindow } from 'electron';

/**
 * 打开/关闭开发者工具
 */
export const toggleDevTools = () => {
  const window = BrowserWindow.getFocusedWindow();
  if (window) {
    if (window.webContents.isDevToolsOpened()) {
      window.webContents.closeDevTools();
    } else {
      window.webContents.openDevTools();
    }
  }
};
