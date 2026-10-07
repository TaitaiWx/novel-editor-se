// 改编自 video-maker/packages/video-core/src/render.ts（同一作者的项目），删去 WebGPU / 音频 / 叠加轨
/**
 * Canvas2D 逐帧绘制：cover / contain 适配、交叉淡化 / 黑场淡入淡出转场、片段字幕。
 */
import { resolveClipsAt } from './timeline';
import {
  isVideoClipSource,
  type FitMode,
  type FrameSource,
  type Timeline,
  type TimelineClip,
} from './types';

export type RenderContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** 片段在本地时间处的画面；视频源尚未准备好该帧时返回 null */
export function getClipFrameSource(clip: TimelineClip, localMs: number): FrameSource | null {
  if (isVideoClipSource(clip.source)) return clip.source.getFrameAt(localMs);
  return clip.source;
}

async function prepareClip(clip: TimelineClip | null, localMs: number): Promise<void> {
  if (clip && isVideoClipSource(clip.source)) await clip.source.ensureFrameAt(localMs);
}

/** 绘制前调用：确保该时刻涉及的视频片段帧已就绪 */
export async function prepareTimelineFrames(
  timeline: Timeline,
  timestampMs: number
): Promise<void> {
  const resolved = resolveClipsAt(timeline.clips, timeline.transitionMs, timestampMs);
  await Promise.all([
    prepareClip(resolved.clip, resolved.clipLocalMs),
    prepareClip(resolved.nextClip, resolved.nextClipLocalMs),
  ]);
}

export interface SourceSize {
  width: number;
  height: number;
}

/** 读取图像尺寸（不依赖 instanceof，便于在没有 DOM 全局的环境中测试） */
export function getSourceSize(source: FrameSource): SourceSize {
  if ('displayWidth' in source) {
    return { width: source.displayWidth, height: source.displayHeight };
  }
  if ('naturalWidth' in source) {
    return {
      width: source.naturalWidth || source.width,
      height: source.naturalHeight || source.height,
    };
  }
  return { width: source.width, height: source.height };
}

/** 计算适配后的绘制矩形（保持比例、居中） */
export function fitRect(
  source: SourceSize,
  target: SourceSize,
  fitMode: FitMode
): { x: number; y: number; width: number; height: number } | null {
  if (source.width <= 0 || source.height <= 0) return null;
  const scaleX = target.width / source.width;
  const scaleY = target.height / source.height;
  const scale = fitMode === 'contain' ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
  const width = source.width * scale;
  const height = source.height * scale;
  return { x: (target.width - width) / 2, y: (target.height - height) / 2, width, height };
}

function drawClipAt(
  context: RenderContext,
  clip: TimelineClip,
  localMs: number,
  size: SourceSize,
  alpha: number,
  fitMode: FitMode
): void {
  if (alpha <= 0) return;
  const source = getClipFrameSource(clip, localMs);
  if (!source) return;
  const rect = fitRect(getSourceSize(source), size, fitMode);
  if (!rect) return;
  context.save();
  context.globalAlpha = Math.min(1, alpha);
  context.drawImage(source, rect.x, rect.y, rect.width, rect.height);
  context.restore();
}

/** 按字符折行（中文没有空格，逐字测量） */
export function wrapText(
  measure: (text: string) => number,
  text: string,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    let current = '';
    for (const char of rawLine) {
      const candidate = current + char;
      if (measure(candidate) > maxWidth && current.length > 0) {
        lines.push(current);
        current = char;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines;
}

const CAPTION_MAX_LINES = 3;

function drawCaption(context: RenderContext, text: string, size: SourceSize, alpha: number): void {
  const trimmed = text.trim();
  if (!trimmed || alpha <= 0) return;
  const { width, height } = size;
  const fontSize = Math.max(16, Math.round(Math.min(width, height) * 0.045));
  const lineHeight = fontSize * 1.4;
  const padding = fontSize * 0.6;
  const maxWidth = Math.max(0, width - fontSize * 2);

  context.save();
  context.globalAlpha = Math.min(1, alpha);
  context.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'top';
  let lines = wrapText((value) => context.measureText(value).width, trimmed, maxWidth);
  if (lines.length > CAPTION_MAX_LINES) {
    lines = lines.slice(0, CAPTION_MAX_LINES);
    lines[CAPTION_MAX_LINES - 1] = `${lines[CAPTION_MAX_LINES - 1]?.slice(0, -1) ?? ''}…`;
  }
  const textHeight = lines.length * lineHeight;
  const boxTop = height - padding * 2 - textHeight;
  context.fillStyle = 'rgba(0, 0, 0, 0.55)';
  context.fillRect(0, boxTop, width, textHeight + padding * 2);
  context.fillStyle = '#ffffff';
  lines.forEach((line, index) => {
    context.fillText(line, width / 2, boxTop + padding + index * lineHeight);
  });
  context.restore();
}

/** 绘制时间轴在 timestampMs 处的一帧 */
export function drawTimelineFrame(
  context: RenderContext,
  timeline: Timeline,
  timestampMs: number
): void {
  const size = { width: timeline.width, height: timeline.height };
  const fitMode = timeline.fitMode ?? 'cover';
  context.clearRect(0, 0, size.width, size.height);
  context.fillStyle = timeline.background ?? '#000000';
  context.fillRect(0, 0, size.width, size.height);

  const resolved = resolveClipsAt(timeline.clips, timeline.transitionMs, timestampMs);
  const { clip, nextClip } = resolved;
  if (!clip) return;

  const p = nextClip ? resolved.transitionProgress : 0;
  if (!nextClip || p <= 0) {
    drawClipAt(context, clip, resolved.clipLocalMs, size, 1, fitMode);
    if (clip.caption) drawCaption(context, clip.caption, size, 1);
    return;
  }

  if (timeline.transitionType === 'fade') {
    // 黑场过渡：前半段淡出，后半段淡入
    if (p < 0.5) {
      drawClipAt(context, clip, resolved.clipLocalMs, size, 1 - 2 * p, fitMode);
      if (clip.caption) drawCaption(context, clip.caption, size, 1 - 2 * p);
    } else {
      drawClipAt(context, nextClip, resolved.nextClipLocalMs, size, 2 * p - 1, fitMode);
      if (nextClip.caption) drawCaption(context, nextClip.caption, size, 2 * p - 1);
    }
    return;
  }

  // 交叉淡化：字幕随占优的片段切换
  drawClipAt(context, clip, resolved.clipLocalMs, size, 1, fitMode);
  drawClipAt(context, nextClip, resolved.nextClipLocalMs, size, p, fitMode);
  const caption = p < 0.5 ? clip.caption : nextClip.caption;
  if (caption) drawCaption(context, caption, size, 1);
}
