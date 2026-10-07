// 改编自 video-maker/packages/video-core/src/types.ts（同一作者的项目），删去 WebGPU / 叠加轨（声音见 audio-*.ts）
/**
 * 样片（animatic）拼接的数据类型：一条主视频轨（片段可以是静态图或视频源）+ 可选的混音音轨。
 */
import type { AudioCodecPreset } from './audio-codecs';

/** 能直接绘制到 canvas 的图像对象 */
export type FrameSource =
  | ImageBitmap
  | HTMLImageElement
  | HTMLCanvasElement
  | OffscreenCanvas
  | VideoFrame;

/**
 * 视频片段源：渲染某一帧前先 await ensureFrameAt，再同步 getFrameAt 取帧。
 * localMs 为片段内的本地时间（毫秒）。
 */
export interface VideoClipSource {
  readonly durationMs: number;
  getFrameAt(localMs: number): FrameSource | null;
  ensureFrameAt(localMs: number): Promise<void>;
}

/** 片段源：静态图像或视频源 */
export type ClipSource = FrameSource | VideoClipSource;

export function isVideoClipSource(source: ClipSource): source is VideoClipSource {
  return (
    typeof (source as Partial<VideoClipSource>).getFrameAt === 'function' &&
    typeof (source as Partial<VideoClipSource>).ensureFrameAt === 'function'
  );
}

export type FitMode = 'cover' | 'contain';
export type TransitionType = 'crossfade' | 'fade';

export interface TimelineClip {
  id: string;
  name: string;
  source: ClipSource;
  /** 片段时长（毫秒） */
  durationMs: number;
  /** 片段起点（毫秒），缺省时顺序累加 */
  startMs?: number;
  /** 画面底部的字幕（台词 / 画面描述） */
  caption?: string;
}

export interface Timeline {
  width: number;
  height: number;
  /** 相邻片段之间的转场时长（毫秒），发生在前一片段的末尾 */
  transitionMs: number;
  /** 转场类型，默认 crossfade */
  transitionType?: TransitionType;
  /** 画面适配：cover 铺满裁切（默认），contain 完整显示带黑边 */
  fitMode?: FitMode;
  /** 背景色，默认黑色 */
  background?: string;
  clips: TimelineClip[];
}

export interface WebmCodecPreset {
  id: 'vp8' | 'vp9' | 'av1';
  label: string;
  container: 'webm';
  mimeType: string;
  fileExtension: string;
  encoderConfigCodec: string;
  muxerCodec: 'V_VP8' | 'V_VP9' | 'V_AV1';
}

export interface Mp4CodecPreset {
  id: 'avc';
  label: string;
  container: 'mp4';
  mimeType: string;
  fileExtension: string;
  encoderConfigCodec: string;
  muxerCodec: 'avc';
}

export type CodecPreset = WebmCodecPreset | Mp4CodecPreset;

/** 已混好的 PCM 声音（planar，每个声道一样长） */
export interface PcmAudio {
  sampleRate: number;
  channels: Float32Array[];
}

export interface EncodeAudioOptions {
  pcm: PcmAudio;
  codec: AudioCodecPreset;
  /** 音频码率（bit/s），默认 128k */
  bitrate?: number;
}

export interface EncodeOptions {
  fps: number;
  /** 码率（bit/s） */
  bitrate: number;
  codec: CodecPreset;
  /** 声音轨（不给时只导出画面） */
  audio?: EncodeAudioOptions;
  /** 取消导出 */
  signal?: AbortSignal;
}

export interface EncodeProgress {
  frame: number;
  totalFrames: number;
  /** 0-100 */
  percent: number;
}

export interface EncodeResult {
  blob: Blob;
  mimeType: string;
  fileExtension: string;
  /** 输出文件是否带音轨 */
  hasAudio: boolean;
}
