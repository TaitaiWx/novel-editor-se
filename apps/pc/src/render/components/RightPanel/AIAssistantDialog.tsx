import React from 'react';
import { createPortal } from 'react-dom';
import { AIView } from './AIView';
import styles from './styles.module.scss';

export const AIAssistantDialog: React.FC<{
  visible: boolean;
  onClose: () => void;
  folderPath: string | null;
  content: string;
}> = React.memo(({ visible, onClose, folderPath, content }) => {
  if (!visible) return null;

  return createPortal(
    <>
      <div className={styles.aiDialogBackdrop} onClick={onClose} />
      <div className={styles.aiDialogPanel}>
        <div className={styles.aiDialogHeader}>
          <span>AI 助手</span>
          <button className={styles.aiDialogClose} onClick={onClose}>
            ✕
          </button>
        </div>
        <div className={styles.aiDialogBody}>
          <AIView folderPath={folderPath} content={content} />
        </div>
      </div>
    </>,
    document.body
  );
});
