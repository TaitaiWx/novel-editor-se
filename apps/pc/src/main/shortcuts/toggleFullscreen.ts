import { BrowserWindow } from 'electron';

/**
 * 切换全屏模式
 */
export const toggleFullscreen = () => {
  const window = BrowserWindow.getFocusedWindow();
  if (window) {
    window.setFullScreen(!window.isFullScreen());
  }
};
