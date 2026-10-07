/**
 * 播放器的公开类型：属性、通过 ref 控制的接口、元数据。
 */
import type React from 'react';
import type { AudioTrackState } from './audio';
import type { PlayerControls } from './ControlBar';
import type { RenderTooltip } from './ControlButton';
import type { PlayerTrack } from './captions';
import type { RecordingMeta } from './recorder';
import type { ScreenshotMeta } from './screenshot';
import type { MediaEngineFactory, PlayerError, PlayerSource } from './engines/types';

export interface VideoMetadata {
  width: number;
  height: number;
  duration: number;
}

export interface VideoPlayerProps {
  /** 视频地址，或带格式 / 多清晰度的播放源描述 */
  src: string | PlayerSource;
  /** 视频名称：用于 aria-label「视频 X」、悬停时左上角的标题与截图 / 录制的文件名 */
  title: string;
  variant?: 'full' | 'compact';
  /** 自动播放（静音起播，并显示「开启声音」按钮） */
  autoPlay?: boolean;
  /** 不自动播放时是否默认静音（自动播放总是静音起播） */
  defaultMuted?: boolean;
  defaultLoop?: boolean;
  /** 初始音量 0–1，默认 1 */
  defaultVolume?: number;
  /** 初始播放速度，默认 1 */
  defaultPlaybackRate?: number;
  /** 控制条里显示「循环播放」开关（等同 controls.loop） */
  showLoopToggle?: boolean;
  /** 悬停时在左上角显示标题 */
  showTitle?: boolean;
  /** 隐藏某些控制项，例如 `{ screenshot: false, record: false }` */
  controls?: PlayerControls;
  /** 封面图（不传时停在第一帧附近作为封面） */
  poster?: string;
  /** 从第几秒开始播放 */
  startTime?: number;
  /** 跨域视频需要截图 / 录制时设为 'anonymous'（服务器需返回 CORS 头） */
  crossOrigin?: '' | 'anonymous' | 'use-credentials';
  /** 字幕（WebVTT） */
  tracks?: PlayerTrack[];
  /** 替换默认引擎（hls.js → mpegts.js → 原生），例如追加 dash.js */
  engines?: readonly MediaEngineFactory[];
  /** 最长录制时长（秒），默认 600 */
  maxRecordingSeconds?: number;
  /** 截图格式，默认 PNG */
  screenshotType?: 'image/png' | 'image/jpeg' | 'image/webp';
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
  /** 截图完成；不传时直接下载。返回 Promise 时等待其完成再提示；返回 false 表示未保存（不提示） */
  onScreenshot?: (blob: Blob, meta: ScreenshotMeta) => void | boolean | Promise<void | boolean>;
  /** 录制完成；不传时直接下载；返回 false 表示未保存（不提示） */
  onRecording?: (blob: Blob, meta: RecordingMeta) => void | boolean | Promise<void | boolean>;
  onError?: (error: PlayerError) => void;
  onTimeUpdate?: (current: number, duration: number) => void;
  onEnded?: () => void;
  onQualityChange?: (id: string) => void;
}

/** 通过 ref 控制播放器 */
export interface VideoPlayerHandle {
  readonly video: HTMLVideoElement | null;
  play(): Promise<void>;
  pause(): void;
  seek(time: number): void;
  setPlaybackRate(rate: number): void;
  setQuality(id: string): void;
  /** 截取当前画面（只返回 Blob，不触发 onScreenshot / 下载） */
  screenshot(): Promise<Blob>;
  startRecording(): Promise<boolean>;
  stopRecording(): Promise<Blob | null>;
  toggleFullscreen(): void;
}
