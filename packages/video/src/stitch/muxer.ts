// 改编自 video-maker/packages/video-core/src/muxer.ts（同一作者的项目），删去 WebGPU / 音频 / 叠加轨
import { ArrayBufferTarget as Mp4ArrayBufferTarget, Muxer as Mp4Muxer } from 'mp4-muxer';
import { ArrayBufferTarget as WebmArrayBufferTarget, Muxer as WebmMuxer } from 'webm-muxer';
import type { CodecPreset } from './types';

/** 只含视频轨的封装器（内存缓冲） */
export interface VideoMuxer {
  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void;
  finalize(): void;
  readonly target: { buffer: ArrayBuffer };
}

export function createMuxer(preset: CodecPreset, width: number, height: number): VideoMuxer {
  if (preset.container === 'mp4') {
    return new Mp4Muxer({
      target: new Mp4ArrayBufferTarget(),
      video: { codec: preset.muxerCodec, width, height },
      fastStart: 'in-memory',
    });
  }
  return new WebmMuxer({
    target: new WebmArrayBufferTarget(),
    video: { codec: preset.muxerCodec, width, height },
  });
}
