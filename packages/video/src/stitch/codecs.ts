// 改编自 video-maker/packages/video-core/src/codecs.ts（同一作者的项目），删去 WebGPU / 音频 / 叠加轨
import type { CodecPreset } from './types';

export const CODEC_PRESETS: readonly CodecPreset[] = [
  {
    id: 'avc',
    label: 'H.264 (AVC)',
    container: 'mp4',
    mimeType: 'video/mp4',
    fileExtension: 'mp4',
    encoderConfigCodec: 'avc1.42001f',
    muxerCodec: 'avc',
  },
  {
    id: 'vp9',
    label: 'VP9',
    container: 'webm',
    mimeType: 'video/webm',
    fileExtension: 'webm',
    encoderConfigCodec: 'vp09.00.10.08',
    muxerCodec: 'V_VP9',
  },
  {
    id: 'vp8',
    label: 'VP8',
    container: 'webm',
    mimeType: 'video/webm',
    fileExtension: 'webm',
    encoderConfigCodec: 'vp8',
    muxerCodec: 'V_VP8',
  },
  {
    id: 'av1',
    label: 'AV1',
    container: 'webm',
    mimeType: 'video/webm',
    fileExtension: 'webm',
    encoderConfigCodec: 'av01.0.04M.08',
    muxerCodec: 'V_AV1',
  },
];

export function isWebCodecsSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

export interface CodecSupportQuery {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
}

/** 探测当前环境可用的编码预设（顺序与 CODEC_PRESETS 一致） */
export async function detectSupportedCodecs(query: CodecSupportQuery): Promise<CodecPreset[]> {
  if (!isWebCodecsSupported()) return [];
  const results = await Promise.all(
    CODEC_PRESETS.map(async (preset): Promise<CodecPreset | null> => {
      try {
        const support = await VideoEncoder.isConfigSupported({
          codec: preset.encoderConfigCodec,
          width: query.width,
          height: query.height,
          bitrate: query.bitrate,
          framerate: query.fps,
        });
        return support.supported === true ? preset : null;
      } catch {
        return null;
      }
    })
  );
  return results.filter((preset): preset is CodecPreset => preset !== null);
}

/** 默认编码：优先 H.264 MP4（兼容性最好），其次 VP9 WebM，否则取第一个可用 */
export function pickDefaultCodec(supported: readonly CodecPreset[]): CodecPreset | null {
  return (
    supported.find((preset) => preset.id === 'avc') ??
    supported.find((preset) => preset.id === 'vp9') ??
    supported[0] ??
    null
  );
}
