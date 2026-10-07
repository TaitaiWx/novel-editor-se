/**
 * 预演播放条：播放 / 暂停、可拖动的进度条、时间、循环，以及取景辅助线开关。
 */
import React from 'react';
import { VscDebugPause, VscPlay, VscSync } from 'react-icons/vsc';
import Tooltip from '../../Tooltip';
import type { PrevizPlayback } from './usePrevizPlayback';
import type { PrevizOverlays } from './FrameOverlay';
import styles from './styles.module.scss';

interface PlayerBarProps {
  playback: PrevizPlayback;
  duration: number;
  disabled: boolean;
  overlays: PrevizOverlays;
  onToggleOverlay: (key: keyof PrevizOverlays) => void;
}

const formatSeconds = (value: number) => `${value.toFixed(1)}s`;

const PlayerBar: React.FC<PlayerBarProps> = ({
  playback,
  duration,
  disabled,
  overlays,
  onToggleOverlay,
}) => (
  <div className={styles.player} role="toolbar" aria-label="预演播放">
    <Tooltip content={playback.playing ? '暂停（空格）' : '播放（空格）'}>
      <button
        type="button"
        className={styles.playButton}
        aria-label={playback.playing ? '暂停预演' : '播放预演'}
        disabled={disabled}
        onClick={playback.toggle}
      >
        {playback.playing ? <VscDebugPause /> : <VscPlay />}
      </button>
    </Tooltip>
    <input
      type="range"
      className={styles.scrub}
      aria-label="预演进度"
      min={0}
      max={duration}
      step={0.01}
      value={Math.min(playback.time, duration)}
      disabled={disabled}
      onChange={(event) => {
        playback.pause();
        playback.seek(Number(event.target.value));
      }}
    />
    <span className={styles.timecode} data-testid="previz-time">
      {formatSeconds(playback.time)} / {formatSeconds(duration)}
    </span>
    <Tooltip content={playback.loop ? '循环播放：开' : '循环播放：关'}>
      <button
        type="button"
        className={playback.loop ? styles.toolActive : styles.tool}
        aria-label="循环播放"
        aria-pressed={playback.loop}
        onClick={() => playback.setLoop(!playback.loop)}
      >
        <VscSync />
      </button>
    </Tooltip>
    <span className={styles.toolGap} />
    <button
      type="button"
      aria-pressed={overlays.thirds}
      className={overlays.thirds ? styles.toolActive : styles.tool}
      onClick={() => onToggleOverlay('thirds')}
    >
      三分线
    </button>
    <button
      type="button"
      aria-pressed={overlays.safe}
      className={overlays.safe ? styles.toolActive : styles.tool}
      onClick={() => onToggleOverlay('safe')}
    >
      安全框
    </button>
  </div>
);

export default PlayerBar;
