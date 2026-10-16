import UiButton from '../Button';
import React from 'react';
import {
  VscChromeMinimize,
  VscChromeMaximize,
  VscChromeRestore,
  VscChromeClose,
} from 'react-icons/vsc';
import styles from './styles.module.scss';

export interface WindowControlsProps {
  platform?: string;
  isMaximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}
const WindowControls: React.FC<WindowControlsProps> = ({
  platform = '',
  isMaximized,
  onMinimize,
  onToggleMaximize,
  onClose,
}) => {
  return (
    <div className={`${styles.windowControls} ${platform ? styles[platform] : ''}`}>
      <UiButton
        unstyled
        className={`${styles.controlButton} ${styles.minimizeButton}`}
        onClick={onMinimize}
        title="最小化"
        aria-label="最小化窗口"
      >
        <VscChromeMinimize className={styles.controlIcon} />
      </UiButton>
      <UiButton
        unstyled
        className={`${styles.controlButton} ${styles.maximizeButton}`}
        onClick={onToggleMaximize}
        title={isMaximized ? '还原' : '最大化'}
        aria-label={isMaximized ? '还原窗口' : '最大化窗口'}
      >
        {isMaximized ? (
          <VscChromeRestore className={styles.controlIcon} />
        ) : (
          <VscChromeMaximize className={styles.controlIcon} />
        )}
      </UiButton>
      <UiButton
        unstyled
        className={`${styles.controlButton} ${styles.closeButton}`}
        onClick={onClose}
        title="关闭"
        aria-label="关闭窗口"
      >
        <VscChromeClose className={styles.controlIcon} />
      </UiButton>
    </div>
  );
};

export default WindowControls;
