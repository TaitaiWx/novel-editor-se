// 改编自 video-maker/packages/video-core/src/renderer.ts（同一作者的项目），删去 WebGPU / 音频 / 叠加轨
import { drawTimelineFrame, type RenderContext } from './render';
import type { Timeline } from './types';

export type CanvasSurface = HTMLCanvasElement | OffscreenCanvas;

/** 渲染表面：导出用 OffscreenCanvas，不支持时回退到 DOM canvas */
export interface Renderer {
  readonly width: number;
  readonly height: number;
  render(timeline: Timeline, timestampMs: number): void;
  /** 可作为 VideoFrame 输入的底层画布 */
  getCanvas(): CanvasSurface;
  destroy(): void;
}

export function isOffscreenRenderingSupported(): boolean {
  return typeof OffscreenCanvas !== 'undefined';
}

/** 创建一块画布与 2D 上下文（优先 OffscreenCanvas） */
export function createCanvasSurface(
  width: number,
  height: number
): { canvas: CanvasSurface; context: RenderContext } {
  if (isOffscreenRenderingSupported()) {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建离屏 2D 渲染上下文');
    return { canvas, context };
  }
  if (typeof document === 'undefined') {
    throw new Error('当前环境既没有 OffscreenCanvas 也没有 document，无法创建画布');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建 2D 渲染上下文');
  return { canvas, context };
}

/** 创建渲染器（OffscreenCanvas，不支持时回退到 DOM canvas） */
export function createRenderer(width: number, height: number): Renderer {
  const { canvas, context } = createCanvasSurface(width, height);
  return {
    width,
    height,
    render(timeline, timestampMs) {
      drawTimelineFrame(context, timeline, timestampMs);
    },
    getCanvas() {
      return canvas;
    },
    destroy() {
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}
