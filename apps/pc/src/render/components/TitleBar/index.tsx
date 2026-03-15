import React, { useState, useEffect, useCallback } from 'react';
import {
  VscChromeMinimize,
  VscChromeMaximize,
  VscChromeRestore,
  VscChromeClose,
} from 'react-icons/vsc';
import appMarkUrl from '../../../../resources/branding/app-mark.svg';
import styles from './styles.module.scss';

interface TitleBarProps {
  title?: string;
  showControls?: boolean;
  focusMode?: boolean;
  onToggleFocusMode?: () => void;
  onShowShortcuts?: () => void;
}

const TitleBar: React.FC<TitleBarProps> = ({
  title = '小说编辑器',
  showControls = true,
  focusMode = false,
  onToggleFocusMode,
  onShowShortcuts,
}) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [platform, setPlatform] = useState<string>('');

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

  useEffect(() => {
    const checkMaximized = async () => {
      if (window.electron?.ipcRenderer) {
        try {
          const maximized = await window.electron.ipcRenderer.invoke('window-is-maximized');
          setIsMaximized(maximized);
        } catch (error) {
          console.error('检查窗口状态失败:', error);
        }
      }
    };
    checkMaximized();
  }, []);

  const handleMinimize = useCallback(async () => {
    try {
      await window.electron.ipcRenderer.invoke('window-minimize');
    } catch (error) {
      console.error('最小化失败:', error);
    }
  }, []);

  const handleMaximize = useCallback(async () => {
    try {
      await window.electron.ipcRenderer.invoke('window-maximize');
      setIsMaximized((prev) => !prev);
    } catch (error) {
      console.error('最大化失败:', error);
    }
  }, []);

  const handleClose = useCallback(async () => {
    try {
      await window.electron.ipcRenderer.invoke('window-close');
    } catch (error) {
      console.error('关闭失败:', error);
    }
  }, []);

  return (
    <div className={`${styles.titleBar} ${platform ? styles[platform] : ''}`}>
      <div className={styles.titleBarContent}>
        {/* 左侧：应用图标 + 标题 */}
        <div className={styles.titleSection}>
          <img className={styles.appIcon} src={appMarkUrl} alt="Novel Editor" />
          <span className={styles.appTitle}>{title}</span>
        </div>

        {/* 中间：居中拖拽区 */}
        <div className={styles.dragRegion} />

        {/* 居中：专注模式按钮 */}
        {onToggleFocusMode && (
          <div className={styles.centerTools}>
            <button
              className={`${styles.toolButton} ${focusMode ? styles.focusModeActive : ''}`}
              onClick={onToggleFocusMode}
              title={focusMode ? '退出专注模式 (F11)' : '进入专注模式 (F11)'}
            >
              {focusMode ? '退出专注' : '专注'}
            </button>
          </div>
        )}

        {/* 右侧工具区：快捷键提示 + 窗口控制 */}
        <div className={styles.toolSection}>
          {onShowShortcuts && (
            <button className={styles.toolButton} onClick={onShowShortcuts} title="键盘快捷键">
              ⌨
            </button>
          )}
        </div>

        {/* 窗口控制按钮 */}
        {showControls && (
          <div className={styles.windowControls}>
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
        )}
      </div>
    </div>
  );
};

export default TitleBar;
