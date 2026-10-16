import React, { useState, useEffect, useCallback } from 'react';
import WindowControlsView from '@novel-editor/ui/WindowControls';

/**
 * 跨平台窗口控制按钮（最小化、最大化/还原、关闭）。
 * 在主窗口 TitleBar 和独立 AI 窗口等场景间复用。
 */
const WindowControls: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [platform, setPlatform] = useState<string>('');

  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('win')) setPlatform('windows');
    else if (ua.includes('mac')) setPlatform('darwin');
    else if (ua.includes('linux')) setPlatform('linux');
  }, []);

  useEffect(() => {
    const checkMaximized = async () => {
      try {
        const maximized = await window.electron?.ipcRenderer?.invoke('window-is-maximized');
        if (typeof maximized === 'boolean') setIsMaximized(maximized);
      } catch {
        /* ignored */
      }
    };
    checkMaximized();
  }, []);

  const handleMinimize = useCallback(async () => {
    try {
      await window.electron.ipcRenderer.invoke('window-minimize');
    } catch {
      /* ignored */
    }
  }, []);

  const handleMaximize = useCallback(async () => {
    try {
      await window.electron.ipcRenderer.invoke('window-maximize');
      setIsMaximized((prev) => !prev);
    } catch {
      /* ignored */
    }
  }, []);

  const handleClose = useCallback(async () => {
    try {
      await window.electron.ipcRenderer.invoke('window-close');
    } catch {
      /* ignored */
    }
  }, []);

  return (
    <WindowControlsView
      platform={platform}
      isMaximized={isMaximized}
      onMinimize={handleMinimize}
      onToggleMaximize={handleMaximize}
      onClose={handleClose}
    />
  );
};
export default WindowControls;
