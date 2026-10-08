import { BrowserWindow } from 'electron';
import { devToolsAllowed } from '../devtools-policy';

/**
 * 打开/关闭开发者工具
 */
export const toggleDevTools = () => {
  if (!devToolsAllowed()) return;
  const window = BrowserWindow.getFocusedWindow();
  if (window) {
    if (window.webContents.isDevToolsOpened()) {
      window.webContents.closeDevTools();
    } else {
      window.webContents.openDevTools();
    }
  }
};
