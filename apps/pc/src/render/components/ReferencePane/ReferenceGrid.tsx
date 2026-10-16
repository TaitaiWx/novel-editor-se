import UiButton from '@novel-editor/ui/Button';
/**
 * 参考列表：图片和视频显示缩略图，音频显示专用封面；选中的高亮，可滚动。
 *
 * - 来源分组：本章 / 场景视频 / 人物 / 添加的，来源变化处显示小标题
 * - 拖动缩略图排序（键盘：Alt + ← / → 移动选中的参考）；拖到编辑器里插入 ::image / ::video / ::audio 指令
 * - 资料树或系统文件管理器里的文件拖到某张缩略图上，插到它前 / 后
 */
import React, { useEffect, useRef, useState } from 'react';
import { VscPlay, VscUnmute } from 'react-icons/vsc';
import {
  NOVEL_EDITOR_PATH_MIME,
  REFERENCE_GROUP_LABELS,
  REFERENCE_TILE_MIME,
  type ReferenceItem,
} from '../../utils/referencePane';
import { dropTargetIndex, groupOf } from '../../utils/referenceSources';
import { useReferenceMedia } from './useReferenceMedia';
import { useVideoThumbnail } from './useVideoThumbnail';
import { readDroppedPaths } from './dropPaths';
import styles from './styles.module.scss';

// 音频封面的静态装饰，不代表实际音量或播放状态。
const AUDIO_COVER_BARS = [
  10, 18, 30, 20, 42, 56, 36, 64, 46, 28, 50, 70, 44, 30, 58, 40, 24, 34, 18, 10,
];

const Thumb: React.FC<{ item: ReferenceItem; version: number }> = ({ item, version }) => {
  const anchor = useRef<HTMLSpanElement>(null);
  const { url } = useReferenceMedia(item.kind === 'image' && !item.pending ? item : null, version);
  const poster = useVideoThumbnail(
    item.kind === 'video' && !item.pending ? item.path : null,
    version,
    anchor
  );
  if (item.pending) {
    return (
      <span className={styles.thumbMedia} aria-hidden="true">
        <span className={styles.thumbSkeleton} />
      </span>
    );
  }
  if (item.kind === 'video' || item.kind === 'audio') {
    return (
      <span
        ref={anchor}
        className={`${styles.thumbMedia} ${item.kind === 'audio' ? styles.thumbAudio : styles.thumbVideo}`}
        aria-hidden="true"
        data-kind={item.kind}
      >
        {poster && <img src={poster} alt="" draggable={false} />}
        {item.kind === 'audio' ? (
          <>
            <svg className={styles.audioCoverWave} viewBox="0 0 160 80" focusable="false">
              {AUDIO_COVER_BARS.map((height, index) => (
                <rect
                  key={index}
                  x={index * 8 + 2}
                  y={(80 - height) / 2}
                  width="3"
                  height={height}
                  rx="1.5"
                />
              ))}
            </svg>
            <span className={styles.audioCoverIcon}>
              <VscUnmute />
            </span>
          </>
        ) : (
          <span className={poster ? styles.thumbPlayOverlay : undefined}>
            <VscPlay />
          </span>
        )}
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
                <UiButton
                  unstyled
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
                  data-pending={item.pending ? 'true' : undefined}
                  draggable={!item.pending}
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
                </UiButton>
              </li>
            </React.Fragment>
          );
        })}
      </ul>
    </section>
  );
};

export default ReferenceGrid;
