// 改编自 video-maker/packages/video-core/src/timeline.ts（同一作者的项目），删去 WebGPU / 叠加轨（声音见 audio-*.ts）
import type { Timeline, TimelineClip } from './types';

/** 时间轴总时长：所有片段的最晚结束时间（毫秒） */
export function timelineDurationMs(timeline: {
  clips: readonly Pick<TimelineClip, 'durationMs' | 'startMs'>[];
}): number {
  let end = 0;
  let accumulated = 0;
  for (const clip of timeline.clips) {
    const start = clip.startMs ?? accumulated;
    end = Math.max(end, start + clip.durationMs);
    accumulated = start + clip.durationMs;
  }
  return end;
}

export interface ResolvedFrame {
  clip: TimelineClip | null;
  nextClip: TimelineClip | null;
  /** 0~1：与下一片段的转场进度 */
  transitionProgress: number;
  /** 当前片段内的本地时间（毫秒） */
  clipLocalMs: number;
  /** 下一片段内的本地时间（毫秒，转场期间下一片段停在首帧） */
  nextClipLocalMs: number;
}

interface PositionedClip {
  clip: TimelineClip;
  startMs: number;
}

/** 各片段在时间轴上的起点（毫秒）：有 startMs 用 startMs，否则接在上一片段之后（画面与声音共用） */
export function clipStartTimes(
  clips: readonly Pick<TimelineClip, 'durationMs' | 'startMs'>[]
): number[] {
  let accumulated = 0;
  return clips.map((clip) => {
    const startMs = clip.startMs ?? accumulated;
    accumulated = startMs + clip.durationMs;
    return startMs;
  });
}

function positionClips(clips: readonly TimelineClip[]): PositionedClip[] {
  const starts = clipStartTimes(clips);
  return clips
    .map((clip, index) => ({ clip, startMs: starts[index] ?? 0 }))
    .sort((a, b) => a.startMs - b.startMs);
}

const EMPTY_FRAME: ResolvedFrame = {
  clip: null,
  nextClip: null,
  transitionProgress: 0,
  clipLocalMs: 0,
  nextClipLocalMs: 0,
};

/**
 * 解析某一时刻应显示的片段。片段可带 startMs（允许间隙，间隙处为空帧），
 * 转场发生在当前片段最后 transitionMs 内，且只在下一片段紧随其后时出现。
 */
export function resolveClipsAt(
  clips: readonly TimelineClip[],
  transitionMs: number,
  timestampMs: number
): ResolvedFrame {
  if (clips.length === 0) return EMPTY_FRAME;
  const positioned = positionClips(clips);

  let current: PositionedClip | null = null;
  let next: PositionedClip | null = null;
  for (let index = 0; index < positioned.length; index += 1) {
    const item = positioned[index];
    if (!item) continue;
    const end = item.startMs + item.clip.durationMs;
    if (timestampMs >= item.startMs && timestampMs < end) {
      current = item;
      next = positioned[index + 1] ?? null;
      break;
    }
    if (timestampMs < item.startMs) break;
  }
  if (!current) return EMPTY_FRAME;

  const localMs = timestampMs - current.startMs;
  const transition = Math.max(0, Math.min(transitionMs, current.clip.durationMs));
  if (next && localMs >= current.clip.durationMs - transition) {
    const progress =
      transition > 0
        ? Math.min(1, Math.max(0, (localMs - (current.clip.durationMs - transition)) / transition))
        : 1;
    return {
      clip: current.clip,
      nextClip: next.clip,
      transitionProgress: progress,
      clipLocalMs: localMs,
      nextClipLocalMs: 0,
    };
  }
  return { ...EMPTY_FRAME, clip: current.clip, clipLocalMs: localMs };
}

export function resolveTimelineAt(timeline: Timeline, timestampMs: number): ResolvedFrame {
  return resolveClipsAt(timeline.clips, timeline.transitionMs, timestampMs);
}
