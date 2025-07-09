import React, { useState, useEffect } from 'react';
import type { ShortcutInfo } from '../../types';
import styles from './styles.module.scss';
import { getShortcutInfo } from './shortcuts/getShortcutInfo';
import { formatShortcutText } from './shortcuts/formatShortcutText';

interface ShortcutsHelpProps {
  onClose?: () => void;
}

const ShortcutsHelp: React.FC<ShortcutsHelpProps> = ({ onClose }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [shortcuts, setShortcuts] = useState<ShortcutInfo[]>([]);

  useEffect(() => {
    // 加载快捷键列表
    const loadShortcuts = async () => {
      const shortcutList = await getShortcutInfo();
      setShortcuts(shortcutList);
    };

    loadShortcuts();
  }, []);

  const handleToggle = () => {
    setIsVisible(!isVisible);
  };

  const handleClose = () => {
    setIsVisible(false);
    onClose?.();
  };

  return (
    <>
      <button
        className={styles.helpButton}
        onClick={handleToggle}
        title="查看键盘快捷键"
        aria-label="键盘快捷键帮助"
      >
        ⌨️
      </button>

      {isVisible && (
        <div className={styles.overlay} onClick={handleClose}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.header}>
              <h3>键盘快捷键</h3>
              <button className={styles.closeButton} onClick={handleClose} aria-label="关闭">
                ×
              </button>
            </div>

            <div className={styles.content}>
              <div className={styles.shortcutsList}>
                {shortcuts.map((shortcut, index) => (
                  <div key={index} className={styles.shortcutItem}>
                    <div className={styles.shortcutKeys}>
                      {formatShortcutText(shortcut.accelerator)}
                    </div>
                    <div className={styles.shortcutDescription}>{shortcut.description}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ShortcutsHelp;
