import React from 'react';
import styles from './styles.module.scss';
export type GenerationPhase = 'waiting' | 'generating' | 'done' | 'failed' | 'cancelled';
export interface GenerationStatusProps {
  phase?: GenerationPhase;
  label?: string;
  compact?: boolean;
}
export default function GenerationStatus({
  phase = 'generating',
  label,
  compact = false,
}: GenerationStatusProps) {
  const text =
    label ??
    (phase === 'waiting'
      ? '等待生成'
      : phase === 'done'
        ? '已生成'
        : phase === 'cancelled'
          ? '已取消'
          : phase === 'failed'
            ? '生成失败'
            : '生成中');
  return (
    <span
      className={`${styles.status} ${phase === 'failed' ? styles.failed : phase === 'done' ? styles.done : ''}`}
      title={text}
      aria-label={compact ? text : undefined}
    >
      <span aria-hidden="true" className={phase === 'generating' ? styles.spinner : styles.mark}>
        {phase === 'done'
          ? '✓'
          : phase === 'waiting'
            ? '·'
            : phase === 'failed'
              ? '!'
              : phase === 'cancelled'
                ? '—'
                : ''}
      </span>
      {!compact && <span>{text}</span>}
    </span>
  );
}
