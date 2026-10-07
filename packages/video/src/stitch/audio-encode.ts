/**
 * 把混好的 PCM 声音分块送进 WebCodecs AudioEncoder，编码结果写入封装器的音频轨。
 * 与画面交替推进（encodeUntil），封装器里的音视频块按时间交错；finish 后 flush。
 */
import { audioEncoderConfig, AUDIO_BITRATE } from './audio-codecs';
import type { VideoMuxer } from './muxer';
import type { EncodeAudioOptions } from './types';

/** 每个 AudioData 的帧数（约 85ms@48kHz） */
export const AUDIO_CHUNK_FRAMES = 4096;
const US_PER_SECOND = 1_000_000;

export interface AudioTrackWriter {
  /** 编码到时间轴 ms 处（不超过声音总长） */
  encodeUntil(ms: number): void;
  /** 编码剩余部分并 flush */
  finish(): Promise<void>;
  /** 编码器报告过的错误 */
  readonly error: Error | null;
  close(): void;
}

export function isAudioEncodingSupported(): boolean {
  return typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined';
}

export function createAudioTrackWriter(
  audio: EncodeAudioOptions,
  muxer: VideoMuxer
): AudioTrackWriter {
  const { pcm, codec } = audio;
  const numberOfChannels = pcm.channels.length;
  if (numberOfChannels === 0) throw new Error('声音没有声道');
  if (!isAudioEncodingSupported()) {
    throw new Error('当前环境不支持 WebCodecs（AudioEncoder），无法导出声音');
  }
  const totalFrames = pcm.channels[0]?.length ?? 0;
  const { sampleRate } = pcm;
  let written = 0;
  let encodeError: Error | null = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (error) => {
      encodeError = error instanceof Error ? error : new Error(String(error));
    },
  });
  encoder.configure(
    audioEncoderConfig(codec, {
      sampleRate,
      numberOfChannels,
      bitrate: audio.bitrate ?? AUDIO_BITRATE,
    })
  );

  const encodeUntil = (ms: number) => {
    const target = Math.min(totalFrames, Math.max(0, Math.round((ms / 1000) * sampleRate)));
    while (written < target) {
      const frames = Math.min(AUDIO_CHUNK_FRAMES, target - written);
      const data = new Float32Array(frames * numberOfChannels);
      pcm.channels.forEach((channel, index) => {
        data.set(channel.subarray(written, written + frames), index * frames);
      });
      const chunk = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: frames,
        numberOfChannels,
        timestamp: Math.round((written / sampleRate) * US_PER_SECOND),
        data,
      });
      try {
        encoder.encode(chunk);
      } finally {
        chunk.close();
      }
      written += frames;
    }
  };

  return {
    encodeUntil,
    async finish() {
      encodeUntil(Number.POSITIVE_INFINITY);
      await encoder.flush();
    },
    get error() {
      return encodeError;
    },
    close() {
      if (encoder.state !== 'closed') encoder.close();
    },
  };
}
