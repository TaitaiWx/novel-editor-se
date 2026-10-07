/**
 * 自绘视频播放器（不使用原生 controls）：
 * - 无黑边：读到元数据后容器按视频宽高比贴合；预加载元数据并停在第一帧附近作为封面（有 poster 时用 poster）
 * - 可插拔的播放引擎：mp4 / webm / mov 原生播放，HLS 用 hls.js、FLV / MPEG-TS 用 mpegts.js（用到时才加载）
 * - 清晰度切换（多地址或 HLS 档位 + 自动）、播放速度、字幕、画中画、截图、录制、循环、全屏
 * - 控制条只在暂停、悬停、键盘聚焦、菜单打开时浮现；提示与菜单渲染在播放器内部，全屏时同样可见
 * - 声音：用户发起的播放默认有声；只有自动播放的预览（compact / autoPlay）静音起播，并显示「开启声音」；
 *   确定没有音轨时静音按钮显示「无音轨」
 * - compact：静音自动循环播放，没有控制条（小卡片）
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { VscPlay, VscUnmute } from 'react-icons/vsc';
import { clampVolume, nextAudioTrackState, playedSeconds, type AudioTrackState } from './audio';

export type { VideoMetadata, VideoPlayerHandle, VideoPlayerProps } from './playerTypes';
import ControlBar, { resolveControls } from './ControlBar';
import type { VideoPlayerHandle, VideoPlayerProps } from './playerTypes';
import { PlayerTooltipContext, type TooltipContext } from './ControlButton';
import { ErrorOverlay, LoadingOverlay, NoticeOverlay, RecordingBadge } from './Overlays';
import { SEEK_STEP_SECONDS, timeRangesToArray } from './ProgressBar';
import { useFullscreen, useNotice, usePictureInPicture, useRecording } from './hooks';
import { PlayerError, safePlay, toPlayerError } from './engines/types';
import { keyAction, stepPlaybackRate, type PlayerKeyAction } from './keyboard';
import { clampTime, frameWidth } from './format';
import { captureFrame, downloadBlob } from './screenshot';
import { supportsScreenshot } from './features';
import { useMediaEngine } from './useMediaEngine';
import { mediaErrorMessage, useCaptions } from './captions';
import styles from './styles.module.scss';

const DEFAULT_RATIO = 16 / 9;
const IDLE_HIDE_MS = 2200;
const VOLUME_STEP = 0.1;
/** 不自动播放时停在这里作为封面（0 秒有时不绘制画面） */
const POSTER_TIME = 0.1;

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer(
  {
    src,
    title,
    variant = 'full',
    autoPlay = false,
    defaultMuted = false,
    defaultLoop = false,
    defaultVolume = 1,
    defaultPlaybackRate = 1,
    showLoopToggle = false,
    showTitle = true,
    controls,
    poster,
    startTime,
    crossOrigin,
    tracks,
    engines,
    maxRecordingSeconds = 600,
    screenshotType,
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
    onScreenshot,
    onRecording,
    onError,
    onTimeUpdate,
    onEnded,
    onQualityChange,
  },
  ref
) {
  const compact = variant === 'compact';
  const shouldAutoPlay = compact || autoPlay;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef(false);
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const [paused, setPaused] = useState(true);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState<Array<[number, number]>>([]);
  const [muted, setMuted] = useState(shouldAutoPlay || defaultMuted);
  // 只因自动播放而静音：用户第一次主动播放或点「开启声音」时恢复声音
  const [autoMuted, setAutoMuted] = useState(shouldAutoPlay);
  const [volume, setVolume] = useState(() => clampVolume(defaultVolume));
  const [rate, setRate] = useState(defaultPlaybackRate);
  const [audio, setAudio] = useState<AudioTrackState>('unknown');
  const [loop, setLoop] = useState(compact || defaultLoop);
  const [ratio, setRatio] = useState<number | null>(null);
  const [active, setActive] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<PlayerError | null>(null);
  const { notice, showNotice } = useNotice();
  const [canScreenshot, setCanScreenshot] = useState(false);

  // 回调总是读最新的属性，不进依赖数组
  const latest = { onLayoutChange, onMetadata, onAudioTrack, onScreenshot, onRecording, onError };
  const callbacks = useRef({ ...latest, onTimeUpdate, onEnded, onQualityChange });
  callbacks.current = { ...latest, onTimeUpdate, onEnded, onQualityChange };

  const setRoot = useCallback((node: HTMLDivElement | null) => {
    rootRef.current = node;
    setRootEl(node);
  }, []);

  const reportError = useCallback((next: PlayerError) => {
    setError(next);
    setLoading(false);
    callbacks.current.onError?.(next);
  }, []);

  const engine = useMediaEngine({
    videoRef,
    src,
    engines,
    onError: reportError,
    onAttached: () => {
      const video = videoRef.current;
      if (video) video.playbackRate = rate;
    },
  });
  const { sourceKey, setQuality: setEngineQuality, reload, takeResume } = engine;

  const fullscreenState = useFullscreen(rootRef, videoRef, () =>
    callbacks.current.onLayoutChange?.()
  );
  const pip = usePictureInPicture(videoRef, sourceKey);
  const captions = useCaptions(videoRef, tracks);
  const recording = useRecording(videoRef, {
    baseName: title,
    maxDurationSeconds: maxRecordingSeconds,
    onResult: ({ blob, meta }) => {
      const handler = callbacks.current.onRecording;
      Promise.resolve(handler ? handler(blob, meta) : downloadBlob(blob, meta.fileName)).then(
        (handled) => {
          if (handled !== false) showNotice(`录制完成 ${Math.round(meta.duration)} 秒`);
        },
        (failure: unknown) => showNotice(toPlayerError(failure, '保存录制失败').message, 'error')
      );
    },
    onError: (failure) => {
      showNotice(failure.message, 'error');
      callbacks.current.onError?.(failure);
    },
  });

  const { start: startRecording, stop: stopRecording } = recording;

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);
  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume]);
  useEffect(() => {
    if (videoRef.current) videoRef.current.loop = loop;
  }, [loop]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = rate;
    video.defaultPlaybackRate = rate;
  }, [rate]);
  useEffect(() => {
    setCanScreenshot(supportsScreenshot());
  }, []);
  // 换片时重置
  useEffect(() => {
    setCurrent(0);
    setDuration(0);
    setBuffered([]);
    setRatio(null);
    setAudio('unknown');
    setError(null);
    setLoading(false);
    startedRef.current = false;
  }, [sourceKey]);
  useEffect(() => {
    if (audio !== 'unknown') callbacks.current.onAudioTrack?.(audio);
  }, [audio]);

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
      void safePlay(video);
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

  const changeQuality = useCallback(
    (id: string) => {
      setEngineQuality(id);
      callbacks.current.onQualityChange?.(id);
    },
    [setEngineQuality]
  );

  /** 截取当前画面（ref API 直接返回 Blob，不触发回调 / 下载） */
  const captureCurrent = useCallback(async () => {
    const video = videoRef.current;
    if (!video) throw new PlayerError('not-ready', '视频还没有加载');
    return captureFrame(video, { mimeType: screenshotType, baseName: title });
  }, [screenshotType, title]);

  /** 按钮 / 快捷键：截图 → 交给 onScreenshot（默认下载）→ 提示；回调返回 false（例如取消保存）时不提示 */
  const screenshotWithNotice = useCallback(() => {
    captureCurrent()
      .then(async ({ blob, meta }) => {
        const handler = callbacks.current.onScreenshot;
        return handler ? handler(blob, meta) : downloadBlob(blob, meta.fileName);
      })
      .then(
        (handled) => {
          if (handled !== false) showNotice('已截图');
        },
        (failure: unknown) => {
          const playerError = toPlayerError(failure, '截图失败');
          showNotice(playerError.message, 'error');
          callbacks.current.onError?.(playerError);
        }
      );
  }, [captureCurrent, showNotice]);

  const toggleRecord = useCallback(() => {
    if (recording.status === 'recording') void recording.stop();
    else if (recording.status === 'idle') {
      if (autoMuted && !compact) enableSound();
      void recording.start();
    }
  }, [recording, autoMuted, compact, enableSound]);

  const togglePip = useCallback(() => {
    pip.toggle().catch((failure: unknown) => {
      showNotice(toPlayerError(failure, '无法进入画中画').message, 'error');
    });
  }, [pip, showNotice]);

  const retry = useCallback(() => {
    setError(null);
    reload();
  }, [reload]);

  useImperativeHandle(
    ref,
    () => ({
      get video() {
        return videoRef.current;
      },
      play: async () => {
        if (videoRef.current) await safePlay(videoRef.current);
      },
      pause: () => videoRef.current?.pause(),
      seek,
      setPlaybackRate: (next: number) => setRate(next),
      setQuality: changeQuality,
      screenshot: async () => (await captureCurrent()).blob,
      startRecording: startRecording,
      stopRecording: async () => (await stopRecording())?.blob ?? null,
      toggleFullscreen: fullscreenState.toggle,
    }),
    [seek, changeQuality, captureCurrent, startRecording, stopRecording, fullscreenState.toggle]
  );

  const wake = () => {
    setActive(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setActive(false), IDLE_HIDE_MS);
  };

  const hasSound = audio !== 'absent';
  const show = resolveControls(controls, showLoopToggle, {
    screenshot: canScreenshot,
    record: recording.supported,
    pip: pip.supported,
    fullscreen: fullscreenState.supported,
  });

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (compact) return;
    const action = keyAction({
      key: event.key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      onButton: (event.target as HTMLElement).tagName === 'BUTTON',
    });
    if (!action) return;
    const step = (direction: 1 | -1) => {
      if (!show.speed) return false;
      const next = stepPlaybackRate(rate, direction);
      setRate(next);
      showNotice(`播放速度 ${next}x`);
    };
    const handlers: Record<PlayerKeyAction, () => boolean | void> = {
      'toggle-play': togglePlay,
      'seek-back': () => seek(current - SEEK_STEP_SECONDS),
      'seek-forward': () => seek(current + SEEK_STEP_SECONDS),
      'volume-up': () => hasSound && changeVolume((muted ? 0 : volume) + VOLUME_STEP),
      'volume-down': () => hasSound && changeVolume((muted ? 0 : volume) - VOLUME_STEP),
      'toggle-mute': () => hasSound && toggleMute(),
      'toggle-fullscreen': () => show.fullscreen && fullscreenState.toggle(),
      screenshot: () => show.screenshot && screenshotWithNotice(),
      'toggle-record': () => show.record && toggleRecord(),
      'speed-down': () => step(-1),
      'speed-up': () => step(1),
      'toggle-captions': () => show.captions && captions.options.length > 0 && captions.toggle(),
      'toggle-pip': () => show.pip && togglePip(),
    };
    // 返回 false 表示当前不可用：不拦截按键
    if (handlers[action]() === false) return;
    event.preventDefault();
    event.stopPropagation();
    wake();
  };

  const tooltipContext = useMemo<TooltipContext>(
    () => ({
      container: fullscreenState.fullscreen ? rootEl : null,
      fullscreen: fullscreenState.fullscreen,
    }),
    [fullscreenState.fullscreen, rootEl]
  );

  const effectiveRatio = ratio ?? DEFAULT_RATIO;
  const isRecording = recording.status === 'recording' || recording.status === 'stopping';
  const showControls = !compact && (paused || active || dragging || menuOpen);
  const showUnmute = autoMuted && muted && hasSound;
  const rootClass = [
    styles.player,
    compact ? styles.compact : '',
    showControls ? styles.controlsVisible : '',
    ratio || poster ? '' : styles.pending,
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <PlayerTooltipContext.Provider value={tooltipContext}>
      <div
        ref={setRoot}
        className={rootClass}
        role="group"
        aria-label={`视频 ${title}`}
        tabIndex={compact ? -1 : 0}
        data-paused={paused ? 'true' : 'false'}
        data-muted={muted ? 'true' : 'false'}
        data-audio={audio}
        data-aspect={ratio ? Number(ratio.toFixed(4)) : undefined}
        data-engine={engine.engineKind ?? undefined}
        data-fullscreen={fullscreenState.fullscreen ? 'true' : undefined}
        data-recording={isRecording ? 'true' : undefined}
        style={
          fullscreenState.fullscreen
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
          preload="metadata"
          playsInline
          poster={poster}
          crossOrigin={crossOrigin}
          autoPlay={shouldAutoPlay}
          muted={muted}
          loop={loop}
          onPlay={() => setPaused(false)}
          onPause={() => {
            setPaused(true);
            setLoading(false);
          }}
          onPlaying={() => setLoading(false)}
          onWaiting={() => setLoading(true)}
          onStalled={(event) => {
            if (!event.currentTarget.paused) setLoading(true);
          }}
          onCanPlay={() => setLoading(false)}
          onSeeked={() => setLoading(false)}
          onProgress={(event) => setBuffered(timeRangesToArray(event.currentTarget.buffered))}
          onError={(event) => {
            const mediaError = event.currentTarget.error;
            if (!mediaError) return;
            reportError(mediaErrorMessage(mediaError.code));
          }}
          onEnded={(event) => {
            setPaused(true);
            probeAudio(event.currentTarget);
            callbacks.current.onEnded?.();
          }}
          onTimeUpdate={(event) => {
            const video = event.currentTarget;
            setCurrent(video.currentTime);
            probeAudio(video);
            callbacks.current.onTimeUpdate?.(video.currentTime, video.duration);
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
            setError(null);
            if (videoWidth > 0 && videoHeight > 0) setRatio(videoWidth / videoHeight);
            probeAudio(video);
            video.playbackRate = rate;
            const resume = takeResume();
            if (resume) {
              // 换清晰度 / 重试：回到原来的位置与播放状态
              video.currentTime = clampTime(resume.time, video.duration);
              if (resume.playing) void safePlay(video);
            } else if (!startedRef.current && startTime && startTime > 0) {
              video.currentTime = clampTime(startTime, video.duration);
            } else if (
              // 不自动播放时停在第一帧附近，当作封面
              !poster &&
              !shouldAutoPlay &&
              video.currentTime === 0 &&
              video.duration > POSTER_TIME * 2
            ) {
              video.currentTime = POSTER_TIME;
            }
            startedRef.current = true;
            callbacks.current.onMetadata?.({
              width: videoWidth,
              height: videoHeight,
              duration: video.duration,
            });
            callbacks.current.onLayoutChange?.();
          }}
        >
          {tracks?.map((track, index) => (
            <track
              key={`${track.src}-${index}`}
              kind={track.kind ?? 'subtitles'}
              src={track.src}
              srcLang={track.srclang}
              label={track.label}
              default={track.default}
            />
          ))}
        </video>
        <div
          className={styles.surface}
          onClick={togglePlay}
          onDoubleClick={compact || !show.fullscreen ? undefined : fullscreenState.toggle}
          aria-hidden="true"
        >
          {!compact && paused && !error && (
            <span className={styles.bigPlay}>
              <VscPlay />
            </span>
          )}
        </div>
        {loading && !error && !paused && <LoadingOverlay />}
        {error && <ErrorOverlay message={error.message} onRetry={retry} />}
        {notice && <NoticeOverlay message={notice.message} tone={notice.tone} />}
        {isRecording && <RecordingBadge elapsed={recording.elapsed} />}
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
          <ControlBar
            show={show}
            renderTooltip={renderTooltip}
            paused={paused}
            onTogglePlay={togglePlay}
            current={current}
            duration={duration}
            buffered={buffered}
            onSeek={seek}
            onDragChange={setDragging}
            muted={muted}
            volume={volume}
            audio={audio}
            onToggleMute={toggleMute}
            onVolume={changeVolume}
            loop={loop}
            onToggleLoop={() => setLoop((value) => !value)}
            onScreenshot={screenshotWithNotice}
            recordStatus={recording.status}
            recordElapsed={recording.elapsed}
            onToggleRecord={toggleRecord}
            pipActive={pip.active}
            onTogglePip={togglePip}
            fullscreen={fullscreenState.fullscreen}
            onToggleFullscreen={fullscreenState.toggle}
            qualityOptions={engine.qualityOptions}
            quality={engine.quality}
            onQuality={changeQuality}
            rate={rate}
            onRate={setRate}
            captions={captions.options}
            captionIndex={captions.index}
            onCaption={captions.select}
            onMenuOpenChange={setMenuOpen}
          />
        )}
      </div>
    </PlayerTooltipContext.Provider>
  );
});

export default VideoPlayer;
