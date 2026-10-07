/**
 * 参考窗格的主画面：贴在顶部、按比例适应宽度（不留大块空白）。
 * - 图片：单击在「适应宽度 ↔ 原始大小」之间切换，原始大小时可滚动 / 拖动查看
 * - 视频：自定义播放器（静音循环自动播放，可开声音 / 关循环）
 * - 多张时左右两侧浮现上一张 / 下一张
 */
import React, { useEffect, useRef, useState } from 'react';
import { VscChevronLeft, VscChevronRight } from 'react-icons/vsc';
import Tooltip from '../Tooltip';
import VideoPlayer from '../VideoPlayer';
import type { ReferenceItem } from '../../utils/referencePane';
import { useReferenceMedia } from './useReferenceMedia';
import styles from './styles.module.scss';

export interface MediaInfo {
  path: string;
  width: number;
  height: number;
  /** 视频时长（秒），图片没有 */
  duration?: number;
}

/** 移动超过这个距离视为拖动，不切换缩放 */
const DRAG_THRESHOLD = 4;

const ZoomableImage: React.FC<{
  url: string;
  item: ReferenceItem;
  onInfo: (info: MediaInfo) => void;
}> = ({ url, item, onInfo }) => {
  const [zoomed, setZoomed] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => setZoomed(false), [item.path]);

  return (
    <div
      ref={boxRef}
      className={zoomed ? styles.zoomBox : styles.fitBox}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const box = boxRef.current;
        dragRef.current = {
          x: event.clientX,
          y: event.clientY,
          left: box?.scrollLeft ?? 0,
          top: box?.scrollTop ?? 0,
          moved: false,
        };
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        const box = boxRef.current;
        if (!drag || !box) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        drag.moved = true;
        if (zoomed) {
          box.scrollLeft = drag.left - dx;
          box.scrollTop = drag.top - dy;
        }
      }}
      onPointerUp={() => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (drag && !drag.moved) setZoomed((value) => !value);
      }}
      onPointerLeave={() => {
        dragRef.current = null;
      }}
    >
      <img
        className={zoomed ? styles.imageActual : styles.imageFit}
        src={url}
        alt={item.title}
        draggable={false}
        data-testid="reference-image"
        data-zoomed={zoomed ? 'true' : 'false'}
        title={zoomed ? '单击缩回适应宽度' : '单击查看原始大小'}
        onLoad={(event) =>
          onInfo({
            path: item.path,
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          })
        }
      />
    </div>
  );
};

export const ReferenceMedia: React.FC<{
  item: ReferenceItem;
  compact: boolean;
  /** 文件在磁盘上被修改后递增，重新读取 */
  version?: number;
  onInfo?: (info: MediaInfo) => void;
}> = ({ item, compact, version = 0, onInfo }) => {
  const { url, error } = useReferenceMedia(item, version);
  if (!url) {
    return <div className={styles.placeholder}>{error ? `无法读取：${error}` : '读取中…'}</div>;
  }
  if (item.kind === 'video') {
    return (
      <VideoPlayer
        key={`${item.path}#${version}`}
        src={url}
        title={item.title}
        variant={compact ? 'compact' : 'full'}
        autoPlay
        defaultMuted
        defaultLoop
        showLoopToggle
        showTitle={false}
        maxHeight={compact ? 160 : '62vh'}
        className={compact ? styles.miniPlayer : styles.player}
        videoTestId="reference-video"
        onMetadata={({ width, height, duration }) =>
          onInfo?.({ path: item.path, width, height, duration })
        }
      />
    );
  }
  if (compact) {
    return (
      <img className={styles.miniImage} src={url} alt={item.title} data-testid="reference-image" />
    );
  }
  return (
    <ZoomableImage
      key={`${item.path}#${version}`}
      url={url}
      item={item}
      onInfo={(info) => onInfo?.(info)}
    />
  );
};

const ReferenceStage: React.FC<{
  item: ReferenceItem;
  version?: number;
  multiple: boolean;
  onStep: (offset: number) => void;
  onInfo: (info: MediaInfo) => void;
}> = ({ item, version = 0, multiple, onStep, onInfo }) => (
  <div className={styles.stage} data-testid="reference-stage">
    <ReferenceMedia item={item} compact={false} version={version} onInfo={onInfo} />
    {multiple && (
      <>
        <Tooltip content="上一张（←）" className={`${styles.navSlot} ${styles.navPrev}`}>
          <button
            type="button"
            className={styles.nav}
            aria-label="上一张参考"
            onClick={() => onStep(-1)}
          >
            <VscChevronLeft />
          </button>
        </Tooltip>
        <Tooltip content="下一张（→）" className={`${styles.navSlot} ${styles.navNext}`}>
          <button
            type="button"
            className={styles.nav}
            aria-label="下一张参考"
            onClick={() => onStep(1)}
          >
            <VscChevronRight />
          </button>
        </Tooltip>
      </>
    )}
  </div>
);

export default ReferenceStage;
