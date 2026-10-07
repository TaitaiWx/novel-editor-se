/**
 * 参考窗格：写作时在编辑器右侧看图片 / 视频（本章引用、场景视频的成片与样片、人物 / 设定图集、资料）。
 *
 * - 任何地方经 utils/referencePane 的 requestOpenReference 打开（右键「在编辑器旁边打开」）
 * - 文件栏「参考」按钮以自动模式打开：本章 ::image / ::video / Markdown 图片 → 本章场景视频 → 人物图，
 *   切换文档、编辑指令、资料变化时自动更新（作者加入的参考与排好的顺序保留，见 useReferencePaneState）
 * - 拖动缩略图排序；资料树 / 系统文件管理器里的文件拖进来即加入；缩略图拖到正文插入 ::image / ::video 指令
 * - 显示中的文件在磁盘上被修改时自动重新读取（useReferenceHotReload）
 * - 打开是同步的：本章引用还没解析出路径时先显示占位骨架，解析后原位替换
 * - 停靠在编辑器右侧，可拖动左边缘调整宽度；可缩成右下角的小卡片
 * 窗格状态只在当前窗口内存中，关闭后不保留。
 */
import React, { useCallback, useRef, useState } from 'react';
import { VscClose, VscScreenFull, VscScreenNormal } from 'react-icons/vsc';
import Tooltip from '../Tooltip';
import {
  NOVEL_EDITOR_PATH_MIME,
  REFERENCE_TILE_MIME,
  type ReferenceItem,
} from '../../utils/referencePane';
import { buildMediaDirective } from '../../utils/referenceSources';
import ReferenceStage, { ReferenceMedia, type MediaInfo } from './ReferenceStage';
import ReferenceInfo from './ReferenceInfo';
import ReferenceGrid from './ReferenceGrid';
import { readDroppedPaths } from './dropPaths';
import { useReferencePaneState } from './useReferencePaneState';
import { useReferenceHotReload } from './useReferenceHotReload';
import styles from './styles.module.scss';

export {
  mergeReferenceItems,
  indexAfterRemove,
  type ReferencePaneMode,
} from './useReferencePaneState';

export const REFERENCE_PANE_MIN_WIDTH = 240;
export const REFERENCE_PANE_MAX_WIDTH = 720;
const DEFAULT_WIDTH = 360;

export function clampPaneWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_WIDTH;
  return Math.min(REFERENCE_PANE_MAX_WIDTH, Math.max(REFERENCE_PANE_MIN_WIDTH, Math.round(width)));
}

function isExternalDrop(event: React.DragEvent): boolean {
  const types = Array.from(event.dataTransfer.types ?? []);
  return types.includes(NOVEL_EDITOR_PATH_MIME) || types.includes('Files');
}

const ReferencePane: React.FC<{ hidden?: boolean }> = ({ hidden = false }) => {
  const pane = useReferencePaneState();
  const { items, index, current, mode, setMode, close, step, select, removeAt, move, addPaths } =
    pane;
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const versions = useReferenceHotReload({
    active: mode !== 'closed' && !hidden,
    currentPath: current && !current.pending ? current.path : null,
    paths: items.filter((item) => !item.pending).map((item) => item.path),
  });
  const { getSource } = pane;
  const directiveFor = useCallback(
    (item: ReferenceItem) => {
      const source = getSource();
      return buildMediaDirective(item, source?.documentPath ?? null, source?.workPath ?? null);
    },
    [getSource]
  );

  // 资料树 / 系统文件拖到窗格空白处：加到末尾
  const dropHandlers = {
    onDragOver: (event: React.DragEvent) => {
      if (!isExternalDrop(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      if (!dropActive) setDropActive(true);
    },
    onDragLeave: (event: React.DragEvent) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setDropActive(false);
    },
    onDrop: (event: React.DragEvent) => {
      setDropActive(false);
      if (!isExternalDrop(event)) return;
      event.preventDefault();
      addPaths(readDroppedPaths(event));
    },
  };
  const paneClass = dropActive ? `${styles.pane} ${styles.paneDrop}` : styles.pane;

  if (mode === 'closed' || hidden) return null;
  if (!current) {
    return (
      <aside
        className={paneClass}
        style={{ width }}
        aria-label="参考窗格"
        data-testid="reference-pane"
        {...dropHandlers}
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
            <li>把资料里的图片 / 视频拖到这里，或右键「在编辑器旁边打开」</li>
            <li>正文里的 ::image / ::video 会自动出现在这里</li>
            <li>人物、设定的图集：右键图片「在编辑器旁边打开」</li>
            <li>场景视频：本章的成片与样片会自动出现</li>
          </ul>
        </div>
      </aside>
    );
  }

  if (mode === 'mini') {
    return (
      <aside className={styles.mini} aria-label="参考（小卡片）" data-testid="reference-mini">
        <ReferenceMedia item={current} compact version={versions[current.path] ?? 0} />
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
      className={paneClass}
      style={{ width }}
      aria-label="参考窗格"
      data-testid="reference-pane"
      data-auto={pane.autoMode ? 'true' : 'false'}
      onKeyDown={(event) => {
        if (event.altKey || event.metaKey || event.ctrlKey) return;
        if (event.key === 'ArrowLeft') step(-1);
        if (event.key === 'ArrowRight') step(1);
      }}
      {...dropHandlers}
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
      <div className={styles.body}>
        <ReferenceStage
          item={current}
          version={versions[current.path] ?? 0}
          multiple={items.length > 1}
          onStep={step}
          onInfo={setInfo}
        />
        {current.pending ? (
          <div className={styles.info} data-testid="reference-info">
            <div className={styles.meta}>
              <span className={styles.metaText}>正在定位文件…</span>
            </div>
          </div>
        ) : (
          <ReferenceInfo
            item={current}
            info={info}
            directive={directiveFor(current)}
            onRemove={() => removeAt(index)}
          />
        )}
        {items.length > 1 && (
          <ReferenceGrid
            items={items}
            index={index}
            versions={versions}
            onSelect={select}
            onMove={move}
            onAddPaths={(paths, at) => addPaths(paths, at)}
            directiveFor={directiveFor}
          />
        )}
      </div>
    </aside>
  );
};

export { REFERENCE_TILE_MIME };
export default ReferencePane;
