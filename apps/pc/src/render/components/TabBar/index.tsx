import React, { useCallback, useMemo } from 'react';
import styles from './styles.module.scss';

export interface TabBarProps {
  tabs: string[];
  activeTab: string | null;
  onTabSelect: (filePath: string) => void;
  onTabClose: (filePath: string) => void;
}

function getFileName(filePath: string): string {
  if (filePath.startsWith('__untitled__:')) {
    return filePath.replace('__untitled__:', '');
  }
  if (filePath.startsWith('__changelog__:')) {
    return filePath.replace('__changelog__:', '');
  }
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filePath;
}

const TabItem: React.FC<{
  filePath: string;
  isActive: boolean;
  onSelect: (filePath: string) => void;
  onClose: (filePath: string) => void;
}> = React.memo(({ filePath, isActive, onSelect, onClose }) => {
  const fileName = useMemo(() => getFileName(filePath), [filePath]);
  const tabClassName = isActive ? `${styles.tab} ${styles.active}` : styles.tab;

  const handleClick = useCallback(() => {
    onSelect(filePath);
  }, [filePath, onSelect]);

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose(filePath);
    },
    [filePath, onClose]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        onClose(filePath);
      }
    },
    [filePath, onClose]
  );

  return (
    <div
      className={tabClassName}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      title={filePath}
    >
      <span className={styles.tabName}>{fileName}</span>
      <button className={styles.closeButton} onClick={handleClose} aria-label={`Close ${fileName}`}>
        &times;
      </button>
    </div>
  );
});

const TabBar: React.FC<TabBarProps> = ({ tabs, activeTab, onTabSelect, onTabClose }) => {
  if (tabs.length === 0) {
    return null;
  }

  return (
    <div className={styles.tabBar}>
      {tabs.map((filePath) => (
        <TabItem
          key={filePath}
          filePath={filePath}
          isActive={filePath === activeTab}
          onSelect={onTabSelect}
          onClose={onTabClose}
        />
      ))}
    </div>
  );
};

export default TabBar;
