/**
 * 保存预演视频：按画幅比例（长边 1280）、24fps 逐帧采样脚本 → 舞台渲染 → WebCodecs 编码为 MP4（不支持时 WebM），
 * 同时把第一帧截成 PNG（首帧构图参考）。逐帧确定性渲染，不是实时录屏。
 *
 * 编码器可注入（测试 / 没有 WebCodecs 的环境）；默认实现动态加载 @novel-editor/video/stitch。
 */
import { previzFrameCount, samplePrevizScript, type PrevizScript } from '@novel-editor/video';
import { captureSize } from './presets';
import type { PrevizStageApi } from './types';

export const PREVIZ_FPS = 24;
export const PREVIZ_LONG_EDGE = 1280;

export interface PrevizEncodeInput {
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  drawFrame: (index: number) => CanvasImageSource;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface PrevizEncodeResult {
  data: Uint8Array;
  ext: 'mp4' | 'webm';
}

export type PrevizVideoEncoder = (input: PrevizEncodeInput) => Promise<PrevizEncodeResult>;

export const defaultPrevizEncoder: PrevizVideoEncoder = async (input) => {
  const { encodeFrameSequence } = await import('@novel-editor/video/stitch');
  const result = await encodeFrameSequence({
    width: input.width,
    height: input.height,
    fps: input.fps,
    totalFrames: input.totalFrames,
    drawFrame: (index) => input.drawFrame(index),
    onProgress: input.onProgress,
    signal: input.signal,
  });
  return { data: result.data, ext: result.fileExtension };
};

export interface PrevizVideoOutput {
  video: Uint8Array;
  ext: 'mp4' | 'webm';
  /** 第一帧 PNG */
  firstFrame: Uint8Array;
}

/** 渲染并编码整段预演；无论成功失败都恢复舞台视口 */
export async function renderPrevizVideo(
  stage: PrevizStageApi,
  script: PrevizScript,
  aspect: number,
  encode: PrevizVideoEncoder,
  options: {
    onProgress?: (ratio: number) => void;
    signal?: AbortSignal;
  } = {}
): Promise<PrevizVideoOutput> {
  const size = captureSize(aspect, PREVIZ_LONG_EDGE);
  stage.setSample(samplePrevizScript(script, 0));
  const firstFrame = await stage.capture(size);
  const totalFrames = previzFrameCount(script, PREVIZ_FPS);
  stage.beginExport(size);
  try {
    const result = await encode({
      ...size,
      fps: PREVIZ_FPS,
      totalFrames,
      drawFrame: (index) => stage.renderExportFrame(samplePrevizScript(script, index / PREVIZ_FPS)),
      onProgress: (done, total) => options.onProgress?.(done / total),
      signal: options.signal,
    });
    return { video: result.data, ext: result.ext, firstFrame };
  } finally {
    stage.endExport();
  }
}
