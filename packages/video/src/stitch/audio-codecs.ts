/**
 * 样片声音的编码选择：MP4 用 AAC（mp4a.40.2），WebM 用 Opus。
 * 至少一个片段有声音时：
 * - 首选容器的音频编码可用 → 照用
 * - MP4 + AAC 不可用 → 改用 WebM（VP9 > VP8 > AV1）+ Opus，保住声音
 * - 都不可用 → 只导出画面，并返回 audioDropped: true 由调用方提示作者
 * 判断全部通过可注入的 isAudioSupported，便于在没有 WebCodecs 的环境里测试。
 */
import type { CodecPreset } from './types';

export interface AudioCodecPreset {
  id: 'aac' | 'opus';
  label: string;
  /** AudioEncoder 的 codec 字符串 */
  encoderConfigCodec: 'mp4a.40.2' | 'opus';
  /** mp4-muxer 的 audio.codec */
  mp4MuxerCodec: 'aac' | 'opus';
  /** webm-muxer 的 audio.codec（WebM 只能装 Opus / Vorbis，AAC 为 null） */
  webmMuxerCodec: 'A_OPUS' | null;
}

export const AAC_PRESET: AudioCodecPreset = {
  id: 'aac',
  label: 'AAC',
  encoderConfigCodec: 'mp4a.40.2',
  mp4MuxerCodec: 'aac',
  webmMuxerCodec: null,
};

export const OPUS_PRESET: AudioCodecPreset = {
  id: 'opus',
  label: 'Opus',
  encoderConfigCodec: 'opus',
  mp4MuxerCodec: 'opus',
  webmMuxerCodec: 'A_OPUS',
};

/** Opus 只支持 48kHz 等少数采样率，统一用 48kHz 双声道 */
export const AUDIO_SAMPLE_RATE = 48_000;
export const AUDIO_CHANNELS = 2;
export const AUDIO_BITRATE = 128_000;

export interface AudioFormat {
  sampleRate: number;
  numberOfChannels: number;
  bitrate: number;
}

export const DEFAULT_AUDIO_FORMAT: AudioFormat = {
  sampleRate: AUDIO_SAMPLE_RATE,
  numberOfChannels: AUDIO_CHANNELS,
  bitrate: AUDIO_BITRATE,
};

/** 容器对应的音频编码 */
export function audioPresetFor(container: CodecPreset['container']): AudioCodecPreset {
  return container === 'mp4' ? AAC_PRESET : OPUS_PRESET;
}

export function audioEncoderConfig(
  preset: AudioCodecPreset,
  format: AudioFormat = DEFAULT_AUDIO_FORMAT
): AudioEncoderConfig {
  return {
    codec: preset.encoderConfigCodec,
    sampleRate: format.sampleRate,
    numberOfChannels: format.numberOfChannels,
    bitrate: format.bitrate,
  };
}

export type AudioSupportCheck = (config: AudioEncoderConfig) => Promise<boolean>;

/** 默认判断：当前环境的 AudioEncoder.isConfigSupported（没有 AudioEncoder 时视为不支持） */
export const isAudioEncoderConfigSupported: AudioSupportCheck = async (config) => {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return false;
  try {
    const support = await AudioEncoder.isConfigSupported(config);
    return support.supported === true;
  } catch {
    return false;
  }
};

export interface AudioEncodingChoice {
  /** 最终使用的视频编码（MP4 + AAC 不可用时可能改为 WebM） */
  video: CodecPreset;
  /** 音频编码；null 表示只导出画面 */
  audio: AudioCodecPreset | null;
  /** 素材有声音但无法编码，样片没有声音 */
  audioDropped: boolean;
}

export interface AudioEncodingQuery {
  /** 首选视频编码（pickDefaultCodec 的结果） */
  video: CodecPreset;
  /** 当前环境可用的全部视频编码（detectSupportedCodecs 的结果） */
  supportedVideo: readonly CodecPreset[];
  /** 是否至少一个片段带声音 */
  hasAudio: boolean;
  format?: AudioFormat;
  isAudioSupported?: AudioSupportCheck;
}

const WEBM_FALLBACK_ORDER: readonly CodecPreset['id'][] = ['vp9', 'vp8', 'av1'];

export async function chooseAudioEncoding(query: AudioEncodingQuery): Promise<AudioEncodingChoice> {
  const { video, supportedVideo, hasAudio } = query;
  if (!hasAudio) return { video, audio: null, audioDropped: false };
  const check = query.isAudioSupported ?? isAudioEncoderConfigSupported;
  const format = query.format ?? DEFAULT_AUDIO_FORMAT;

  const preferred = audioPresetFor(video.container);
  if (await check(audioEncoderConfig(preferred, format))) {
    return { video, audio: preferred, audioDropped: false };
  }
  if (video.container === 'mp4') {
    const webm = WEBM_FALLBACK_ORDER.map((id) => supportedVideo.find((preset) => preset.id === id))
      .filter((preset): preset is CodecPreset => preset !== undefined)
      .at(0);
    if (webm && (await check(audioEncoderConfig(OPUS_PRESET, format)))) {
      return { video: webm, audio: OPUS_PRESET, audioDropped: false };
    }
  }
  return { video, audio: null, audioDropped: true };
}
