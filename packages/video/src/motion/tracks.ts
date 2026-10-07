/**
 * 关节轨迹采样（纯函数）：AI 写的 motion.tracks 在任意时刻的关节旋转、髋部起伏与前倾。
 *
 * - 每个分量用三次 Hermite 插值，切线按 Catmull-Rom（非均匀时间的中心差分），首尾切线为 0（不冲出端点）；
 *   loop 时首尾按周期接上，切线也跨周期计算
 * - 插值结果再夹到关节活动范围（Hermite 在关键帧之间可能略微过冲）
 * - 欧拉角（度，three.js XYZ）转成四元数，交给引擎按权重球面插值到姿势上；两段动作之间交叉淡化
 */
import { PREVIZ_JOINTS, type PrevizJoint } from '../previz';
import {
  PREVIZ_JOINT_RANGES,
  PREVIZ_LEAN_RANGE,
  PREVIZ_ROOT_BOB_RANGE,
  type PrevizMotion,
} from '../previz-motion';
import { quatFromAxisAngle, quatFromEulerXYZ, quatSlerp, type Quat } from './quat';

/** 动作驱动的关节：预演关节 + 髋部（整体前倾） */
export type MotionJoint = 'hips' | PrevizJoint;
export const MOTION_JOINTS: readonly MotionJoint[] = ['hips', ...PREVIZ_JOINTS];

export interface MotionPose {
  joints: Partial<Record<MotionJoint, Quat>>;
  /** 髋部竖直起伏（米） */
  rootY: number;
}

export interface WeightedMotionJoint {
  q: Quat;
  /** 动作对这个关节的权重（0 = 完全用预设姿势，1 = 完全用动作） */
  weight: number;
}

export interface MotionBlend {
  joints: Partial<Record<MotionJoint, WeightedMotionJoint>>;
  rootY: number;
}

const DEG = Math.PI / 180;

/** 动作时长：所有轨迹最后一个关键帧的最大时间 */
export function motionDuration(motion: PrevizMotion): number {
  let duration = 0;
  for (const keys of Object.values(motion.tracks ?? {})) {
    if (keys?.length) duration = Math.max(duration, keys[keys.length - 1][0]);
  }
  for (const keys of [motion.rootBob, motion.lean]) {
    if (keys?.length) duration = Math.max(duration, keys[keys.length - 1][0]);
  }
  return duration;
}

function hermite(p0: number, p1: number, m0: number, m1: number, span: number, s: number) {
  const s2 = s * s;
  const s3 = s2 * s;
  return (
    (2 * s3 - 3 * s2 + 1) * p0 +
    (s3 - 2 * s2 + s) * span * m0 +
    (-2 * s3 + 3 * s2) * p1 +
    (s3 - s2) * span * m1
  );
}

/**
 * 关键帧 keys（[t, v0, v1, …]，按时间排序）在 time 时的各分量值。
 * period > 0 表示循环：time 已取模，最后一帧之后经过 (period - last.t + first.t) 回到第一帧。
 */
export function sampleKeyValues(
  keys: readonly (readonly number[])[],
  time: number,
  period = 0
): number[] {
  const width = keys[0].length - 1;
  const value = (key: readonly number[], index: number) => key[index + 1];
  if (keys.length === 1) return keys[0].slice(1);
  const n = keys.length;
  const loop = period > 0;
  // 循环时把关键帧看成无限重复的序列：第 i 个（可以越界）的时间与值
  const at = (i: number): { t: number; key: readonly number[] } => {
    if (!loop) {
      const clamped = Math.max(0, Math.min(n - 1, i));
      return { t: keys[clamped][0], key: keys[clamped] };
    }
    const wrap = Math.floor(i / n);
    const key = keys[((i % n) + n) % n];
    return { t: key[0] + wrap * period, key };
  };
  let local = time;
  if (!loop) {
    if (local <= keys[0][0]) return keys[0].slice(1);
    if (local >= keys[n - 1][0]) return keys[n - 1].slice(1);
  } else if (local < keys[0][0]) {
    local += period;
  }
  // 找到 local 所在的区间 [i, i + 1]
  let i = 0;
  while (i < 2 * n && at(i + 1).t <= local) i += 1;
  const a = at(i);
  const b = at(i + 1);
  const span = b.t - a.t;
  if (!(span > 1e-9)) return b.key.slice(1);
  const s = Math.max(0, Math.min(1, (local - a.t) / span));
  const tangent = (index: number, axis: number) => {
    if (!loop && (index <= 0 || index >= n - 1)) return 0;
    const prev = at(index - 1);
    const next = at(index + 1);
    const dt = next.t - prev.t;
    return dt > 1e-9 ? (value(next.key, axis) - value(prev.key, axis)) / dt : 0;
  };
  const result: number[] = [];
  for (let axis = 0; axis < width; axis += 1) {
    result.push(
      hermite(
        value(a.key, axis),
        value(b.key, axis),
        tangent(i, axis),
        tangent(i + 1, axis),
        span,
        s
      )
    );
  }
  return result;
}

const clamp = (value: number, range: readonly [number, number]) =>
  Math.max(range[0], Math.min(range[1], value));

/** 动作在 elapsed 秒（相对这一段起点）时的姿势；没有任何轨迹时为 null */
export function sampleMotionTracks(motion: PrevizMotion, elapsed: number): MotionPose | null {
  const duration = motionDuration(motion);
  const period = motion.loop && duration > 0 ? duration : 0;
  const raw = Math.max(0, Number.isFinite(elapsed) ? elapsed : 0);
  const time = period > 0 ? raw % period : raw;
  const joints: Partial<Record<MotionJoint, Quat>> = {};
  let any = false;
  for (const joint of PREVIZ_JOINTS) {
    const keys = motion.tracks?.[joint];
    if (!keys?.length) continue;
    const range = PREVIZ_JOINT_RANGES[joint];
    const [x, y, z] = sampleKeyValues(keys, time, period).map((angle, axis) =>
      clamp(angle, range[axis])
    );
    joints[joint] = quatFromEulerXYZ(x * DEG, y * DEG, z * DEG);
    any = true;
  }
  if (motion.lean?.length) {
    const lean = clamp(sampleKeyValues(motion.lean, time, period)[0], PREVIZ_LEAN_RANGE);
    joints.hips = quatFromAxisAngle('x', lean * DEG);
    any = true;
  }
  let rootY = 0;
  if (motion.rootBob?.length) {
    rootY = clamp(sampleKeyValues(motion.rootBob, time, period)[0], PREVIZ_ROOT_BOB_RANGE);
    any = true;
  }
  return any ? { joints, rootY } : null;
}

/**
 * 两段动作交叉淡化：mix = 0 只有 from，1 只有 to；weights 是两段各自的叠加权重。
 * 任一侧缺少某个关节时，那个关节按另一侧的权重淡入 / 淡出（不足的部分由姿势补上）。
 */
export function blendMotionPoses(
  from: MotionPose | null,
  to: MotionPose | null,
  mix: number,
  weights: { from?: number; to?: number } = {}
): MotionBlend | null {
  if (!from && !to) return null;
  const s = Math.max(0, Math.min(1, mix));
  const wa = (weights.from ?? 1) * (1 - s);
  const wb = (weights.to ?? 1) * s;
  const joints: Partial<Record<MotionJoint, WeightedMotionJoint>> = {};
  for (const joint of MOTION_JOINTS) {
    const a = from?.joints[joint];
    const b = to?.joints[joint];
    if (a && b) {
      const total = wa + wb;
      if (total > 0) joints[joint] = { q: quatSlerp(a, b, wb / total), weight: total };
    } else if (a && wa > 0) joints[joint] = { q: a, weight: wa };
    else if (b && wb > 0) joints[joint] = { q: b, weight: wb };
  }
  const rootY = (from?.rootY ?? 0) * wa + (to?.rootY ?? 0) * wb;
  return { joints, rootY };
}
