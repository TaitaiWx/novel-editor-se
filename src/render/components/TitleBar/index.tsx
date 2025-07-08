import React, { useState, useEffect } from 'react';
import {
  VscChromeMinimize,
  VscChromeMaximize,
  VscChromeRestore,
  VscChromeClose,
} from 'react-icons/vsc';
import styles from './styles.module.scss';

interface TitleBarProps {
  title?: string;
  showControls?: boolean;
}

const TitleBar: React.FC<TitleBarProps> = ({ title = '小说编辑器', showControls = true }) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [platform, setPlatform] = useState<string>('');

  // 获取平台信息
  useEffect(() => {
    const getPlatform = () => {
      const userAgent = navigator.userAgent.toLowerCase();
      if (userAgent.includes('win')) return 'windows';
      if (userAgent.includes('mac')) return 'darwin';
      if (userAgent.includes('linux')) return 'linux';
      return 'unknown';
    };

    setPlatform(getPlatform());
  }, []);

  // 检查窗口是否最大化
  useEffect(() => {
    const checkMaximized = async () => {
      if (window.electron?.ipcRenderer) {
        try {
          const maximized = await window.electron.ipcRenderer.invoke('window-is-maximized');
          setIsMaximized(maximized);
        } catch (error) {
          console.error('Error checking window maximized state:', error);
        }
      }
    };

    checkMaximized();
  }, []);

  const handleMinimize = async () => {
    try {
      await window.electron.ipcRenderer.invoke('window-minimize');
    } catch (error) {
      console.error('Error minimizing window:', error);
    }
  };

  const handleMaximize = async () => {
    try {
      await window.electron.ipcRenderer.invoke('window-maximize');
      // 切换最大化状态
      setIsMaximized(!isMaximized);
    } catch (error) {
      console.error('Error maximizing window:', error);
    }
  };

  const handleClose = async () => {
    try {
      await window.electron.ipcRenderer.invoke('window-close');
    } catch (error) {
      console.error('Error closing window:', error);
    }
  };

  return (
    <div className={`${styles.titleBar} ${platform ? styles[platform] : ''}`}>
      <div className={styles.titleBarContent}>
        {/* 应用图标和标题 */}
        <div className={styles.titleSection}>
          <div className={styles.appIcon}>📝</div>
          <span className={styles.appTitle}>{title}</span>
        </div>

        {/* 拖拽区域 */}
        <div className={styles.dragRegion} />

        {/* 窗口控制按钮 */}
        {showControls && (
          <div className={styles.windowControls}>
            <button
              className={`${styles.controlButton} ${styles.minimizeButton}`}
              onClick={handleMinimize}
              title="最小化"
              aria-label="最小化窗口"
            >
              <VscChromeMinimize className={styles.minimizeIcon} />
            </button>
            <button
              className={`${styles.controlButton} ${styles.maximizeButton}`}
              onClick={handleMaximize}
              title={isMaximized ? '还原' : '最大化'}
              aria-label={isMaximized ? '还原窗口' : '最大化窗口'}
            >
              {isMaximized ? (
                <VscChromeRestore className={styles.maximizeIcon} />
              ) : (
                <VscChromeMaximize className={styles.maximizeIcon} />
              )}
            </button>
            <button
              className={`${styles.controlButton} ${styles.closeButton}`}
              onClick={handleClose}
              title="关闭"
              aria-label="关闭窗口"
            >
              <VscChromeClose className={styles.closeIcon} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default TitleBar;
