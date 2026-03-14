import { BrowserWindow } from 'electron';

/**
 * 另存为
 */
export const saveAsFile = () => {
  const window = BrowserWindow.getFocusedWindow();
  if (window) {
    window.webContents.send('shortcut-save-as-file');
  }
};
