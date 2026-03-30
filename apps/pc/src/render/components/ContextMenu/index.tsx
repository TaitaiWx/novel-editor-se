import React, { useLayoutEffect, useRef, useCallback, useState } from 'react';
import OverlayPortal from '../OverlayPortal';
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
  const [position, setPosition] = useState({ left: x, top: y });

  const handleItemClick = useCallback(
    (itemOnClick: () => void) => {
      itemOnClick();
      onClose();
    },
    [onClose]
  );

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const menuRect = menu.getBoundingClientRect();
    const nextLeft = Math.max(8, Math.min(x, window.innerWidth - menuRect.width - 8));
    const nextTop = Math.max(8, Math.min(y, window.innerHeight - menuRect.height - 8));
    setPosition({ left: nextLeft, top: nextTop });
  }, [items, x, y]);

  return (
    <OverlayPortal
      ref={menuRef}
      open
      className={styles.contextMenu}
      style={{ left: position.left, top: position.top }}
      role="menu"
      onClose={onClose}
      closeOnOutsideClick
      closeOnEscape
    >
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
    </OverlayPortal>
  );
};

export default ContextMenu;
