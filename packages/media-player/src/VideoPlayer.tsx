/**
 * 自绘视频播放器（不使用原生 controls，不依赖第三方播放器）：
 * - 无黑边：读到元数据后容器按视频宽高比贴合；预加载元数据并停在第一帧附近作为封面
 * - 暂停时居中显示柔和的大播放图标；控制条只在暂停、悬停、键盘聚焦时浮现（底部渐变）
 * - 播放 / 暂停、可拖动的细进度条（← / → 5 秒）、时间、静音 + 悬停音量、循环（可选）、全屏、额外操作插槽
 * - 聚焦时 Space / K 播放暂停，← / → 快退快进，↑ / ↓ 音量，M 静音，F 全屏
 * - 声音：用户发起的播放默认有声；只有自动播放的预览（compact / autoPlay）静音起播，并显示明显的
 *   「开启声音」按钮；确定没有音轨时静音按钮显示「无音轨」
 * - compact：静音自动循环播放，没有控制条（小卡片）
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  VscDebugPause,
  VscPlay,
  VscScreenFull,
  VscScreenNormal,
  VscSync,
  VscUnmute,
} from 'react-icons/vsc';
import { clampVolume, nextAudioTrackState, playedSeconds, type AudioTrackState } from './audio';
import ControlButton, { type RenderTooltip } from './ControlButton';
import ProgressBar, { SEEK_STEP_SECONDS } from './ProgressBar';
import VolumeControl from './VolumeControl';
import { clampTime, formatTime, frameWidth } from './format';
import styles from './styles.module.scss';

export interface VideoMetadata {
  width: number;
  height: number;
  duration: number;
}

export interface VideoPlayerProps {
  src: string;
  /** 视频名称：用于 aria-label「视频 X」与悬停时左上角的标题 */
  title: string;
  variant?: 'full' | 'compact';
  /** 自动播放（静音起播，并显示「开启声音」按钮） */
  autoPlay?: boolean;
  /** 不自动播放时是否默认静音（自动播放总是静音起播） */
  defaultMuted?: boolean;
  defaultLoop?: boolean;
  /** 初始音量 0–1，默认 1 */
  defaultVolume?: number;
  /** 控制条里显示「循环播放」开关 */
  showLoopToggle?: boolean;
  /** 悬停时在左上角显示标题 */
  showTitle?: boolean;
  /** 额外操作（右上角，与控制条一起浮现），例如「在旁边看」 */
  actions?: React.ReactNode;
  /** 最大宽度（px） */
  maxWidth?: number;
  /** 最大高度（数字为 px，字符串为 CSS 长度，例如 '60vh'）；宽度按比例收窄 */
  maxHeight?: number | string;
  className?: string;
  /** 内部 video 元素的类名 / 测试标识 */
  videoClassName?: string;
  videoTestId?: string;
  /** 自定义控制按钮的提示（默认用原生 title） */
  renderTooltip?: RenderTooltip;
  onMetadata?: (info: VideoMetadata) => void;
  /** 判断出有没有音轨时回调（只回调一次确定值） */
  onAudioTrack?: (state: Exclude<AudioTrackState, 'unknown'>) => void;
  /** 尺寸可能变化（读到元数据、进出全屏）时回调，例如让 CodeMirror 重新测量 */
  onLayoutChange?: () => void;
}

const DEFAULT_RATIO = 16 / 9;
const IDLE_HIDE_MS = 2200;
const VOLUME_STEP = 0.1;
/** 不自动播放时停在这里作为封面（0 秒有时不绘制画面） */
const POSTER_TIME = 0.1;

function safePlay(video: HTMLVideoElement) {
  const result = video.play() as Promise<void> | undefined;
  if (result && typeof result.catch === 'function') result.catch(() => undefined);
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({
  src,
  title,
  variant = 'full',
  autoPlay = false,
  defaultMuted = false,
  defaultLoop = false,
  defaultVolume = 1,
  showLoopToggle = false,
  showTitle = true,
  actions,
  maxWidth,
  maxHeight,
  className,
  videoClassName,
  videoTestId,
  renderTooltip,
  onMetadata,
  onAudioTrack,
  onLayoutChange,
}) => {
  const compact = variant === 'compact';
  const shouldAutoPlay = compact || autoPlay;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [paused, setPaused] = useState(true);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(shouldAutoPlay || defaultMuted);
  // 只因自动播放而静音：用户第一次主动播放或点「开启声音」时恢复声音
  const [autoMuted, setAutoMuted] = useState(shouldAutoPlay);
  const [volume, setVolume] = useState(() => clampVolume(defaultVolume));
  const [audio, setAudio] = useState<AudioTrackState>('unknown');
  const [loop, setLoop] = useState(compact || defaultLoop);
  const [ratio, setRatio] = useState<number | null>(null);
  const [active, setActive] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const layoutRef = useRef(onLayoutChange);
  layoutRef.current = onLayoutChange;
  const metadataRef = useRef(onMetadata);
  metadataRef.current = onMetadata;
  const audioTrackRef = useRef(onAudioTrack);
  audioTrackRef.current = onAudioTrack;

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);
  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume]);
  useEffect(() => {
    if (videoRef.current) videoRef.current.loop = loop;
  }, [loop]);
  // 换片时重置
  useEffect(() => {
    setCurrent(0);
    setDuration(0);
    setRatio(null);
    setAudio('unknown');
  }, [src]);
  useEffect(() => {
    if (audio !== 'unknown') audioTrackRef.current?.(audio);
  }, [audio]);

  useEffect(() => {
    const onChange = () => {
      const isFull = !!rootRef.current && document.fullscreenElement === rootRef.current;
      setFullscreen(isFull);
      layoutRef.current?.();
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(
    () => () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    },
    []
  );

  const probeAudio = (video: HTMLVideoElement) => {
    setAudio((previous) => nextAudioTrackState(previous, video, playedSeconds(video.played)));
  };

  const enableSound = useCallback(() => {
    setAutoMuted(false);
    setMuted(false);
    setVolume((value) => (value > 0 ? value : 1));
  }, []);

  /** 用户发起的播放 / 暂停：从自动播放的静音状态开始播放时恢复声音 */
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) {
      if (autoMuted && !compact) enableSound();
      safePlay(video);
    } else {
      video.pause();
    }
  }, [autoMuted, compact, enableSound]);

  const toggleMute = useCallback(() => {
    setAutoMuted(false);
    if (muted && volume === 0) setVolume(1);
    setMuted(!muted);
  }, [muted, volume]);

  const changeVolume = useCallback((next: number) => {
    const value = clampVolume(next);
    setAutoMuted(false);
    setVolume(value);
    setMuted(value === 0);
  }, []);

  const seek = useCallback(
    (time: number) => {
      const video = videoRef.current;
      if (!video) return;
      const next = clampTime(time, duration || video.duration);
      video.currentTime = next;
      setCurrent(next);
    },
    [duration]
  );

  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    if (document.fullscreenElement === root) {
      void document.exitFullscreen?.().catch(() => undefined);
    } else {
      void root.requestFullscreen?.().catch(() => undefined);
    }
  }, []);

  const wake = () => {
    setActive(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setActive(false), IDLE_HIDE_MS);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (compact || event.metaKey || event.ctrlKey || event.altKey) return;
    const onButton = (event.target as HTMLElement).tagName === 'BUTTON';
    const key = event.key.toLowerCase();
    const hasSound = audio !== 'absent';
    if ((key === ' ' && !onButton) || key === 'k') togglePlay();
    else if (key === 'arrowleft') seek(current - SEEK_STEP_SECONDS);
    else if (key === 'arrowright') seek(current + SEEK_STEP_SECONDS);
    else if (key === 'arrowup' && hasSound) changeVolume((muted ? 0 : volume) + VOLUME_STEP);
    else if (key === 'arrowdown' && hasSound) changeVolume((muted ? 0 : volume) - VOLUME_STEP);
    else if (key === 'm' && hasSound) toggleMute();
    else if (key === 'f') toggleFullscreen();
    else return;
    event.preventDefault();
    event.stopPropagation();
    wake();
  };

  const effectiveRatio = ratio ?? DEFAULT_RATIO;
  const showControls = !compact && (paused || active || dragging);
  const showUnmute = autoMuted && muted && audio !== 'absent';
  const rootClass = [
    styles.player,
    compact ? styles.compact : '',
    showControls ? styles.controlsVisible : '',
    ratio ? '' : styles.pending,
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={rootRef}
      className={rootClass}
      role="group"
      aria-label={`视频 ${title}`}
      tabIndex={compact ? -1 : 0}
      data-paused={paused ? 'true' : 'false'}
      data-muted={muted ? 'true' : 'false'}
      data-audio={audio}
      data-aspect={ratio ? Number(ratio.toFixed(4)) : undefined}
      style={
        fullscreen
          ? undefined
          : {
              aspectRatio: String(effectiveRatio),
              width: frameWidth(effectiveRatio, maxWidth, maxHeight),
            }
      }
      onKeyDown={onKeyDown}
      onPointerMove={compact ? undefined : wake}
      onPointerLeave={() => setActive(false)}
    >
      <video
        ref={videoRef}
        className={[styles.video, videoClassName ?? ''].filter(Boolean).join(' ')}
        data-testid={videoTestId}
        src={src}
        preload="metadata"
        playsInline
        autoPlay={shouldAutoPlay}
        muted={muted}
        loop={loop}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onEnded={(event) => {
          setPaused(true);
          probeAudio(event.currentTarget);
        }}
        onTimeUpdate={(event) => {
          setCurrent(event.currentTarget.currentTime);
          probeAudio(event.currentTarget);
        }}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onVolumeChange={(event) => {
          setMuted(event.currentTarget.muted);
          setVolume(clampVolume(event.currentTarget.volume));
        }}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          const { videoWidth, videoHeight } = video;
          setDuration(video.duration);
          if (videoWidth > 0 && videoHeight > 0) setRatio(videoWidth / videoHeight);
          probeAudio(video);
          // 不自动播放时停在第一帧附近，当作封面
          if (!shouldAutoPlay && video.currentTime === 0 && video.duration > POSTER_TIME * 2) {
            video.currentTime = POSTER_TIME;
          }
          metadataRef.current?.({
            width: videoWidth,
            height: videoHeight,
            duration: video.duration,
          });
          layoutRef.current?.();
        }}
      />
      <div
        className={styles.surface}
        onClick={togglePlay}
        onDoubleClick={compact ? undefined : toggleFullscreen}
        aria-hidden="true"
      >
        {!compact && paused && (
          <span className={styles.bigPlay}>
            <VscPlay />
          </span>
        )}
      </div>
      {showUnmute && (
        <button
          type="button"
          className={compact ? `${styles.unmute} ${styles.unmuteCompact}` : styles.unmute}
          aria-label="开启声音"
          title={compact ? '开启声音' : undefined}
          onClick={(event) => {
            event.stopPropagation();
            enableSound();
          }}
        >
          <VscUnmute />
          {!compact && <span>开启声音</span>}
        </button>
      )}
      {!compact && (showTitle || actions) && (
        <div className={styles.top}>
          {showTitle ? (
            <span className={styles.title} title={title}>
              {title}
            </span>
          ) : (
            <span />
          )}
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
      )}
      {!compact && (
        <div className={styles.controls}>
          <ProgressBar
            current={current}
            duration={duration}
            onSeek={seek}
            onDragChange={setDragging}
          />
          <div className={styles.bar}>
            <ControlButton
              tooltip={paused ? '播放（空格）' : '暂停（空格）'}
              renderTooltip={renderTooltip}
              aria-label={paused ? '播放' : '暂停'}
              onClick={togglePlay}
            >
              {paused ? <VscPlay /> : <VscDebugPause />}
            </ControlButton>
            <VolumeControl
              muted={muted}
              volume={volume}
              audio={audio}
              onToggleMute={toggleMute}
              onVolume={changeVolume}
              renderTooltip={renderTooltip}
            />
            <span className={styles.time} data-testid="video-time">
              {formatTime(current)} / {formatTime(duration)}
            </span>
            <span className={styles.spacer} />
            {showLoopToggle && (
              <ControlButton
                tooltip={loop ? '关闭循环' : '循环播放'}
                renderTooltip={renderTooltip}
                active={loop}
                aria-label="循环播放"
                aria-pressed={loop}
                onClick={() => setLoop((value) => !value)}
              >
                <VscSync />
              </ControlButton>
            )}
            <ControlButton
              tooltip={fullscreen ? '退出全屏（F）' : '全屏（F）'}
              renderTooltip={renderTooltip}
              aria-label={fullscreen ? '退出全屏' : '全屏'}
              onClick={toggleFullscreen}
            >
              {fullscreen ? <VscScreenNormal /> : <VscScreenFull />}
            </ControlButton>
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoPlayer;
