/**
 * 样片声音的时间轴规划（纯函数，不依赖 WebAudio）：
 * 每个片段的声音与画面用同一套起点 / 时长（`clipStartTimes`），从片段入点开始播放，
 * 不超过片段时长，也不超过声音本身的长度；没有声音的片段不产生分段（混音时即为静音）。
 * 每段首尾做短淡入淡出防止爆音；紧接下一片段时，淡出长度与画面转场一致。
 */
import { clipStartTimes, timelineDurationMs } from './timeline';

export interface AudioClipInput {
  id: string;
  /** 片段在时间轴上的时长（毫秒，与画面相同） */
  durationMs: number;
  /** 片段起点（毫秒），缺省时顺序累加（与画面相同） */
  startMs?: number;
  /** 片段素材的声音长度（毫秒）；没有音轨时为 0 或不填 */
  audioDurationMs?: number;
  /** 素材入点（毫秒），默认 0 */
  inPointMs?: number;
}

export interface AudioSegment {
  clipId: string;
  /** 在样片时间轴上的起点（毫秒） */
  startMs: number;
  /** 在素材声音里的起点（毫秒） */
  offsetMs: number;
  durationMs: number;
  fadeInMs: number;
  fadeOutMs: number;
}

export interface AudioTimelinePlan {
  /** 整条声音的时长（与画面时间轴一致，结尾不足处补静音） */
  durationMs: number;
  segments: AudioSegment[];
  /** 是否至少有一个片段带声音 */
  hasAudio: boolean;
}

export interface AudioPlanOptions {
  /** 画面转场时长（毫秒），紧接下一片段时用作淡出长度 */
  transitionMs?: number;
  /** 防爆音的最短淡入 / 淡出（毫秒），默认 10 */
  edgeFadeMs?: number;
}

export const DEFAULT_AUDIO_EDGE_FADE_MS = 10;

function finiteNonNegative(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

export function planAudioTimeline(
  clips: readonly AudioClipInput[],
  options: AudioPlanOptions = {}
): AudioTimelinePlan {
  const edgeFade = finiteNonNegative(options.edgeFadeMs ?? DEFAULT_AUDIO_EDGE_FADE_MS);
  const transition = finiteNonNegative(options.transitionMs);
  const starts = clipStartTimes(clips);
  const durationMs = timelineDurationMs({ clips });
  const segments: AudioSegment[] = [];

  clips.forEach((clip, index) => {
    const startMs = starts[index] ?? 0;
    const clipDuration = finiteNonNegative(clip.durationMs);
    const offsetMs = finiteNonNegative(clip.inPointMs);
    const available = finiteNonNegative(clip.audioDurationMs) - offsetMs;
    const length = Math.min(clipDuration, available);
    if (!(length > 0)) return;
    // 声音一直播到片段末尾、且下一片段紧接着开始时，按转场长度淡出
    const reachesEnd = length >= clipDuration;
    const nextStart = starts[index + 1];
    const adjacent = nextStart !== undefined && Math.abs(nextStart - (startMs + clipDuration)) < 1;
    const half = length / 2;
    const fadeOut = Math.min(
      half,
      reachesEnd && adjacent ? Math.max(edgeFade, transition) : edgeFade
    );
    segments.push({
      clipId: clip.id,
      startMs,
      offsetMs,
      durationMs: length,
      fadeInMs: Math.min(half, edgeFade),
      fadeOutMs: fadeOut,
    });
  });

  return { durationMs, segments, hasAudio: segments.length > 0 };
}
