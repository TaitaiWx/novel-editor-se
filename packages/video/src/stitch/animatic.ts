/**
 * 由分镜构建样片（animatic）时间轴：每个镜头一个片段，时长取镜头时长；
 * 已生成视频 / 首帧图的镜头用对应素材，没有素材的镜头用占位卡（镜头号 + 景别 + 画面描述）。
 */
import { NARRATOR } from '../audio';
import type { Shot, Storyboard } from '../storyboard';
import { wrapText } from './render';
import { createCanvasSurface } from './renderer';
import type { ClipSource, FitMode, FrameSource, Timeline, TimelineClip } from './types';

export type PlaceholderFactory = (
  shot: Shot,
  index: number,
  width: number,
  height: number
) => FrameSource;

export interface AnimaticOptions {
  /** 只给一边时另一边按画面比例推算；都不给时长边为 longEdge */
  width?: number;
  height?: number;
  /** 默认 1280 */
  longEdge?: number;
  /** 转场时长，默认 300ms（不超过最短镜头的一半） */
  transitionMs?: number;
  /** 是否显示字幕（台词优先，没有台词时显示画面描述），默认 true */
  captions?: boolean;
  fitMode?: FitMode;
  /** 自定义占位卡（测试或自定义样式），默认用画布绘制 */
  createPlaceholder?: PlaceholderFactory;
}

export const DEFAULT_ANIMATIC_LONG_EDGE = 1280;
export const DEFAULT_ANIMATIC_TRANSITION_MS = 300;

/** 取最近的偶数（H.264 要求宽高为偶数），至少为 2 */
export function toEvenDimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 2;
  return Math.max(2, Math.round(value / 2) * 2);
}

export function parseAspectRatio(ratio: string): number {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio.trim());
  const w = Number(match?.[1]);
  const h = Number(match?.[2]);
  return w > 0 && h > 0 ? w / h : 16 / 9;
}

/** 根据画面比例计算画布尺寸（偶数） */
export function animaticSize(
  aspectRatio: string,
  options: Pick<AnimaticOptions, 'width' | 'height' | 'longEdge'> = {}
): { width: number; height: number } {
  const ratio = parseAspectRatio(aspectRatio);
  const { width, height } = options;
  if (width && height) return { width: toEvenDimension(width), height: toEvenDimension(height) };
  if (width) return { width: toEvenDimension(width), height: toEvenDimension(width / ratio) };
  if (height) return { width: toEvenDimension(height * ratio), height: toEvenDimension(height) };
  const longEdge = options.longEdge ?? DEFAULT_ANIMATIC_LONG_EDGE;
  return ratio >= 1
    ? { width: toEvenDimension(longEdge), height: toEvenDimension(longEdge / ratio) }
    : { width: toEvenDimension(longEdge * ratio), height: toEvenDimension(longEdge) };
}

/** 默认占位卡：深灰底 + 镜头号 + 景别 / 时长 / 运镜 + 画面描述（需要画布环境） */
export const createDefaultPlaceholder: PlaceholderFactory = (shot, index, width, height) => {
  const { canvas, context } = createCanvasSurface(width, height);
  const unit = Math.min(width, height);
  const margin = Math.round(unit * 0.08);
  context.fillStyle = '#2b2d33';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  context.lineWidth = Math.max(2, Math.round(unit * 0.004));
  context.strokeRect(margin / 2, margin / 2, width - margin, height - margin);

  const font = `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif`;
  const titleSize = Math.round(unit * 0.09);
  const metaSize = Math.round(unit * 0.045);
  const bodySize = Math.round(unit * 0.05);
  context.textAlign = 'left';
  context.textBaseline = 'top';
  let y = margin;
  context.fillStyle = '#e8e6e3';
  context.font = `600 ${titleSize}px ${font}`;
  context.fillText(`镜头 ${index + 1}`, margin, y);
  y += titleSize * 1.4;
  context.fillStyle = '#a9b4c2';
  context.font = `500 ${metaSize}px ${font}`;
  const meta = [shot.shotSize, `${shot.durationSec} 秒`, shot.camera].filter(Boolean).join(' · ');
  context.fillText(meta, margin, y);
  y += metaSize * 1.8;
  context.fillStyle = '#d4d2cf';
  context.font = `400 ${bodySize}px ${font}`;
  const lineHeight = bodySize * 1.5;
  const maxLines = Math.max(1, Math.floor((height - margin - y) / lineHeight));
  const lines = wrapText(
    (text) => context.measureText(text).width,
    shot.description,
    width - margin * 2
  );
  lines.slice(0, maxLines).forEach((line, lineIndex) => {
    const isLast = lineIndex === maxLines - 1 && lines.length > maxLines;
    context.fillText(isLast ? `${line.slice(0, -1)}…` : line, margin, y + lineIndex * lineHeight);
  });
  return canvas;
};

export function buildAnimaticTimeline(
  storyboard: Storyboard,
  sources: ReadonlyMap<string, ClipSource>,
  options: AnimaticOptions = {}
): Timeline {
  const { width, height } = animaticSize(storyboard.aspectRatio, options);
  const captions = options.captions ?? true;
  const createPlaceholder = options.createPlaceholder ?? createDefaultPlaceholder;
  const clips: TimelineClip[] = storyboard.shots.map((shot, index) => {
    const clip: TimelineClip = {
      id: shot.id,
      name: `镜头${index + 1}`,
      source: sources.get(shot.id) ?? createPlaceholder(shot, index, width, height),
      durationMs: Math.round(shot.durationSec * 1000),
    };
    // 字幕：对白优先（人物台词带「名字：」，旁白只显示文字），没有对白时显示画面描述
    const dialogue = (shot.dialogue ?? [])
      .map((line) => (line.speaker === NARRATOR ? line.text : `${line.speaker}：${line.text}`))
      .join(' / ');
    const caption = captions ? dialogue || shot.description : undefined;
    if (caption) clip.caption = caption;
    return clip;
  });
  const shortest = clips.reduce((min, clip) => Math.min(min, clip.durationMs), Infinity);
  const requested = Math.max(0, options.transitionMs ?? DEFAULT_ANIMATIC_TRANSITION_MS);
  const transitionMs = Number.isFinite(shortest)
    ? Math.min(requested, Math.floor(shortest / 2))
    : 0;
  return {
    width,
    height,
    transitionMs,
    transitionType: 'crossfade',
    fitMode: options.fitMode ?? 'cover',
    clips,
  };
}
