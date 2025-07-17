import React from 'react';
import { IoChevronBack, IoClose } from 'react-icons/io5';
import styles from './styles.module.scss';

interface OutlineHeaderProps {
  title: string;
  itemCount: number;
  onCollapse: () => void;
  onClose?: () => void;
}

const OutlineHeader: React.FC<OutlineHeaderProps> = ({ title, itemCount, onCollapse, onClose }) => {
  return (
    <div className={styles.outlineHeader}>
      <div className={styles.headerContent}>
        <div className={styles.headerTitle}>
          <h3>{title}</h3>
          {itemCount > 0 && (
            <span className={styles.itemCount}>{itemCount} 项</span>
          )}
        </div>
        
        <div className={styles.headerActions}>
          {onClose && (
            <button
              className={styles.closeButton}
              onClick={onClose}
              title="关闭大纲面板"
            >
              <IoClose size={16} />
            </button>
          )}
          <button
            className={styles.collapseButton}
            onClick={onCollapse}
            title="折叠大纲面板"
          >
            <IoChevronBack size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default OutlineHeader; 