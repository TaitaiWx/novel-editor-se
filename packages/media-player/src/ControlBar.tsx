/**
 * 底部控制条：进度条 + 按钮行
 * 播放 / 暂停、音量、时间 ｜ 循环、截图、录制（录制中显示已录时长）、画中画、设置（清晰度 / 速度 / 字幕）、全屏。
 * 不支持的能力（画中画、录制、全屏）不显示按钮；使用方也可用 controls 属性隐藏任意按钮。
 */
import React from 'react';
import {
  VscDebugPause,
  VscDebugStop,
  VscDeviceCamera,
  VscMultipleWindows,
  VscPlay,
  VscRecord,
  VscScreenFull,
  VscScreenNormal,
  VscSync,
} from 'react-icons/vsc';
import type { AudioTrackState } from './audio';
import ControlButton, { type RenderTooltip } from './ControlButton';
import ProgressBar from './ProgressBar';
import SettingsMenu, { type CaptionOption } from './SettingsMenu';
import VolumeControl from './VolumeControl';
import { formatTime } from './format';
import type { RecordingStatus } from './recorder';
import type { QualityOption } from './useMediaEngine';
import styles from './styles.module.scss';

/** 可隐藏的控制项（默认全部显示；loop 默认跟随 showLoopToggle） */
export interface PlayerControls {
  play?: boolean;
  progress?: boolean;
  volume?: boolean;
  time?: boolean;
  loop?: boolean;
  screenshot?: boolean;
  record?: boolean;
  pip?: boolean;
  settings?: boolean;
  quality?: boolean;
  speed?: boolean;
  captions?: boolean;
  fullscreen?: boolean;
}

/** 合并使用方的开关与浏览器能力：不支持的能力一律隐藏 */
export function resolveControls(
  controls: PlayerControls | undefined,
  showLoopToggle: boolean,
  supported: { screenshot: boolean; record: boolean; pip: boolean; fullscreen: boolean }
): Required<PlayerControls> {
  const on = (key: keyof PlayerControls, fallback = true) => controls?.[key] ?? fallback;
  return {
    play: on('play'),
    progress: on('progress'),
    volume: on('volume'),
    time: on('time'),
    loop: on('loop', showLoopToggle),
    screenshot: on('screenshot') && supported.screenshot,
    record: on('record') && supported.record,
    pip: on('pip') && supported.pip,
    settings: on('settings'),
    quality: on('quality'),
    speed: on('speed'),
    captions: on('captions'),
    fullscreen: on('fullscreen') && supported.fullscreen,
  };
}

export interface ControlBarProps {
  show: Required<PlayerControls>;
  renderTooltip?: RenderTooltip;
  paused: boolean;
  onTogglePlay: () => void;
  current: number;
  duration: number;
  buffered: Array<[number, number]>;
  onSeek: (time: number) => void;
  onDragChange: (dragging: boolean) => void;
  muted: boolean;
  volume: number;
  audio: AudioTrackState;
  onToggleMute: () => void;
  onVolume: (volume: number) => void;
  loop: boolean;
  onToggleLoop: () => void;
  onScreenshot: () => void;
  recordStatus: RecordingStatus;
  recordElapsed: number;
  onToggleRecord: () => void;
  pipActive: boolean;
  onTogglePip: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  qualityOptions: QualityOption[];
  quality: string;
  onQuality: (id: string) => void;
  rate: number;
  onRate: (rate: number) => void;
  captions: CaptionOption[];
  captionIndex: number;
  onCaption: (index: number) => void;
  onMenuOpenChange: (open: boolean) => void;
}

const ControlBar: React.FC<ControlBarProps> = (props) => {
  const { show, renderTooltip, paused, recordStatus } = props;
  const recording = recordStatus === 'recording' || recordStatus === 'stopping';
  return (
    <div className={styles.controls}>
      {show.progress && (
        <ProgressBar
          current={props.current}
          duration={props.duration}
          buffered={props.buffered}
          onSeek={props.onSeek}
          onDragChange={props.onDragChange}
        />
      )}
      <div className={styles.bar}>
        {show.play && (
          <ControlButton
            tooltip={paused ? '播放（空格）' : '暂停（空格）'}
            renderTooltip={renderTooltip}
            aria-label={paused ? '播放' : '暂停'}
            onClick={props.onTogglePlay}
          >
            {paused ? <VscPlay /> : <VscDebugPause />}
          </ControlButton>
        )}
        {show.volume && (
          <VolumeControl
            muted={props.muted}
            volume={props.volume}
            audio={props.audio}
            onToggleMute={props.onToggleMute}
            onVolume={props.onVolume}
            renderTooltip={renderTooltip}
          />
        )}
        {show.time && (
          <span className={styles.time} data-testid="video-time">
            {formatTime(props.current)} / {formatTime(props.duration)}
          </span>
        )}
        <span className={styles.spacer} />
        {show.loop && (
          <ControlButton
            tooltip={props.loop ? '关闭循环' : '循环播放'}
            renderTooltip={renderTooltip}
            active={props.loop}
            aria-label="循环播放"
            aria-pressed={props.loop}
            onClick={props.onToggleLoop}
          >
            <VscSync />
          </ControlButton>
        )}
        {show.screenshot && (
          <ControlButton
            tooltip="截图（S）"
            renderTooltip={renderTooltip}
            className={styles.optional}
            aria-label="截图"
            onClick={props.onScreenshot}
          >
            <VscDeviceCamera />
          </ControlButton>
        )}
        {show.record && (
          <>
            {recording && (
              <span className={styles.recordTime} data-testid="video-record-time">
                {formatTime(props.recordElapsed)}
              </span>
            )}
            <ControlButton
              tooltip={recording ? '停止录制（R）' : '录制（R）'}
              renderTooltip={renderTooltip}
              className={`${styles.optional} ${recording ? styles.recording : ''}`}
              aria-label={recording ? '停止录制' : '开始录制'}
              aria-pressed={recording}
              disabled={recordStatus === 'starting' || recordStatus === 'stopping'}
              onClick={props.onToggleRecord}
            >
              {recording ? <VscDebugStop /> : <VscRecord />}
            </ControlButton>
          </>
        )}
        {show.pip && (
          <ControlButton
            tooltip={props.pipActive ? '退出画中画（P）' : '画中画（P）'}
            renderTooltip={renderTooltip}
            className={styles.optional}
            active={props.pipActive}
            aria-label={props.pipActive ? '退出画中画' : '画中画'}
            aria-pressed={props.pipActive}
            onClick={props.onTogglePip}
          >
            <VscMultipleWindows />
          </ControlButton>
        )}
        {show.settings && (
          <SettingsMenu
            qualityOptions={show.quality ? props.qualityOptions : []}
            quality={props.quality}
            onQuality={props.onQuality}
            showSpeed={show.speed}
            rate={props.rate}
            onRate={props.onRate}
            captions={show.captions ? props.captions : []}
            captionIndex={props.captionIndex}
            onCaption={props.onCaption}
            renderTooltip={renderTooltip}
            onOpenChange={props.onMenuOpenChange}
          />
        )}
        {show.fullscreen && (
          <ControlButton
            tooltip={props.fullscreen ? '退出全屏（F）' : '全屏（F）'}
            renderTooltip={renderTooltip}
            aria-label={props.fullscreen ? '退出全屏' : '全屏'}
            onClick={props.onToggleFullscreen}
          >
            {props.fullscreen ? <VscScreenNormal /> : <VscScreenFull />}
          </ControlButton>
        )}
      </div>
    </div>
  );
};

export default ControlBar;
