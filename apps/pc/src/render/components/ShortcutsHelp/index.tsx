import React, { useState, useEffect, useMemo } from 'react';
import type { ShortcutInfo } from '../../types';
import styles from './styles.module.scss';
import { getShortcutInfo } from './shortcuts/getShortcutInfo';
import { formatShortcutText } from './shortcuts/formatShortcutText';

interface ShortcutsHelpProps {
  visible: boolean;
  onClose: () => void;
}

const CATEGORY_ORDER = ['文件', '编辑', '视图', '应用'] as const;

const ShortcutsHelp: React.FC<ShortcutsHelpProps> = ({ visible, onClose }) => {
  const [shortcuts, setShortcuts] = useState<ShortcutInfo[]>([]);

  useEffect(() => {
    if (!visible) return;
    const loadShortcuts = async () => {
      const shortcutList = await getShortcutInfo();
      setShortcuts(shortcutList);
    };
    loadShortcuts();
  }, [visible]);

  // 按分类分组
  const grouped = useMemo(() => {
    const map = new Map<string, ShortcutInfo[]>();
    for (const cat of CATEGORY_ORDER) {
      map.set(cat, []);
    }
    for (const s of shortcuts) {
      const cat = s.category || '应用';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(s);
    }
    return map;
  }, [shortcuts]);

  if (!visible) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3>键盘快捷键</h3>
          <button className={styles.closeButton} onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className={styles.content}>
          {CATEGORY_ORDER.map((cat) => {
            const items = grouped.get(cat);
            if (!items || items.length === 0) return null;
            return (
              <div key={cat} className={styles.categoryGroup}>
                <div className={styles.categoryTitle}>{cat}</div>
                <div className={styles.shortcutsList}>
                  {items.map((shortcut, index) => (
                    <div key={index} className={styles.shortcutItem}>
                      <div className={styles.shortcutKeys}>
                        {formatShortcutText(shortcut.accelerator)}
                      </div>
                      <div className={styles.shortcutDescription}>{shortcut.description}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ShortcutsHelp;
