/**
 * 用 <video> 元素作为片段源：按需 seek 并把当前画面绘制到一块画布上。
 *
 * 注意事项：
 * - video 需已加载元数据（readyState >= 1），否则 durationMs 为 0
 * - 跨域视频需设置 crossOrigin 且服务端允许，否则画布被污染，VideoFrame 构造会失败
 * - 浏览器的 seek 不保证逐帧精确，且每帧一次 seek 较慢；适合样片预览 / 导出，不适合精剪
 * - 导出期间不要让该 video 播放或被其他代码 seek；同一个源只服务一个片段
 * - 超出视频时长的时间会停在最后一帧
 */
import { createCanvasSurface, type CanvasSurface } from './renderer';
import type { RenderContext } from './render';
import type { FrameSource, VideoClipSource } from './types';

export interface VideoElementSourceOptions {
  /** 画布尺寸，默认使用视频原始尺寸 */
  width?: number;
  height?: number;
  /** 单次 seek 超时（毫秒），默认 5000；超时后沿用上一帧 */
  seekTimeoutMs?: number;
  /** 片段内本地时间对应的视频起点（毫秒，入点），默认 0 */
  inPointMs?: number;
}

function waitForSeek(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    video.addEventListener('seeked', done);
    video.addEventListener('error', done);
  });
}

export function createVideoElementSource(
  video: HTMLVideoElement,
  options: VideoElementSourceOptions = {}
): VideoClipSource {
  const width = options.width ?? (video.videoWidth || 2);
  const height = options.height ?? (video.videoHeight || 2);
  const seekTimeoutMs = options.seekTimeoutMs ?? 5000;
  const inPointMs = options.inPointMs ?? 0;
  let surface: { canvas: CanvasSurface; context: RenderContext } | null = null;
  let hasFrame = false;
  // 串行化 seek：同一个 video 不能同时跳到两个时间点
  let pending: Promise<void> = Promise.resolve();

  const totalMs = Number.isFinite(video.duration) ? video.duration * 1000 : 0;
  const durationMs = Math.max(0, totalMs - inPointMs);
  const frameMs = 1000 / 30;

  const draw = () => {
    surface ??= createCanvasSurface(width, height);
    surface.context.drawImage(video, 0, 0, width, height);
    hasFrame = true;
  };

  const seekTo = async (localMs: number) => {
    const maxMs = Math.max(0, totalMs - frameMs);
    const targetSec = Math.min(maxMs, Math.max(0, inPointMs + localMs)) / 1000;
    if (!hasFrame || Math.abs(video.currentTime - targetSec) > frameMs / 2000) {
      if (Math.abs(video.currentTime - targetSec) > 1e-6) {
        const seeked = waitForSeek(video, seekTimeoutMs);
        video.currentTime = targetSec;
        await seeked;
      }
      draw();
    }
  };

  return {
    durationMs,
    getFrameAt(): FrameSource | null {
      return hasFrame && surface ? surface.canvas : null;
    },
    ensureFrameAt(localMs: number): Promise<void> {
      pending = pending.then(() => seekTo(localMs));
      return pending;
    },
  };
}
