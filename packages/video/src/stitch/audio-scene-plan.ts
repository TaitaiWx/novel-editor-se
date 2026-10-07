/**
 * 样片的完整混音规划（纯函数，不依赖 WebAudio，单元测试覆盖）：
 *
 * - 成片原声：沿用 planAudioTimeline（与画面同一套片段起点 / 时长）
 * - 对白配音：放在「镜头起点 + startSec」；没写 startSec 的句子紧接上一句（间隔 DIALOGUE_GAP_MS）
 * - 音效：放在「镜头起点 + atSec」，按各自音量
 * - 背景音乐：循环铺满整条样片，首尾淡入淡出；开启压低时对白期间降低 DUCKING_DB（约 -12dB），
 *   进入 / 退出各有短渐变，避免抽吸感
 * - 环境音：循环铺满整条样片，按音量，不压低
 *
 * 输出的每一路声音（MixVoice）都带有绝对时间轴上的增益折线（GainPoint，点与点之间线性渐变），
 * 混音（audio-mix.ts mixScenePlan）只负责按规划把 AudioBuffer 放到 OfflineAudioContext 里。
 */
import { DUCKING_DB } from '../audio';
import { DEFAULT_AUDIO_EDGE_FADE_MS, planAudioTimeline } from './audio-plan';
import { clipStartTimes, timelineDurationMs } from './timeline';

export interface GainPoint {
  /** 样片时间轴上的绝对时间（毫秒） */
  timeMs: number;
  value: number;
}

export type MixVoiceKind = 'clip' | 'dialogue' | 'sfx' | 'bgm' | 'ambience';

export interface MixVoice {
  id: string;
  kind: MixVoiceKind;
  /** 声音素材的键（混音时用它取 AudioBuffer） */
  sourceId: string;
  startMs: number;
  /** 素材内的起点（毫秒） */
  offsetMs: number;
  durationMs: number;
  /** 素材比 durationMs 短时循环播放（配乐 / 环境音） */
  loop: boolean;
  /** 增益折线（时间递增，至少一个点） */
  gain: GainPoint[];
}

export interface SceneMixDialogue {
  id: string;
  sourceId: string;
  /** 相对镜头起点的秒数；缺省时紧接上一句 */
  startSec?: number;
  /** 配音素材长度（毫秒） */
  durationMs: number;
}

export interface SceneMixSfx {
  id: string;
  sourceId: string;
  atSec: number;
  /** 0..1 */
  volume: number;
  durationMs: number;
}

export interface SceneMixShot {
  id: string;
  /** 镜头在时间轴上的时长（毫秒，与画面一致） */
  durationMs: number;
  startMs?: number;
  /** 成片原声长度（毫秒），没有原声为 0 / 不填 */
  clipAudioDurationMs?: number;
  dialogue?: readonly SceneMixDialogue[];
  sfx?: readonly SceneMixSfx[];
}

export interface SceneMixLoop {
  sourceId: string;
  /** 素材长度（毫秒） */
  durationMs: number;
  /** 0..1 */
  volume: number;
}

export interface SceneMixBgm extends SceneMixLoop {
  fadeInMs: number;
  fadeOutMs: number;
}

export interface SceneMixInput {
  shots: readonly SceneMixShot[];
  /** 画面转场（毫秒） */
  transitionMs?: number;
  bgm?: SceneMixBgm | null;
  ambience?: SceneMixLoop | null;
  /** 对白时压低配乐，默认 true */
  ducking?: boolean;
  /** 压低的分贝数，默认 DUCKING_DB（-12） */
  duckDb?: number;
  /** 压低开始前 / 结束后的渐变（毫秒） */
  duckAttackMs?: number;
  duckReleaseMs?: number;
  /** 成片原声音量，默认 1 */
  clipVolume?: number;
  /** 对白音量，默认 1 */
  dialogueVolume?: number;
}

export interface TimeInterval {
  startMs: number;
  endMs: number;
}

export interface SceneMixPlan {
  durationMs: number;
  voices: MixVoice[];
  /** 对白所在区间（已合并），配乐在这些区间里被压低 */
  duckIntervals: TimeInterval[];
  hasAudio: boolean;
}

export const DIALOGUE_GAP_MS = 200;
export const DEFAULT_DUCK_ATTACK_MS = 150;
export const DEFAULT_DUCK_RELEASE_MS = 350;

/** 分贝 → 线性增益 */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

function positive(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

function unit(value: number | undefined, fallback = 1): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

/** 一段有限长声音的增益：首尾短淡入淡出，中间为 volume */
export function edgeEnvelope(
  startMs: number,
  durationMs: number,
  volume: number,
  edgeMs: number = DEFAULT_AUDIO_EDGE_FADE_MS,
  fadeOutMs: number = edgeMs
): GainPoint[] {
  const end = startMs + durationMs;
  const fadeIn = Math.min(edgeMs, durationMs / 2);
  const fadeOut = Math.min(fadeOutMs, durationMs / 2);
  return [
    { timeMs: startMs, value: fadeIn > 0 ? 0 : volume },
    { timeMs: startMs + fadeIn, value: volume },
    { timeMs: end - fadeOut, value: volume },
    { timeMs: end, value: fadeOut > 0 ? 0 : volume },
  ];
}

/** 折线在 t 处的值（两端外延取端点值） */
export function gainAt(points: readonly GainPoint[], timeMs: number): number {
  if (points.length === 0) return 1;
  if (timeMs <= points[0].timeMs) return points[0].value;
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const next = points[index];
    if (timeMs <= next.timeMs) {
      const span = next.timeMs - prev.timeMs;
      if (span <= 0) return next.value;
      return prev.value + ((next.value - prev.value) * (timeMs - prev.timeMs)) / span;
    }
  }
  return points[points.length - 1].value;
}

/** 合并重叠或间隔小于 gapMs 的区间（避免两句对白之间配乐来回抽动） */
export function mergeIntervals(intervals: readonly TimeInterval[], gapMs = 0): TimeInterval[] {
  const sorted = intervals
    .filter((item) => item.endMs > item.startMs)
    .map((item) => ({ ...item }))
    .sort((a, b) => a.startMs - b.startMs);
  const merged: TimeInterval[] = [];
  for (const item of sorted) {
    const last = merged[merged.length - 1];
    if (last && item.startMs <= last.endMs + gapMs) last.endMs = Math.max(last.endMs, item.endMs);
    else merged.push(item);
  }
  return merged;
}

export interface BgmEnvelopeInput {
  durationMs: number;
  volume: number;
  fadeInMs: number;
  fadeOutMs: number;
  duckIntervals: readonly TimeInterval[];
  /** 压低后的倍数（1 = 不压低） */
  duckGain: number;
  attackMs: number;
  releaseMs: number;
}

/**
 * 配乐增益折线 = 音量 × 淡入淡出 × 压低。两者都是分段线性函数，在所有转折点上取乘积，
 * 点与点之间线性渐变（与 WebAudio linearRampToValueAtTime 一致）。
 */
export function bgmGainEnvelope(input: BgmEnvelopeInput): GainPoint[] {
  const total = positive(input.durationMs);
  if (total <= 0) return [{ timeMs: 0, value: 0 }];
  const volume = unit(input.volume);
  const fadeIn = Math.min(positive(input.fadeInMs), total / 2);
  const fadeOut = Math.min(positive(input.fadeOutMs), total / 2);
  const fade: GainPoint[] = [
    { timeMs: 0, value: fadeIn > 0 ? 0 : 1 },
    { timeMs: fadeIn, value: 1 },
    { timeMs: total - fadeOut, value: 1 },
    { timeMs: total, value: fadeOut > 0 ? 0 : 1 },
  ];
  const duckGain = unit(input.duckGain);
  const duck: GainPoint[] = [{ timeMs: 0, value: 1 }];
  if (duckGain < 1) {
    for (const interval of input.duckIntervals) {
      const start = Math.max(0, interval.startMs);
      const end = Math.min(total, interval.endMs);
      if (end <= start) continue;
      duck.push(
        { timeMs: Math.max(0, start - positive(input.attackMs)), value: 1 },
        { timeMs: start, value: duckGain },
        { timeMs: end, value: duckGain },
        { timeMs: Math.min(total, end + positive(input.releaseMs)), value: 1 }
      );
    }
  }
  duck.push({ timeMs: total, value: gainAt(duck, total) });
  const times = Array.from(
    new Set([...fade, ...duck].map((point) => Math.min(total, Math.max(0, point.timeMs))))
  ).sort((a, b) => a - b);
  return times.map((timeMs) => ({
    timeMs,
    value: roundGain(volume * gainAt(fade, timeMs) * gainAt(duck, timeMs)),
  }));
}

function roundGain(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** 镜头内对白的起点（相对镜头，毫秒）：写了 startSec 用它，否则紧接上一句 */
export function scheduleDialogue(
  lines: readonly Pick<SceneMixDialogue, 'startSec' | 'durationMs'>[],
  gapMs: number = DIALOGUE_GAP_MS
): number[] {
  let cursor = 0;
  return lines.map((line) => {
    const start =
      line.startSec !== undefined && Number.isFinite(line.startSec) && line.startSec >= 0
        ? line.startSec * 1000
        : cursor;
    cursor = start + positive(line.durationMs) + gapMs;
    return start;
  });
}

/** 规划整条样片的混音 */
export function planSceneAudioMix(input: SceneMixInput): SceneMixPlan {
  const shots = input.shots;
  const starts = clipStartTimes(shots);
  const total = timelineDurationMs({ clips: shots });
  const voices: MixVoice[] = [];
  const edge = DEFAULT_AUDIO_EDGE_FADE_MS;

  // 成片原声
  const clipPlan = planAudioTimeline(
    shots.map((shot) => ({
      id: shot.id,
      durationMs: shot.durationMs,
      startMs: shot.startMs,
      audioDurationMs: shot.clipAudioDurationMs,
    })),
    { transitionMs: input.transitionMs }
  );
  const clipVolume = unit(input.clipVolume);
  for (const segment of clipPlan.segments) {
    voices.push({
      id: `clip:${segment.clipId}`,
      kind: 'clip',
      sourceId: segment.clipId,
      startMs: segment.startMs,
      offsetMs: segment.offsetMs,
      durationMs: segment.durationMs,
      loop: false,
      gain: edgeEnvelope(
        segment.startMs,
        segment.durationMs,
        clipVolume,
        segment.fadeInMs,
        segment.fadeOutMs
      ),
    });
  }

  // 对白与音效（超出样片结尾的部分截掉）
  const dialogueVolume = unit(input.dialogueVolume);
  const speech: TimeInterval[] = [];
  shots.forEach((shot, index) => {
    const shotStart = starts[index] ?? 0;
    const lines = (shot.dialogue ?? []).filter((line) => positive(line.durationMs) > 0);
    const offsets = scheduleDialogue(lines);
    lines.forEach((line, lineIndex) => {
      const startMs = shotStart + offsets[lineIndex];
      const durationMs = Math.min(positive(line.durationMs), total - startMs);
      if (!(durationMs > 0)) return;
      speech.push({ startMs, endMs: startMs + durationMs });
      voices.push({
        id: `dialogue:${shot.id}:${line.id}`,
        kind: 'dialogue',
        sourceId: line.sourceId,
        startMs,
        offsetMs: 0,
        durationMs,
        loop: false,
        gain: edgeEnvelope(startMs, durationMs, dialogueVolume, edge),
      });
    });
    for (const cue of shot.sfx ?? []) {
      const startMs = shotStart + Math.max(0, Number.isFinite(cue.atSec) ? cue.atSec : 0) * 1000;
      const durationMs = Math.min(positive(cue.durationMs), total - startMs);
      if (!(durationMs > 0)) continue;
      voices.push({
        id: `sfx:${shot.id}:${cue.id}`,
        kind: 'sfx',
        sourceId: cue.sourceId,
        startMs,
        offsetMs: 0,
        durationMs,
        loop: false,
        gain: edgeEnvelope(startMs, durationMs, unit(cue.volume, 0.8), edge),
      });
    }
  });

  const duckIntervals = mergeIntervals(speech, DEFAULT_DUCK_ATTACK_MS + DEFAULT_DUCK_RELEASE_MS);
  if (input.ambience && positive(input.ambience.durationMs) > 0 && total > 0) {
    voices.push({
      id: 'ambience',
      kind: 'ambience',
      sourceId: input.ambience.sourceId,
      startMs: 0,
      offsetMs: 0,
      durationMs: total,
      loop: input.ambience.durationMs < total,
      gain: edgeEnvelope(0, total, unit(input.ambience.volume, 0.4), 500, 1000),
    });
  }
  if (input.bgm && positive(input.bgm.durationMs) > 0 && total > 0) {
    const ducking = input.ducking !== false;
    voices.push({
      id: 'bgm',
      kind: 'bgm',
      sourceId: input.bgm.sourceId,
      startMs: 0,
      offsetMs: 0,
      durationMs: total,
      loop: input.bgm.durationMs < total,
      gain: bgmGainEnvelope({
        durationMs: total,
        volume: input.bgm.volume,
        fadeInMs: input.bgm.fadeInMs,
        fadeOutMs: input.bgm.fadeOutMs,
        duckIntervals: ducking ? duckIntervals : [],
        duckGain: ducking ? dbToGain(input.duckDb ?? DUCKING_DB) : 1,
        attackMs: input.duckAttackMs ?? DEFAULT_DUCK_ATTACK_MS,
        releaseMs: input.duckReleaseMs ?? DEFAULT_DUCK_RELEASE_MS,
      }),
    });
  }
  return { durationMs: total, voices, duckIntervals, hasAudio: voices.length > 0 };
}
