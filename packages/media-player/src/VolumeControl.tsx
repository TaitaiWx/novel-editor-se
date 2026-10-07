/**
 * 静音按钮 + 悬停 / 聚焦时展开的音量滑块。
 * 视频确定没有音轨时，按钮显示「无音轨」（不可点，不展开滑块），避免作者以为声音被吞掉。
 */
import React from 'react';
import { VscMute, VscUnmute } from 'react-icons/vsc';
import type { AudioTrackState } from './audio';
import ControlButton, { type RenderTooltip } from './ControlButton';
import styles from './styles.module.scss';

interface VolumeControlProps {
  muted: boolean;
  volume: number;
  audio: AudioTrackState;
  onToggleMute: () => void;
  onVolume: (volume: number) => void;
  renderTooltip?: RenderTooltip;
}

const VolumeControl: React.FC<VolumeControlProps> = ({
  muted,
  volume,
  audio,
  onToggleMute,
  onVolume,
  renderTooltip,
}) => {
  if (audio === 'absent') {
    return (
      <ControlButton
        tooltip="这个视频没有音轨"
        renderTooltip={renderTooltip}
        className={styles.noAudio}
        aria-label="无音轨"
        aria-disabled="true"
        data-audio="absent"
      >
        <VscMute />
      </ControlButton>
    );
  }
  const silent = muted || volume === 0;
  const percent = Math.round((muted ? 0 : volume) * 100);
  return (
    <div className={styles.volume}>
      <ControlButton
        tooltip={muted ? '取消静音（M）' : '静音（M）'}
        renderTooltip={renderTooltip}
        aria-label={muted ? '取消静音' : '静音'}
        onClick={onToggleMute}
      >
        {silent ? <VscMute /> : <VscUnmute />}
      </ControlButton>
      <input
        className={styles.volumeSlider}
        type="range"
        min={0}
        max={100}
        step={5}
        value={percent}
        aria-label="音量"
        aria-valuetext={`${percent}%`}
        style={{ '--media-player-volume': `${percent}%` } as React.CSSProperties}
        onChange={(event) => onVolume(Number(event.currentTarget.value) / 100)}
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
};

export default VolumeControl;
