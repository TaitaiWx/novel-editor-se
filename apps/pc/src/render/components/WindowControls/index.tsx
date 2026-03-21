import React, { useState, useEffect, useCallback } from 'react';
import {
  VscChromeMinimize,
  VscChromeMaximize,
  VscChromeRestore,
  VscChromeClose,
} from 'react-icons/vsc';
import styles from './styles.module.scss';

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
    <div className={`${styles.windowControls} ${platform ? styles[platform] : ''}`}>
      <button
        className={`${styles.controlButton} ${styles.minimizeButton}`}
        onClick={handleMinimize}
        title="最小化"
        aria-label="最小化窗口"
      >
        <VscChromeMinimize className={styles.controlIcon} />
      </button>
      <button
        className={`${styles.controlButton} ${styles.maximizeButton}`}
        onClick={handleMaximize}
        title={isMaximized ? '还原' : '最大化'}
        aria-label={isMaximized ? '还原窗口' : '最大化窗口'}
      >
        {isMaximized ? (
          <VscChromeRestore className={styles.controlIcon} />
        ) : (
          <VscChromeMaximize className={styles.controlIcon} />
        )}
      </button>
      <button
        className={`${styles.controlButton} ${styles.closeButton}`}
        onClick={handleClose}
        title="关闭"
        aria-label="关闭窗口"
      >
        <VscChromeClose className={styles.controlIcon} />
      </button>
    </div>
  );
};

export default WindowControls;
