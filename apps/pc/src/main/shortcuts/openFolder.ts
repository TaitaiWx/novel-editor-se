import { BrowserWindow } from 'electron';

/**
 * 打开文件夹
 */
export const openFolder = () => {
  const window = BrowserWindow.getFocusedWindow();
  if (window) {
    window.webContents.send('shortcut-open-folder');
  }
};
