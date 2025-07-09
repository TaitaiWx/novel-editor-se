import { BrowserWindow } from 'electron';

/**
 * 保存文件
 */
export const saveFile = () => {
  const window = BrowserWindow.getFocusedWindow();
  if (window) {
    window.webContents.send('shortcut-save-file');
  }
};
