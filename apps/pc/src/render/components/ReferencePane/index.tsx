/**
 * 参考窗格：写作时在编辑器右侧看图片 / 视频（资料、人物 / 设定图集、场景视频的成片与样片）。
 *
 * - 任何地方经 utils/referencePane 的 requestOpenReference 打开（右键「在编辑器旁边打开」）
 * - 停靠在编辑器右侧，可拖动左边缘调整宽度；可缩成右下角的小卡片，写作时不占地方
 * - 多张参考之间用缩略条 / ← → 切换；视频默认循环播放、静音，可逐段对照着写
 * 窗格状态只在当前窗口内存中，关闭后不保留。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  VscChevronLeft,
  VscChevronRight,
  VscClose,
  VscScreenFull,
  VscScreenNormal,
} from 'react-icons/vsc';
import Tooltip from '../Tooltip';
import {
  REFERENCE_OPEN_EVENT,
  REFERENCE_TOGGLE_EVENT,
  announceReferenceState,
  type OpenReferenceDetail,
  type ReferenceItem,
  type ToggleReferenceDetail,
} from '../../utils/referencePane';
import { useReferenceMedia } from './useReferenceMedia';
import styles from './styles.module.scss';

export type ReferencePaneMode = 'closed' | 'docked' | 'mini';

export const REFERENCE_PANE_MIN_WIDTH = 240;
export const REFERENCE_PANE_MAX_WIDTH = 720;
const DEFAULT_WIDTH = 360;

export function clampPaneWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_WIDTH;
  return Math.min(REFERENCE_PANE_MAX_WIDTH, Math.max(REFERENCE_PANE_MIN_WIDTH, Math.round(width)));
}

/** 合并新打开的参考：同一路径不重复，最多保留 30 个（新的在后） */
export function mergeReferenceItems(
  current: readonly ReferenceItem[],
  added: readonly ReferenceItem[]
): ReferenceItem[] {
  const paths = new Set(added.map((item) => item.path));
  return [...current.filter((item) => !paths.has(item.path)), ...added].slice(-30);
}

const Viewer: React.FC<{ item: ReferenceItem; compact: boolean }> = ({ item, compact }) => {
  const { url, error } = useReferenceMedia(item);
  if (!url) {
    return <div className={styles.placeholder}>{error ? `无法读取：${error}` : '读取中…'}</div>;
  }
  return item.kind === 'video' ? (
    <video
      className={styles.media}
      src={url}
      controls={!compact}
      autoPlay
      loop
      muted
      playsInline
      data-testid="reference-video"
      aria-label={item.title}
    />
  ) : (
    <img className={styles.media} src={url} alt={item.title} data-testid="reference-image" />
  );
};

const ReferencePane: React.FC<{ hidden?: boolean }> = ({ hidden = false }) => {
  const [items, setItems] = useState<ReferenceItem[]>([]);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<ReferencePaneMode>('closed');
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenReferenceDetail>).detail;
      if (!detail?.items?.length) return;
      setItems((prev) => {
        const merged = mergeReferenceItems(prev, detail.items);
        const target =
          detail.items[Math.max(0, Math.min(detail.items.length - 1, detail.index ?? 0))];
        setIndex(
          Math.max(
            0,
            merged.findIndex((item) => item.path === target.path)
          )
        );
        return merged;
      });
      setMode('docked');
    };
    window.addEventListener(REFERENCE_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(REFERENCE_OPEN_EVENT, onOpen);
  }, []);

  // 文件栏「参考」按钮：开着就收起；关着就打开（没有内容时先放当前作品的人物参考）
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useEffect(() => {
    const onToggle = (event: Event) => {
      const detail = (event as CustomEvent<ToggleReferenceDetail>).detail;
      if (modeRef.current !== 'closed') {
        setMode('closed');
        setItems([]);
        setIndex(0);
        return;
      }
      setItems(detail?.fallback ?? []);
      setIndex(0);
      setMode('docked');
    };
    window.addEventListener(REFERENCE_TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(REFERENCE_TOGGLE_EVENT, onToggle);
  }, []);
  useEffect(() => {
    announceReferenceState(mode !== 'closed');
  }, [mode]);

  const close = useCallback(() => {
    setMode('closed');
    setItems([]);
    setIndex(0);
  }, []);
  const step = (offset: number) =>
    setIndex((current) => (items.length ? (current + offset + items.length) % items.length : 0));

  if (mode === 'closed' || hidden) return null;
  if (items.length === 0) {
    return (
      <aside
        className={styles.pane}
        style={{ width }}
        aria-label="参考窗格"
        data-testid="reference-pane"
      >
        <header className={styles.head}>
          <span className={styles.title}>参考</span>
          <Tooltip content="关闭参考">
            <button
              type="button"
              className={styles.iconButton}
              aria-label="关闭参考"
              onClick={close}
            >
              <VscClose />
            </button>
          </Tooltip>
        </header>
        <div className={styles.empty} data-testid="reference-empty">
          <p>写作时在这里对照图片和视频。</p>
          <ul>
            <li>资料里的图片 / 视频：右键「在编辑器旁边打开」</li>
            <li>人物、设定的图集：右键图片「在编辑器旁边打开」</li>
            <li>正文里的 ::image / ::video：点「在旁边看」</li>
            <li>场景视频：镜头与样片的「在旁边看」</li>
          </ul>
        </div>
      </aside>
    );
  }
  const current = items[Math.min(index, items.length - 1)];

  if (mode === 'mini') {
    return (
      <aside className={styles.mini} aria-label="参考（小卡片）" data-testid="reference-mini">
        <Viewer item={current} compact />
        <div className={styles.miniBar}>
          <span className={styles.miniTitle} title={current.title}>
            {current.title}
          </span>
          <Tooltip content="展开到编辑器旁边">
            <button
              type="button"
              className={styles.iconButton}
              aria-label="展开参考窗格"
              onClick={() => setMode('docked')}
            >
              <VscScreenFull />
            </button>
          </Tooltip>
          <Tooltip content="关闭参考">
            <button
              type="button"
              className={styles.iconButton}
              aria-label="关闭参考"
              onClick={close}
            >
              <VscClose />
            </button>
          </Tooltip>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={styles.pane}
      style={{ width }}
      aria-label="参考窗格"
      data-testid="reference-pane"
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') step(-1);
        if (event.key === 'ArrowRight') step(1);
      }}
    >
      <div
        className={styles.resizer}
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动调整参考窗格宽度"
        onPointerDown={(event) => {
          dragRef.current = { startX: event.clientX, startWidth: width };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!dragRef.current) return;
          setWidth(
            clampPaneWidth(dragRef.current.startWidth + dragRef.current.startX - event.clientX)
          );
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
      />
      <header className={styles.head}>
        <span className={styles.title} title={current.title}>
          {current.title}
        </span>
        {items.length > 1 && (
          <span className={styles.counter}>
            {index + 1} / {items.length}
          </span>
        )}
        <Tooltip content="缩成右下角的小卡片">
          <button
            type="button"
            className={styles.iconButton}
            aria-label="缩成小卡片"
            onClick={() => setMode('mini')}
          >
            <VscScreenNormal />
          </button>
        </Tooltip>
        <Tooltip content="关闭参考">
          <button type="button" className={styles.iconButton} aria-label="关闭参考" onClick={close}>
            <VscClose />
          </button>
        </Tooltip>
      </header>
      <div className={styles.stage}>
        {items.length > 1 && (
          <Tooltip content="上一张（←）" className={`${styles.navSlot} ${styles.navPrev}`}>
            <button
              type="button"
              className={styles.nav}
              aria-label="上一张参考"
              onClick={() => step(-1)}
            >
              <VscChevronLeft />
            </button>
          </Tooltip>
        )}
        <Viewer item={current} compact={false} />
        {items.length > 1 && (
          <Tooltip content="下一张（→）" className={`${styles.navSlot} ${styles.navNext}`}>
            <button
              type="button"
              className={styles.nav}
              aria-label="下一张参考"
              onClick={() => step(1)}
            >
              <VscChevronRight />
            </button>
          </Tooltip>
        )}
      </div>
      {items.length > 1 && (
        <ul className={styles.strip} role="listbox" aria-label="参考列表">
          {items.map((item, itemIndex) => (
            <li key={item.path}>
              <button
                type="button"
                role="option"
                aria-selected={itemIndex === index}
                className={itemIndex === index ? styles.thumbActive : styles.thumb}
                title={item.title}
                onClick={() => setIndex(itemIndex)}
              >
                {item.kind === 'video' ? '▶ ' : ''}
                {item.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
};

export default ReferencePane;
