// 改编自 video-maker/packages/video-core/src/muxer.ts（同一作者的项目），删去 WebGPU / 叠加轨
import { ArrayBufferTarget as Mp4ArrayBufferTarget, Muxer as Mp4Muxer } from 'mp4-muxer';
import { ArrayBufferTarget as WebmArrayBufferTarget, Muxer as WebmMuxer } from 'webm-muxer';
import type { AudioCodecPreset } from './audio-codecs';
import type { CodecPreset } from './types';

/** 一条视频轨 + 可选音频轨的封装器（内存缓冲） */
export interface VideoMuxer {
  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void;
  addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void;
  finalize(): void;
  readonly target: { buffer: ArrayBuffer };
}

export interface MuxerAudioTrack {
  preset: AudioCodecPreset;
  sampleRate: number;
  numberOfChannels: number;
}

export function createMuxer(
  preset: CodecPreset,
  width: number,
  height: number,
  audio?: MuxerAudioTrack
): VideoMuxer {
  if (preset.container === 'mp4') {
    return new Mp4Muxer({
      target: new Mp4ArrayBufferTarget(),
      video: { codec: preset.muxerCodec, width, height },
      ...(audio
        ? {
            audio: {
              codec: audio.preset.mp4MuxerCodec,
              sampleRate: audio.sampleRate,
              numberOfChannels: audio.numberOfChannels,
            },
          }
        : {}),
      fastStart: 'in-memory',
    });
  }
  const webmAudioCodec = audio?.preset.webmMuxerCodec;
  if (audio && !webmAudioCodec) {
    throw new Error(`WebM 不能封装 ${audio.preset.label} 音频`);
  }
  return new WebmMuxer({
    target: new WebmArrayBufferTarget(),
    video: { codec: preset.muxerCodec, width, height },
    ...(audio && webmAudioCodec
      ? {
          audio: {
            codec: webmAudioCodec,
            sampleRate: audio.sampleRate,
            numberOfChannels: audio.numberOfChannels,
          },
        }
      : {}),
  });
}
