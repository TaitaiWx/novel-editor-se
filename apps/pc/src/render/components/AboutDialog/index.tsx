import React, { useEffect } from 'react';
import { isImeComposing } from '../../utils/ime';
import AboutCard from '../AboutContent';
import styles from './styles.module.scss';

interface AboutDialogProps {
  visible: boolean;
  onClose: () => void;
}

/** 小巧的「关于小说编辑器」窗口（应用菜单、设置菜单、状态栏版本面板均可打开） */
const AboutDialog: React.FC<AboutDialogProps> = ({ visible, onClose }) => {
  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isImeComposing(event)) return;
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="关于小说编辑器"
        onClick={(e) => e.stopPropagation()}
      >
        <button className={styles.closeButton} onClick={onClose} aria-label="关闭关于">
          ×
        </button>
        <AboutCard active={visible} />
      </div>
    </div>
  );
};

export default AboutDialog;
