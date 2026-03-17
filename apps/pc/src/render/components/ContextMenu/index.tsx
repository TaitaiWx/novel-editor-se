import React, { useEffect, useRef, useCallback } from 'react';
import styles from './styles.module.scss';

interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onCloseRef.current();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const handleItemClick = useCallback((itemOnClick: () => void) => {
    itemOnClick();
    onCloseRef.current();
  }, []);

  // Adjust position if menu would go off screen
  const adjustedX = Math.min(x, window.innerWidth - 180);
  const adjustedY = Math.min(y, window.innerHeight - items.length * 32 - 8);

  return (
    <div ref={menuRef} className={styles.contextMenu} style={{ left: adjustedX, top: adjustedY }}>
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className={styles.separator} />
        ) : (
          <button
            key={i}
            className={`${styles.menuItem} ${item.danger ? styles.danger : ''} ${item.disabled ? styles.disabled : ''}`}
            onClick={() => !item.disabled && handleItemClick(item.onClick)}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  );
};

export default ContextMenu;
