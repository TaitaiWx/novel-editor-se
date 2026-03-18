import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  VscChromeMinimize,
  VscChromeMaximize,
  VscChromeRestore,
  VscChromeClose,
  VscSettingsGear,
  VscSettings,
  VscFolderOpened,
} from 'react-icons/vsc';
import { AiOutlineClose, AiOutlineEye, AiOutlineKey, AiOutlineRobot } from 'react-icons/ai';
import appMarkUrl from '../../../../resources/branding/app-mark.svg';
import styles from './styles.module.scss';

interface TitleBarProps {
  title?: string;
  showControls?: boolean;
  focusMode?: boolean;
  userInitials?: string;
  onToggleFocusMode?: () => void;
  onShowShortcuts?: () => void;
  onOpenSettings?: () => void;
  onOpenAccountSettings?: () => void;
  onOpenSampleData?: () => void;
  onOpenAIAssistant?: () => void;
}

const TitleBar: React.FC<TitleBarProps> = ({
  title = '小说编辑器',
  showControls = true,
  focusMode = false,
  userInitials = 'U',
  onToggleFocusMode,
  onShowShortcuts,
  onOpenSettings,
  onOpenAccountSettings,
  onOpenSampleData,
  onOpenAIAssistant,
}) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [platform, setPlatform] = useState<string>('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

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
        } catch {}
      }
    };
    checkMaximized();
  }, []);

  const handleMinimize = useCallback(async () => {
    try {
      await window.electron.ipcRenderer.invoke('window-minimize');
    } catch {}
  }, []);

  const handleMaximize = useCallback(async () => {
    try {
      await window.electron.ipcRenderer.invoke('window-maximize');
      setIsMaximized((prev) => !prev);
    } catch {}
  }, []);

  const handleClose = useCallback(async () => {
    try {
      await window.electron.ipcRenderer.invoke('window-close');
    } catch {}
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [settingsOpen]);

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
              <span className={styles.toolButtonIcon}>
                {focusMode ? <AiOutlineClose /> : <AiOutlineEye />}
              </span>
              <span>{focusMode ? '退出专注' : '专注写作'}</span>
            </button>
          </div>
        )}

        {/* 右侧工具区：设置 + 窗口控制 */}
        <div className={styles.toolSection}>
          <button
            className={styles.userButton}
            onClick={onOpenAccountSettings}
            title="用户设置"
            aria-label="打开用户设置"
          >
            <span className={styles.userAvatar}>{userInitials.slice(0, 2).toUpperCase()}</span>
          </button>
          <button
            className={styles.toolIconButton}
            onClick={onOpenAIAssistant}
            title="AI 助手"
            aria-label="打开 AI 助手"
          >
            <AiOutlineRobot />
          </button>
          <div className={styles.settingsWrap} ref={settingsRef}>
            <button
              className={styles.toolIconButton}
              onClick={() => setSettingsOpen((prev) => !prev)}
              title="设置"
              aria-label="打开设置"
            >
              <VscSettingsGear />
            </button>
            {settingsOpen && (
              <div className={styles.settingsMenu}>
                <div className={styles.settingsTitle}>软件设置</div>
                {onOpenSettings && (
                  <button
                    className={styles.settingsItem}
                    onClick={() => {
                      setSettingsOpen(false);
                      onOpenSettings();
                    }}
                  >
                    <VscSettings />
                    <span>设置中心</span>
                  </button>
                )}
                <button
                  className={styles.settingsItem}
                  onClick={() => {
                    setSettingsOpen(false);
                    onShowShortcuts?.();
                  }}
                >
                  <AiOutlineKey />
                  <span>键盘快捷键</span>
                </button>
                {onOpenSampleData && (
                  <button
                    className={styles.settingsItem}
                    onClick={() => {
                      setSettingsOpen(false);
                      onOpenSampleData();
                    }}
                  >
                    <VscFolderOpened />
                    <span>打开示例项目</span>
                  </button>
                )}
              </div>
            )}
          </div>
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
