/**
 * 逐帧编码：调用方按帧序号绘制画面（例如 3D 预演引擎渲染到 WebGL canvas），
 * 这里用 WebCodecs VideoEncoder 编码并封装为 MP4（H.264 优先）/ WebM。
 *
 * 不是实时录屏：每一帧都按 timestamp = index / fps 确定性生成，结果与播放速度、机器快慢无关。
 * 与 encodeTimeline 共用封装器与编码预设；只能在渲染进程（或 Worker）中运行。
 */
import { detectSupportedCodecs, isWebCodecsSupported, pickDefaultCodec } from './codecs';
import { createMuxer } from './muxer';
import type { CodecPreset } from './types';

export interface FrameSequenceOptions {
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  /** 绘制第 index 帧并返回画面（canvas / ImageBitmap 等） */
  drawFrame: (index: number, timestampMs: number) => CanvasImageSource | Promise<CanvasImageSource>;
  /** 默认按环境探测：H.264 MP4 优先，其次 VP9 WebM */
  codec?: CodecPreset;
  /** 默认按分辨率估算（约 0.1 bit / 像素 / 帧，至少 2 Mbps） */
  bitrate?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface FrameSequenceResult {
  data: Uint8Array;
  mimeType: string;
  fileExtension: 'mp4' | 'webm';
}

function abortError(): Error {
  if (typeof DOMException !== 'undefined') return new DOMException('已取消导出', 'AbortError');
  const error = new Error('已取消导出');
  error.name = 'AbortError';
  return error;
}

export function defaultBitrate(width: number, height: number, fps: number): number {
  return Math.max(2_000_000, Math.round(width * height * fps * 0.1));
}

export async function encodeFrameSequence(
  options: FrameSequenceOptions
): Promise<FrameSequenceResult> {
  const { width, height, fps, totalFrames, signal } = options;
  if (!isWebCodecsSupported()) {
    throw new Error('当前环境不支持 WebCodecs（VideoEncoder），无法导出视频');
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`分辨率无效: ${width}×${height}`);
  }
  if (!Number.isFinite(fps) || fps <= 0) throw new Error(`帧率必须大于 0: ${fps}`);
  if (!Number.isInteger(totalFrames) || totalFrames <= 0) throw new Error('没有可导出的帧');
  const bitrate = options.bitrate ?? defaultBitrate(width, height, fps);
  const codec =
    options.codec ?? pickDefaultCodec(await detectSupportedCodecs({ width, height, fps, bitrate }));
  if (!codec) throw new Error('当前环境没有可用的视频编码格式');

  const muxer = createMuxer(codec, width, height);
  let encodeError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      encodeError = error instanceof Error ? error : new Error(String(error));
    },
  });
  const check = () => {
    if (encodeError) throw encodeError;
    if (signal?.aborted) throw abortError();
  };
  const frameUs = Math.round(1_000_000 / fps);
  const keyframeEvery = Math.max(1, Math.round(fps * 2));
  try {
    encoder.configure({ codec: codec.encoderConfigCodec, width, height, bitrate, framerate: fps });
    for (let index = 0; index < totalFrames; index += 1) {
      check();
      const timestampMs = (index * 1000) / fps;
      const source = await options.drawFrame(index, timestampMs);
      const frame = new VideoFrame(source, {
        timestamp: Math.round(timestampMs * 1000),
        duration: frameUs,
      });
      try {
        encoder.encode(frame, { keyFrame: index % keyframeEvery === 0 });
      } finally {
        frame.close();
      }
      options.onProgress?.(index + 1, totalFrames);
      if ((index + 1) % Math.max(1, Math.round(fps)) === 0) await encoder.flush();
    }
    await encoder.flush();
    check();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  muxer.finalize();
  return {
    data: new Uint8Array(muxer.target.buffer),
    mimeType: codec.mimeType,
    fileExtension: codec.container === 'mp4' ? 'mp4' : 'webm',
  };
}
