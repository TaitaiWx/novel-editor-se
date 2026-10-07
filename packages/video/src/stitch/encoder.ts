// 改编自 video-maker/packages/video-core/src/encoder.ts（同一作者的项目），删去 WebGPU / 叠加轨
/**
 * 把时间轴编码为视频文件：Canvas2D 逐帧绘制 → WebCodecs VideoEncoder → mp4-muxer / webm-muxer。
 * 给了 options.audio 时同时用 AudioEncoder 编码混好的声音，随画面进度交错写入同一个文件。
 * 只能在渲染进程（或 Worker）中运行。每 2 秒一个关键帧，每秒 flush 一次控制内存，
 * 支持 AbortSignal 取消；无论成功失败都会关闭帧与编码器。
 */
import { createAudioTrackWriter, type AudioTrackWriter } from './audio-encode';
import { createMuxer } from './muxer';
import { prepareTimelineFrames } from './render';
import { createRenderer } from './renderer';
import { timelineDurationMs } from './timeline';
import type { EncodeOptions, EncodeProgress, EncodeResult, Timeline } from './types';

const US_PER_MS = 1000;

function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) return reason;
  if (typeof DOMException !== 'undefined') return new DOMException('已取消导出', 'AbortError');
  const error = new Error('已取消导出');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError(signal);
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export async function encodeTimeline(
  timeline: Timeline,
  options: EncodeOptions,
  onProgress?: (progress: EncodeProgress) => void
): Promise<EncodeResult> {
  const { fps, bitrate, codec, signal } = options;
  throwIfAborted(signal);
  if (timeline.clips.length === 0) throw new Error('时间轴为空，无法导出');
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    throw new Error('当前环境不支持 WebCodecs（VideoEncoder），无法导出视频');
  }
  if (!Number.isFinite(fps) || fps <= 0) throw new Error(`帧率必须大于 0: ${fps}`);
  if (!Number.isFinite(bitrate) || bitrate <= 0) throw new Error(`码率必须大于 0: ${bitrate}`);
  const { width, height } = timeline;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`分辨率无效: ${width}×${height}`);
  }
  if (codec.id === 'avc' && (width % 2 !== 0 || height % 2 !== 0)) {
    throw new Error(`${codec.label} 要求宽高均为偶数（当前 ${width}×${height}）`);
  }
  const durationMs = timelineDurationMs(timeline);
  if (durationMs <= 0) throw new Error('时间轴总时长为 0，无法导出');

  const encoderConfig: VideoEncoderConfig = {
    codec: codec.encoderConfigCodec,
    width,
    height,
    bitrate,
    framerate: fps,
  };
  const support = await VideoEncoder.isConfigSupported(encoderConfig);
  if (!support.supported) {
    throw new Error(`编码格式 ${codec.label} 不支持 ${width}×${height}@${fps}fps`);
  }
  throwIfAborted(signal);

  const frameIntervalMs = 1000 / fps;
  const totalFrames = Math.max(1, Math.round((durationMs / 1000) * fps));
  const frameDurationUs = Math.round(frameIntervalMs * US_PER_MS);
  const keyframeEvery = Math.max(1, Math.round(fps * 2));
  const flushEvery = Math.max(1, Math.round(fps));

  const audio = options.audio;
  const renderer = createRenderer(width, height);
  const muxer = createMuxer(
    codec,
    width,
    height,
    audio
      ? {
          preset: audio.codec,
          sampleRate: audio.pcm.sampleRate,
          numberOfChannels: audio.pcm.channels.length,
        }
      : undefined
  );
  let encodeError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      encodeError = toError(error);
    },
  });
  let audioWriter: AudioTrackWriter | null = null;
  const checkError = () => {
    if (encodeError) throw encodeError;
    if (audioWriter?.error) throw audioWriter.error;
  };

  try {
    encoder.configure(encoderConfig);
    if (audio) audioWriter = createAudioTrackWriter(audio, muxer);
    for (let index = 0; index < totalFrames; index += 1) {
      throwIfAborted(signal);
      checkError();
      const timestampMs = index * frameIntervalMs;
      await prepareTimelineFrames(timeline, timestampMs);
      renderer.render(timeline, timestampMs);
      const frame = new VideoFrame(renderer.getCanvas(), {
        timestamp: Math.round(timestampMs * US_PER_MS),
        duration: frameDurationUs,
      });
      try {
        encoder.encode(frame, { keyFrame: index % keyframeEvery === 0 });
      } finally {
        frame.close();
      }
      onProgress?.({
        frame: index + 1,
        totalFrames,
        percent: ((index + 1) / totalFrames) * 100,
      });
      if ((index + 1) % flushEvery === 0) {
        // 声音跟上画面进度，封装器里的音视频块按时间交错
        audioWriter?.encodeUntil((index + 1) * frameIntervalMs);
        await encoder.flush();
        checkError();
      }
    }
    throwIfAborted(signal);
    await encoder.flush();
    await audioWriter?.finish();
    checkError();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    audioWriter?.close();
    renderer.destroy();
  }

  muxer.finalize();
  return {
    blob: new Blob([muxer.target.buffer], { type: codec.mimeType }),
    mimeType: codec.mimeType,
    fileExtension: codec.fileExtension,
    hasAudio: audioWriter !== null,
  };
}
