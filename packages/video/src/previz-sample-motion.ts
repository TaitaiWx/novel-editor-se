/**
 * 预演采样的第 2 版部分（纯函数）：缓动、动作（关节轨迹）交叉淡化、视线、手部目标、道具关键帧、机位绝对位置。
 * previz-sample.ts 的 samplePrevizScript 调用这里的函数，播放与导出共用，结果确定。
 */
import {
  PREVIZ_FRAMING,
  clampNumber,
  normalizeDegrees,
  type PrevizCameraKey,
  type PrevizEase,
  type PrevizFigureKey,
  type PrevizJointAngles,
  type PrevizLookAt,
  type PrevizPoint3,
  type PrevizPropItem,
  type PrevizPropKey,
} from './previz';
import {
  blendMotionPoses,
  sampleMotionTracks,
  type MotionBlend,
  type MotionJoint,
} from './motion/tracks';

const lerp = (a: number, b: number, s: number) => a + (b - a) * s;
const smoothstep = (s: number) => s * s * (3 - 2 * s);

/** 缓动函数：s ∈ [0, 1] */
export function applyEase(ease: PrevizEase | undefined, s: number, fallback: PrevizEase): number {
  const x = clampNumber(s, 0, 1);
  switch (ease ?? fallback) {
    case 'ease-in':
      return x * x;
    case 'ease-out':
      return 1 - (1 - x) * (1 - x);
    case 'ease-in-out':
      return smoothstep(x);
    default:
      return x;
  }
}

/** 两段动作之间的交叉淡化时长上限（秒） */
export const MOTION_CROSSFADE_SEC = 0.35;

/**
 * 人物在 t 时刻的动作：关键帧 a 的轨迹从 a.t 开始播放（时间相对 a.t），到下一关键帧前的最后 0.35 秒（不超过区间一半）
 * 交叉淡化到关键帧 b 的轨迹（从头开始）或 b 的姿势。各段的 weight 决定叠加在姿势上的程度。
 */
export function sampleFigureMotion(
  a: PrevizFigureKey,
  b: PrevizFigureKey,
  t: number
): MotionBlend | null {
  if (!a.motion?.tracks && !b.motion?.tracks) return null;
  const from = a.motion ? sampleMotionTracks(a.motion, t - a.t) : null;
  const fade = b === a ? 0 : Math.min(MOTION_CROSSFADE_SEC, (b.t - a.t) / 2);
  const mix = fade > 0 ? smoothstep(clampNumber((t - (b.t - fade)) / fade, 0, 1)) : 0;
  // b 没有动作时 to 为 null：a 的动作在区间末尾淡出到 b 的姿势
  const to = mix > 0 && b.motion ? sampleMotionTracks(b.motion, 0) : null;
  return blendMotionPoses(from, to, mix, {
    from: a.motion?.weight ?? 1,
    to: b.motion?.weight ?? 1,
  });
}

const LEG_JOINTS: readonly MotionJoint[] = [
  'leftThigh',
  'leftShin',
  'leftFoot',
  'rightThigh',
  'rightShin',
  'rightFoot',
];

/** 移动中（步态权重 > 0）时腿交给步态：动作片段对腿与髋部起伏的权重按步态减弱（边走边挥手） */
export function yieldLegsToGait(blend: MotionBlend | null, gait: number): MotionBlend | null {
  if (!blend || gait <= 0) return blend;
  const keep = 1 - clampNumber(gait, 0, 1);
  const joints = { ...blend.joints };
  for (const joint of LEG_JOINTS) {
    const entry = joints[joint];
    if (entry) joints[joint] = { q: entry.q, weight: entry.weight * keep };
  }
  return { joints, rootY: blend.rootY * keep };
}

/* ----------------------------- 视线 ----------------------------- */

/** 眼睛高度（米） */
const EYE_HEIGHT = 1.62;

export interface FigurePlacement {
  id: string;
  x: number;
  z: number;
  facing: number;
}

function lookTarget(
  lookAt: PrevizLookAt,
  figures: readonly FigurePlacement[]
): PrevizPoint3 | null {
  if ('figure' in lookAt) {
    const target = figures.find((item) => item.id === lookAt.figure);
    return target ? { x: target.x, y: 1.6, z: target.z } : null;
  }
  return lookAt;
}

/** 看向目标需要的胸 / 颈 / 头转角（度）：水平转角分给三段，俯仰分给颈和头，都有上限 */
export function gazeOffsets(
  self: FigurePlacement,
  lookAt: PrevizLookAt | undefined,
  figures: readonly FigurePlacement[]
): PrevizJointAngles | null {
  if (!lookAt) return null;
  const target = lookTarget(lookAt, figures);
  if (!target) return null;
  const dx = target.x - self.x;
  const dz = target.z - self.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.05) return null;
  const heading = (Math.atan2(dx, dz) * 180) / Math.PI;
  const yaw = normalizeDegrees(heading - self.facing);
  const pitch = (Math.atan2(target.y - EYE_HEIGHT, distance) * 180) / Math.PI;
  const share = (value: number, ratio: number, limit: number) =>
    clampNumber(value * ratio, -limit, limit);
  return {
    chest: [0, share(yaw, 0.2, 25), 0],
    neck: [share(-pitch, 0.3, 15), share(yaw, 0.3, 35), 0],
    head: [share(-pitch, 0.7, 35), share(yaw, 0.5, 60), 0],
  };
}

/** 两组关节角度按 s 混合（任一侧缺少时视为 0） */
export function mixJointAngles(
  a: PrevizJointAngles | null,
  b: PrevizJointAngles | null,
  s: number
): PrevizJointAngles | null {
  if (!a && !b) return null;
  const result: PrevizJointAngles = {};
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]) as Set<
    keyof PrevizJointAngles
  >;
  for (const joint of keys) {
    const x = a?.[joint] ?? [0, 0, 0];
    const y = b?.[joint] ?? [0, 0, 0];
    result[joint] = [lerp(x[0], y[0], s), lerp(x[1], y[1], s), lerp(x[2], y[2], s)];
  }
  return result;
}

export function addJointAngles(base: PrevizJointAngles, extra: PrevizJointAngles | null): void {
  if (!extra) return;
  for (const [joint, value] of Object.entries(extra) as [
    keyof PrevizJointAngles,
    [number, number, number],
  ][]) {
    const current = base[joint] ?? [0, 0, 0];
    base[joint] = [current[0] + value[0], current[1] + value[1], current[2] + value[2]];
  }
}

/* ----------------------------- 手部目标 ----------------------------- */

export interface HandTargetSample extends PrevizPoint3 {
  /** 0–1：IK 对手臂的影响程度 */
  weight: number;
}

export interface FigureHandsSample {
  left?: HandTargetSample;
  right?: HandTargetSample;
}

function mixPoint(
  a: PrevizPoint3 | undefined,
  b: PrevizPoint3 | undefined,
  s: number
): HandTargetSample | undefined {
  if (a && b)
    return { x: lerp(a.x, b.x, s), y: lerp(a.y, b.y, s), z: lerp(a.z, b.z, s), weight: 1 };
  if (a && s < 1) return { ...a, weight: 1 - s };
  if (b && s > 0) return { ...b, weight: s };
  return undefined;
}

export function sampleHands(
  a: PrevizFigureKey,
  b: PrevizFigureKey,
  s: number
): FigureHandsSample | undefined {
  if (!a.hands && !b.hands) return undefined;
  const left = mixPoint(a.hands?.left, b === a ? undefined : b.hands?.left, b === a ? 0 : s);
  const right = mixPoint(a.hands?.right, b === a ? undefined : b.hands?.right, b === a ? 0 : s);
  if (!left && !right) return undefined;
  return { ...(left ? { left } : {}), ...(right ? { right } : {}) };
}

/* ----------------------------- 道具 ----------------------------- */

export interface PrevizPropSample extends PrevizPropItem {
  y: number;
}

function keySegment<T extends { t: number }>(keys: readonly T[], t: number): [T, T, number] {
  const first = keys[0];
  if (keys.length === 1 || t <= first.t) return [first, first, 0];
  for (let index = 0; index < keys.length - 1; index += 1) {
    const a = keys[index];
    const b = keys[index + 1];
    if (t < b.t) {
      const span = b.t - a.t;
      return [a, b, span > 0 ? (t - a.t) / span : 1];
    }
  }
  const last = keys[keys.length - 1];
  return [last, last, 0];
}

function lerpAngle(a: number, b: number, s: number): number {
  let delta = (b - a) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return normalizeDegrees(a + delta * s);
}

/** 道具在 t 时刻的位置 / 朝向（没有关键帧时就是静止位置） */
export function samplePropItem(prop: PrevizPropItem, t: number): PrevizPropSample {
  const keys: PrevizPropKey[] | undefined = prop.keys;
  if (!keys || keys.length < 2) return { ...prop, y: prop.y ?? 0 };
  const [a, b, s] = keySegment(keys, t);
  const eased = applyEase(a.ease, s, 'ease-in-out');
  return {
    ...prop,
    x: lerp(a.x, b.x, eased),
    z: lerp(a.z, b.z, eased),
    y: lerp(a.y ?? 0, b.y ?? 0, eased),
    facing: lerpAngle(a.facing, b.facing, eased),
  };
}

/* ----------------------------- 机位 ----------------------------- */

export interface CameraOverride {
  position: [number, number, number];
  target: [number, number, number];
  /** 0–1：绝对机位相对景别推算机位的权重 */
  weight: number;
}

/** 绝对机位关键帧的注视点：target > 跟随 / focus / 人物中心（高度用景别注视高度） */
export function absoluteTarget(
  key: PrevizCameraKey,
  focus: { x: number; z: number }
): [number, number, number] {
  if (key.target) return [key.target.x, key.target.y, key.target.z];
  return [focus.x, PREVIZ_FRAMING[key.shotSize].targetY + key.height, focus.z];
}

export function cameraOverride(
  a: PrevizCameraKey,
  b: PrevizCameraKey,
  s: number,
  focusA: { x: number; z: number },
  focusB: { x: number; z: number }
): CameraOverride | undefined {
  const pa = a.position;
  const pb = b === a ? undefined : b.position;
  if (!pa && !pb) return undefined;
  const ta = absoluteTarget(a, focusA);
  const tb = absoluteTarget(b, focusB);
  const mix3 = (
    x: readonly [number, number, number],
    y: readonly [number, number, number],
    k: number
  ): [number, number, number] => [lerp(x[0], y[0], k), lerp(x[1], y[1], k), lerp(x[2], y[2], k)];
  if (pa && pb) {
    return {
      position: mix3([pa.x, pa.y, pa.z], [pb.x, pb.y, pb.z], s),
      target: mix3(ta, tb, s),
      weight: 1,
    };
  }
  if (pa) return { position: [pa.x, pa.y, pa.z], target: ta, weight: b === a ? 1 : 1 - s };
  const p = pb as PrevizPoint3;
  return { position: [p.x, p.y, p.z], target: tb, weight: s };
}
