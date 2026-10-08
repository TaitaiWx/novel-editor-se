/**
 * <video> 元素的事件 → 播放器状态（从 MediaPlayer.tsx 拆出）。音频、视频共用同一个 <video> 元素与这一套处理：
 * 播放 / 暂停、加载中、缓冲、进度、时长、音量、错误、播完（A-B 循环 / 播放列表自动下一首）、读到元数据（有没有画面）。
 */
import type React from 'react';
import { clampVolume } from './audio';
import type { AbRange } from './abRepeat';
import { abActive } from './abRepeat';
import { mediaErrorMessage } from './captions';
import { timeRangesToArray } from './ProgressBar';
import { safePlay, type PlayerError } from './engines/types';
import type { VideoMetadata } from './playerTypes';

type Setter<T> = (value: T) => void;
type VideoEvent = React.SyntheticEvent<HTMLVideoElement>;

export interface MediaEventCallbacks {
  onEnded?: () => void;
  onTimeUpdate?: (current: number, duration: number) => void;
  onMetadata?: (info: VideoMetadata) => void;
  onLayoutChange?: () => void;
}

export interface MediaEventContext {
  setPaused: Setter<boolean>;
  setLoading: Setter<boolean>;
  setBuffered: Setter<Array<[number, number]>>;
  setCurrent: Setter<number>;
  setDuration: Setter<number>;
  setMuted: Setter<boolean>;
  setVolume: Setter<number>;
  setError: Setter<PlayerError | null>;
  setHasPicture: Setter<boolean | null>;
  setRatio: Setter<number | null>;
  probeAudio: (video: HTMLVideoElement) => void;
  reportError: (error: PlayerError) => void;
  /** 错误文案用的格式（音频界面为 audio） */
  errorType: string;
  ab: { range: AbRange; check: () => void };
  callbacks: React.RefObject<MediaEventCallbacks>;
  /** 正常播完（没有 A-B 循环）之后：播放列表自动下一首 */
  onTrackEnded: () => void;
  /** 读到元数据、状态更新之后：恢复位置 / 起始时间 / 封面帧 / 自动播放 */
  onMetadataReady: (video: HTMLVideoElement, picture: boolean) => void;
}

export function mediaEventHandlers(ctx: MediaEventContext) {
  const { setPaused, setLoading, probeAudio, ab, callbacks } = ctx;
  return {
    onPlay: () => setPaused(false),
    onPause: () => {
      setPaused(true);
      setLoading(false);
    },
    onPlaying: () => setLoading(false),
    onWaiting: () => setLoading(true),
    onStalled: (event: VideoEvent) => {
      if (!event.currentTarget.paused) setLoading(true);
    },
    onCanPlay: () => setLoading(false),
    onSeeked: () => setLoading(false),
    onProgress: (event: VideoEvent) =>
      ctx.setBuffered(timeRangesToArray(event.currentTarget.buffered)),
    onError: (event: VideoEvent) => {
      const mediaError = event.currentTarget.error;
      if (!mediaError) return;
      ctx.reportError(mediaErrorMessage(mediaError.code, ctx.errorType));
    },
    onEnded: (event: VideoEvent) => {
      const video = event.currentTarget;
      probeAudio(video);
      // A-B 的 B 点在结尾：回到 A 点继续
      if (abActive(ab.range)) {
        ab.check();
        void safePlay(video);
        return;
      }
      setPaused(true);
      callbacks.current?.onEnded?.();
      ctx.onTrackEnded();
    },
    onTimeUpdate: (event: VideoEvent) => {
      const video = event.currentTarget;
      ab.check();
      ctx.setCurrent(video.currentTime);
      probeAudio(video);
      callbacks.current?.onTimeUpdate?.(video.currentTime, video.duration);
    },
    onDurationChange: (event: VideoEvent) => ctx.setDuration(event.currentTarget.duration),
    onVolumeChange: (event: VideoEvent) => {
      ctx.setMuted(event.currentTarget.muted);
      ctx.setVolume(clampVolume(event.currentTarget.volume));
    },
    onLoadedMetadata: (event: VideoEvent) => {
      const video = event.currentTarget;
      const { videoWidth, videoHeight } = video;
      ctx.setDuration(video.duration);
      ctx.setError(null);
      const picture = videoWidth > 0 && videoHeight > 0;
      ctx.setHasPicture(picture);
      if (picture) ctx.setRatio(videoWidth / videoHeight);
      probeAudio(video);
      ctx.onMetadataReady(video, picture);
      callbacks.current?.onMetadata?.({
        width: videoWidth,
        height: videoHeight,
        duration: video.duration,
      });
      callbacks.current?.onLayoutChange?.();
    },
  };
}
