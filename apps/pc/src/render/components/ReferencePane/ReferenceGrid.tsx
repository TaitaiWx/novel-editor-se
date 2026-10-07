/**
 * 参考列表：缩略图网格（图片显示缩略图，视频显示播放图标 + 标题），选中的高亮；填满窗格剩余空间，可滚动。
 */
import React, { useEffect, useRef } from 'react';
import { VscPlay } from 'react-icons/vsc';
import type { ReferenceItem } from '../../utils/referencePane';
import { useReferenceMedia } from './useReferenceMedia';
import styles from './styles.module.scss';

const Thumb: React.FC<{ item: ReferenceItem }> = ({ item }) => {
  // 视频不为缩略图整段读取，只显示播放图标
  const { url } = useReferenceMedia(item.kind === 'image' ? item : null);
  if (item.kind === 'video') {
    return (
      <span className={`${styles.thumbMedia} ${styles.thumbVideo}`} aria-hidden="true">
        <VscPlay />
      </span>
    );
  }
  return (
    <span className={styles.thumbMedia} aria-hidden="true">
      {url && <img src={url} alt="" draggable={false} />}
    </span>
  );
};

const ReferenceGrid: React.FC<{
  items: readonly ReferenceItem[];
  index: number;
  onSelect: (index: number) => void;
}> = ({ items, index, onSelect }) => {
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [index]);

  return (
    <section className={styles.gridSection} aria-label="全部参考">
      <div className={styles.gridHead}>全部参考 · {items.length}</div>
      <ul className={styles.grid} role="listbox" aria-label="参考列表">
        {items.map((item, itemIndex) => {
          const selected = itemIndex === index;
          return (
            <li key={item.path} role="presentation">
              <button
                ref={selected ? selectedRef : undefined}
                type="button"
                role="option"
                aria-selected={selected}
                className={selected ? `${styles.thumb} ${styles.thumbActive}` : styles.thumb}
                title={item.title}
                onClick={() => onSelect(itemIndex)}
              >
                <Thumb item={item} />
                <span className={styles.thumbTitle}>{item.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default ReferenceGrid;
