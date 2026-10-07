/**
 * 参考列表：缩略图网格（图片显示缩略图，视频显示播放图标 + 标题），选中的高亮；填满窗格剩余空间，可滚动。
 *
 * - 来源分组：本章 / 场景视频 / 人物 / 添加的，来源变化处显示小标题
 * - 拖动缩略图排序（键盘：Alt + ← / → 移动选中的参考）；拖到编辑器里插入 ::image / ::video 指令
 * - 资料树或系统文件管理器里的文件拖到某张缩略图上，插到它前 / 后
 */
import React, { useEffect, useRef, useState } from 'react';
import { VscPlay } from 'react-icons/vsc';
import {
  NOVEL_EDITOR_PATH_MIME,
  REFERENCE_GROUP_LABELS,
  REFERENCE_TILE_MIME,
  type ReferenceItem,
} from '../../utils/referencePane';
import { dropTargetIndex, groupOf } from '../../utils/referenceSources';
import { useReferenceMedia } from './useReferenceMedia';
import { readDroppedPaths } from './dropPaths';
import styles from './styles.module.scss';

const Thumb: React.FC<{ item: ReferenceItem; version: number }> = ({ item, version }) => {
  // 视频不为缩略图整段读取，只显示播放图标
  const { url } = useReferenceMedia(item.kind === 'image' ? item : null, version);
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

/** 拖动排序的落点指示：插到第 index 张之前 / 之后 */
interface DropMarker {
  index: number;
  after: boolean;
}

function hasType(event: React.DragEvent, type: string): boolean {
  return Array.from(event.dataTransfer.types ?? []).includes(type);
}

const ReferenceGrid: React.FC<{
  items: readonly ReferenceItem[];
  index: number;
  versions: Record<string, number>;
  onSelect: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onAddPaths: (paths: string[], at: number) => void;
  /** 拖到编辑器时插入的指令 */
  directiveFor: (item: ReferenceItem) => string;
}> = ({ items, index, versions, onSelect, onMove, onAddPaths, directiveFor }) => {
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  const [marker, setMarker] = useState<DropMarker | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [index]);

  const acceptsDrop = (event: React.DragEvent) =>
    hasType(event, REFERENCE_TILE_MIME) ||
    hasType(event, NOVEL_EDITOR_PATH_MIME) ||
    hasType(event, 'Files');

  return (
    <section className={styles.gridSection} aria-label="全部参考">
      <div className={styles.gridHead}>
        全部参考 · {items.length}
        <span className={styles.gridHint}>拖动排序，拖到正文插入</span>
      </div>
      <ul className={styles.grid} role="listbox" aria-label="参考列表">
        {items.map((item, itemIndex) => {
          const selected = itemIndex === index;
          const group = groupOf(item);
          const showGroup = itemIndex === 0 || groupOf(items[itemIndex - 1]) !== group;
          const markerClass =
            marker?.index === itemIndex
              ? marker.after
                ? styles.dropAfter
                : styles.dropBefore
              : '';
          return (
            <React.Fragment key={item.path}>
              {showGroup && (
                <li role="presentation" className={styles.groupLabel} data-testid="reference-group">
                  {REFERENCE_GROUP_LABELS[group]}
                </li>
              )}
              <li
                role="presentation"
                className={markerClass}
                onDragOver={(event) => {
                  if (!acceptsDrop(event)) return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = hasType(event, REFERENCE_TILE_MIME)
                    ? 'move'
                    : 'copy';
                  const rect = event.currentTarget.getBoundingClientRect();
                  const after = event.clientX > rect.left + rect.width / 2;
                  setMarker((prev) =>
                    prev?.index === itemIndex && prev.after === after
                      ? prev
                      : { index: itemIndex, after }
                  );
                }}
                onDragLeave={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                  setMarker((prev) => (prev?.index === itemIndex ? null : prev));
                }}
                onDrop={(event) => {
                  if (!acceptsDrop(event)) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  const after = event.clientX > rect.left + rect.width / 2;
                  setMarker(null);
                  if (hasType(event, REFERENCE_TILE_MIME)) {
                    const from = Number(event.dataTransfer.getData(REFERENCE_TILE_MIME));
                    if (Number.isInteger(from) && from >= 0) {
                      onMove(from, dropTargetIndex(from, itemIndex, after));
                    }
                    return;
                  }
                  const paths = readDroppedPaths(event);
                  if (paths.length > 0) onAddPaths(paths, after ? itemIndex + 1 : itemIndex);
                }}
              >
                <button
                  ref={selected ? selectedRef : undefined}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                  className={[
                    styles.thumb,
                    selected ? styles.thumbActive : '',
                    dragging === itemIndex ? styles.thumbDragging : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  title={`${item.title}（拖动排序，Alt + ← / → 移动）`}
                  data-testid="reference-tile"
                  data-path={item.path}
                  draggable
                  onClick={() => onSelect(itemIndex)}
                  onKeyDown={(event) => {
                    if (!event.altKey) return;
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                    event.preventDefault();
                    event.stopPropagation();
                    onMove(itemIndex, itemIndex + (event.key === 'ArrowLeft' ? -1 : 1));
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'copyMove';
                    event.dataTransfer.setData(REFERENCE_TILE_MIME, String(itemIndex));
                    // 拖到编辑器：CodeMirror 默认把 text/plain 插在落点
                    event.dataTransfer.setData('text/plain', `\n${directiveFor(item)}\n`);
                    setDragging(itemIndex);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setMarker(null);
                  }}
                >
                  <Thumb item={item} version={versions[item.path] ?? 0} />
                  <span className={styles.thumbTitle}>{item.title}</span>
                </button>
              </li>
            </React.Fragment>
          );
        })}
      </ul>
    </section>
  );
};

export default ReferenceGrid;
