import { BrowserWindow } from 'electron';

/**
 * 新建文件
 */
export const newFile = () => {
  const window = BrowserWindow.getFocusedWindow();
  if (window) {
    window.webContents.send('shortcut-new-file');
  }
};
