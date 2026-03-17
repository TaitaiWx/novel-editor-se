import React, { useState, useEffect, useMemo } from 'react';
import type { ShortcutInfo } from '../../types';
import styles from './styles.module.scss';
import { getShortcutInfo } from './shortcuts/getShortcutInfo';
import { formatShortcutText } from './shortcuts/formatShortcutText';

interface ShortcutsHelpProps {
  visible: boolean;
  onClose: () => void;
  onOpenSampleData?: () => void;
}

const CATEGORY_ORDER = ['文件', '编辑', '视图', '应用'] as const;

const ShortcutsHelp: React.FC<ShortcutsHelpProps> = ({ visible, onClose, onOpenSampleData }) => {
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

        {onOpenSampleData && (
          <div className={styles.footer}>
            <button
              className={styles.sampleDataBtn}
              onClick={() => {
                onOpenSampleData();
                onClose();
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M1.5 2.5h5l1 1h6v9h-12v-10z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                  fill="none"
                />
                <path
                  d="M5 8h6M8 5.5v5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
              打开示例项目
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ShortcutsHelp;
