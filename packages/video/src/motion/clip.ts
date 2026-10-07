/**
 * 动作片段采样（纯函数）：任意时刻的关节旋转（帧间球面插值）与髋部起伏，支持起点 / 速度 / 循环。
 * 预演采样（previz-sample.ts）用它把关键帧引用的动作片段叠到人物上，两段动作之间做交叉淡化。
 */
import { quatSlerp, type Quat } from './quat';
import { MOTION_JOINTS, type MotionClip, type MotionJoint } from './retarget';

export interface MotionPose {
  joints: Partial<Record<MotionJoint, Quat>>;
  /** 髋部竖直起伏（米） */
  rootY: number;
}

export interface MotionPlayback {
  /** 片段内的起点（秒） */
  start?: number;
  /** 播放速度（1 = 原速） */
  speed?: number;
  /** 循环播放；不循环时停在最后一帧 */
  loop?: boolean;
}

/** 片段本地时间：elapsed 为从动作开始算起的秒数 */
export function motionClipTime(
  clip: Pick<MotionClip, 'durationSec'>,
  elapsed: number,
  playback: MotionPlayback = {}
): number {
  const duration = Math.max(1e-6, clip.durationSec);
  const raw = (playback.start ?? 0) + Math.max(0, elapsed) * (playback.speed ?? 1);
  if (playback.loop) return ((raw % duration) + duration) % duration;
  return Math.max(0, Math.min(duration, raw));
}

function readQuat(track: Float32Array, frame: number): Quat {
  const i = frame * 4;
  return [track[i], track[i + 1], track[i + 2], track[i + 3]];
}

/** 片段在 elapsed 秒时的姿势 */
export function sampleMotionClip(
  clip: MotionClip,
  elapsed: number,
  playback: MotionPlayback = {}
): MotionPose {
  const time = motionClipTime(clip, elapsed, playback);
  const position = clip.frameCount > 1 ? time / clip.frameTime : 0;
  const lastFrame = clip.frameCount - 1;
  let a = Math.min(lastFrame, Math.floor(position));
  let b = Math.min(lastFrame, a + 1);
  let s = Math.max(0, Math.min(1, position - a));
  // 循环时最后一帧之后回到第一帧
  if (playback.loop && a === lastFrame && clip.frameCount > 1) {
    b = 0;
  } else if (a === lastFrame) {
    b = a;
    s = 0;
  }
  if (a < 0) a = 0;
  const joints: Partial<Record<MotionJoint, Quat>> = {};
  for (const joint of MOTION_JOINTS) {
    const track = clip.rotations[joint];
    if (!track) continue;
    joints[joint] = quatSlerp(readQuat(track, a), readQuat(track, b), s);
  }
  const rootY = clip.rootY[a] + (clip.rootY[b] - clip.rootY[a]) * s;
  return { joints, rootY: Number.isFinite(rootY) ? rootY : 0 };
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

/**
 * 两段动作交叉淡化：mix = 0 只有 from，1 只有 to；任一侧缺少某个关节时，那个关节按另一侧的权重淡入 / 淡出
 * （权重不足的部分由预设姿势补上）。
 */
export function blendMotionPoses(
  from: MotionPose | null,
  to: MotionPose | null,
  mix: number
): MotionBlend | null {
  if (!from && !to) return null;
  const s = Math.max(0, Math.min(1, mix));
  const joints: Partial<Record<MotionJoint, WeightedMotionJoint>> = {};
  for (const joint of MOTION_JOINTS) {
    const a = from?.joints[joint];
    const b = to?.joints[joint];
    if (a && b) joints[joint] = { q: quatSlerp(a, b, s), weight: 1 };
    else if (a && s < 1) joints[joint] = { q: a, weight: 1 - s };
    else if (b && s > 0) joints[joint] = { q: b, weight: s };
  }
  const rootY = (from?.rootY ?? 0) * (1 - s) + (to?.rootY ?? 0) * s;
  return { joints, rootY };
}

/** 动作库（按 id 查找片段） */
export type MotionLibrary = ReadonlyMap<string, MotionClip>;
