import React, { useCallback, useMemo, useState } from 'react';
import ContextMenu from '../ContextMenu';
import styles from './styles.module.scss';

export interface TabBarProps {
  tabs: string[];
  activeTab: string | null;
  tabLabels?: Record<string, string>;
  focusMode?: boolean;
  onTabSelect: (filePath: string) => void;
  onTabClose: (filePath: string) => void;
  onCloseOtherTabs?: (filePath: string) => void;
  onCloseAllTabs?: () => void;
  onCloseAllAndSave?: () => void;
}

function getFileName(filePath: string, tabLabels?: Record<string, string>): string {
  const mappedLabel = tabLabels?.[filePath];
  if (mappedLabel) {
    return mappedLabel;
  }
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
  tabLabels?: Record<string, string>;
  onSelect: (filePath: string) => void;
  onClose: (filePath: string) => void;
  onContextMenu: (filePath: string, x: number, y: number) => void;
}> = React.memo(({ filePath, isActive, tabLabels, onSelect, onClose, onContextMenu }) => {
  const fileName = useMemo(() => getFileName(filePath, tabLabels), [filePath, tabLabels]);
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

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(filePath, e.clientX, e.clientY);
    },
    [filePath, onContextMenu]
  );

  return (
    <div
      className={tabClassName}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
      title={filePath}
    >
      <span className={styles.tabName}>{fileName}</span>
      <button className={styles.closeButton} onClick={handleClose} aria-label={`Close ${fileName}`}>
        &times;
      </button>
    </div>
  );
});

const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTab,
  tabLabels,
  focusMode = false,
  onTabSelect,
  onTabClose,
  onCloseOtherTabs,
  onCloseAllTabs,
  onCloseAllAndSave,
}) => {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; filePath: string } | null>(null);

  const handleTabContextMenu = useCallback((filePath: string, x: number, y: number) => {
    setCtxMenu({ x, y, filePath });
  }, []);

  const handleCloseCtxMenu = useCallback(() => {
    setCtxMenu(null);
  }, []);

  const handleBarContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // 右键在空白区域时 filePath 为空
    setCtxMenu({ x: e.clientX, y: e.clientY, filePath: '' });
  }, []);

  if (tabs.length === 0) {
    return null;
  }

  const hasTarget = ctxMenu && ctxMenu.filePath !== '';
  const ctxMenuItems = ctxMenu
    ? [
        ...(hasTarget
          ? [
              { label: '关闭', onClick: () => onTabClose(ctxMenu.filePath) },
              {
                label: '关闭其他',
                onClick: () => onCloseOtherTabs?.(ctxMenu.filePath),
                disabled: tabs.length <= 1,
              },
              { label: '', onClick: () => {}, separator: true },
            ]
          : []),
        { label: '关闭所有', onClick: () => onCloseAllTabs?.() },
        { label: '保存所有并关闭', onClick: () => onCloseAllAndSave?.() },
      ]
    : [];

  return (
    <div
      className={`${styles.tabBar} ${focusMode ? styles.focusMode : ''}`}
      onContextMenu={handleBarContextMenu}
    >
      {tabs.map((filePath) => (
        <TabItem
          key={filePath}
          filePath={filePath}
          isActive={filePath === activeTab}
          tabLabels={tabLabels}
          onSelect={onTabSelect}
          onClose={onTabClose}
          onContextMenu={handleTabContextMenu}
        />
      ))}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenuItems}
          onClose={handleCloseCtxMenu}
        />
      )}
    </div>
  );
};

export default TabBar;
