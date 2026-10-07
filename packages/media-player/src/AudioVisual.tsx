/**
 * 纯音频的画面：封面（poster 或音符圆标）+ 标题 + 波形样式的进度（已播放部分高亮，点击跳转）。
 * 波形是按标题生成的固定图案（不解码音频，零开销），只表示进度，不代表真实振幅。
 * 控制条与视频共用（播放 / 进度 / 音量 / 时间 / 循环 / 速度 / 清晰度），截图 / 录制 / 画中画 / 全屏不显示。
 */
import React from 'react';
import { VscDebugPause, VscPlay } from 'react-icons/vsc';
import { ratioFromPointer } from './format';
import styles from './audio-visual.module.scss';

const BAR_COUNT = 64;

/** 按种子生成固定的波形高度（0.22–1），同一标题每次相同 */
export function waveformBars(seed: string, count = BAR_COUNT): number[] {
  // FNV-1a 散列 + xorshift 伪随机，结果只取决于种子
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  state = state >>> 0 || 1;
  const bars: number[] = [];
  for (let index = 0; index < count; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const noise = (state % 1000) / 1000;
    // 中间略高、两端略低，看起来像一段语音 / 音乐
    const envelope = 0.55 + 0.45 * Math.sin((Math.PI * (index + 0.5)) / count);
    bars.push(Number(Math.max(0.22, Math.min(1, envelope * (0.45 + noise * 0.55))).toFixed(3)));
  }
  return bars;
}

export interface AudioVisualProps {
  title: string;
  poster?: string;
  showTitle: boolean;
  current: number;
  duration: number;
  paused: boolean;
  compact: boolean;
  actions?: React.ReactNode;
  /** 行尾的额外按钮（例如「开启声音」），不覆盖波形 */
  trailing?: React.ReactNode;
  onSeek: (time: number) => void;
  onTogglePlay: () => void;
}

const AudioVisual: React.FC<AudioVisualProps> = ({
  title,
  poster,
  showTitle,
  current,
  duration,
  paused,
  compact,
  actions,
  trailing,
  onSeek,
  onTogglePlay,
}) => {
  const bars = React.useMemo(() => waveformBars(title), [title]);
  const known = Number.isFinite(duration) && duration > 0;
  const progress = known ? Math.min(1, Math.max(0, current / duration)) : 0;
  const playedBars = Math.round(progress * bars.length);
  return (
    <div
      className={[styles.visual, compact ? styles.compact : '', paused ? '' : styles.playing]
        .filter(Boolean)
        .join(' ')}
      data-testid="audio-visual"
    >
      <span
        className={styles.cover}
        aria-hidden="true"
        onClick={(event) => {
          event.stopPropagation();
          onTogglePlay();
        }}
      >
        {poster ? (
          <img src={poster} alt="" draggable={false} />
        ) : paused ? (
          <VscPlay />
        ) : (
          <VscDebugPause />
        )}
      </span>
      <div className={styles.body}>
        {(showTitle || actions) && (
          <div className={styles.head}>
            {showTitle && (
              <span className={styles.title} title={title}>
                {title}
              </span>
            )}
            {actions && <div className={styles.actions}>{actions}</div>}
          </div>
        )}
        <div
          className={styles.wave}
          aria-hidden="true"
          onClick={(event) => {
            event.stopPropagation();
            if (!known) return;
            const rect = event.currentTarget.getBoundingClientRect();
            onSeek(ratioFromPointer(event.clientX, rect.left, rect.width) * duration);
          }}
        >
          {bars.map((height, index) => (
            <span
              key={index}
              className={index < playedBars ? `${styles.bar} ${styles.played}` : styles.bar}
              style={{ height: `${Math.round(height * 100)}%` }}
            />
          ))}
        </div>
      </div>
      {trailing}
    </div>
  );
};

export default AudioVisual;
