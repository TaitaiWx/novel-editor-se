import React, { useState, useEffect, useRef } from 'react';
import { VscSettingsGear, VscSettings, VscFolderOpened, VscExport } from 'react-icons/vsc';
import { AiOutlineClose, AiOutlineEye, AiOutlineKey, AiOutlineRobot } from 'react-icons/ai';
import appMarkUrl from '../../../../resources/branding/app-mark.svg';
import WindowControls from '../WindowControls';
import styles from './styles.module.scss';

interface TitleBarProps {
  showControls?: boolean;
  focusMode?: boolean;
  userInitials?: string;
  onToggleFocusMode?: () => void;
  onShowShortcuts?: () => void;
  onOpenSettings?: () => void;
  onAvatarClick?: () => void;
  onOpenSampleData?: () => void;
  onOpenAIAssistant?: () => void;
  onExportProject?: () => void;
}

const TitleBar: React.FC<TitleBarProps> = ({
  showControls = true,
  focusMode = false,
  userInitials = 'U',
  onToggleFocusMode,
  onShowShortcuts,
  onOpenSettings,
  onAvatarClick,
  onOpenSampleData,
  onOpenAIAssistant,
  onExportProject,
}) => {
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
        {/* 左侧：应用图标 */}
        <div className={styles.titleSection}>
          <img className={styles.appIcon} src={appMarkUrl} alt="Monica" />
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
            onClick={onAvatarClick}
            title="打开设置中心"
            aria-label="打开设置中心"
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
                {onExportProject && (
                  <>
                    <div className={styles.settingsTitle}>项目</div>
                    <button
                      className={styles.settingsItem}
                      onClick={() => {
                        setSettingsOpen(false);
                        onExportProject();
                      }}
                    >
                      <VscExport />
                      <span>导出项目</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 窗口控制按钮 */}
        {showControls && <WindowControls />}
      </div>
    </div>
  );
};

export default TitleBar;
