/**
 * 播放进度条：细线，悬停 / 拖动时变粗；点击或拖动跳转，← / → 每次 5 秒，Home / End 跳到首尾。
 */
import React, { useRef } from 'react';
import { formatTime, ratioFromPointer } from './format';
import styles from './styles.module.scss';

export const SEEK_STEP_SECONDS = 5;

interface ProgressBarProps {
  current: number;
  duration: number;
  /** 跳转到指定时间（秒） */
  onSeek: (time: number) => void;
  onDragChange?: (dragging: boolean) => void;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ current, duration, onSeek, onDragChange }) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const known = Number.isFinite(duration) && duration > 0;
  const percent = known ? Math.min(100, Math.max(0, (current / duration) * 100)) : 0;

  const seekToPointer = (clientX: number) => {
    const track = trackRef.current;
    if (!track || !known) return;
    const rect = track.getBoundingClientRect();
    onSeek(ratioFromPointer(clientX, rect.left, rect.width) * duration);
  };

  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    onDragChange?.(false);
  };

  return (
    <div
      ref={trackRef}
      className={styles.progress}
      role="slider"
      tabIndex={0}
      aria-label="播放进度"
      aria-valuemin={0}
      aria-valuemax={known ? Math.round(duration * 10) / 10 : 0}
      aria-valuenow={Math.round(current * 10) / 10}
      aria-valuetext={`${formatTime(current)} / ${formatTime(duration)}`}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        draggingRef.current = true;
        onDragChange?.(true);
        event.currentTarget.setPointerCapture?.(event.pointerId);
        seekToPointer(event.clientX);
      }}
      onPointerMove={(event) => {
        if (draggingRef.current) seekToPointer(event.clientX);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        let target: number | null = null;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
          target = current - SEEK_STEP_SECONDS;
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
          target = current + SEEK_STEP_SECONDS;
        } else if (event.key === 'Home') {
          target = 0;
        } else if (event.key === 'End' && known) {
          target = duration;
        }
        if (target === null) return;
        event.preventDefault();
        event.stopPropagation();
        onSeek(target);
      }}
    >
      <div className={styles.progressTrack}>
        <div className={styles.progressFill} style={{ width: `${percent}%` }} />
        <div className={styles.progressThumb} style={{ left: `${percent}%` }} />
      </div>
    </div>
  );
};

export default ProgressBar;
