import { BrowserWindow } from 'electron';

/**
 * 切换大纲视图
 */
export const toggleOutline = () => {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow) {
    focusedWindow.webContents.send('toggle-outline');
  }
}; 