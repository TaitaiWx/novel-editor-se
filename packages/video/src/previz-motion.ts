/**
 * 预演动作（AI 实时生成的关节动画）契约：人物关键帧上的 motion 由文本模型直接写出关节轨迹，
 * 不依赖任何动作文件。
 *
 * - tracks：关节名 → 关键帧数组 [t, rx, ry, rz]（t 为相对这一段起点的秒数；角度为度，three.js XYZ 欧拉角，
 *   表示关节相对「自然站立、手臂下垂」的绝对局部旋转），引擎用三次 Hermite（Catmull-Rom 切线）平滑采样，
 *   并夹在关节活动范围内
 * - rootBob：髋部竖直起伏 [t, 米]（负 = 下沉）；lean：整体前倾 [t, 度]（正 = 前倾，负 = 后仰）
 * - loop：轨迹按最长轨迹的时长循环；weight：叠加在姿势之上的权重（0–1，默认 1）
 * - generate：动作描述。文本模型觉得动作太复杂时只写描述，由 MotionProvider 或一次追加的 AI 请求生成轨迹，
 *   生成结果写回 tracks（描述保留，作为缓存标记：有 tracks 时不再生成）
 *
 * 关节约定（与 mannequin / poses 一致）：人物面向 +Z，左手在 +X 一侧；肢体默认竖直向下。
 * 绕 X 为负 = 肢体向前抬（躯干 / 头绕 X 为正 = 前倾 / 低头）；左臂 / 左腿绕 Z 为正 = 向外展开，右侧为负；
 * 头 / 胸 / 腰绕 Y 为正 = 向人物自己的左侧转。
 *
 * 这里只引入 previz.ts 的类型（previz.ts 引入本文件的 schema 值），避免运行时循环依赖。
 */
import type { PrevizJoint } from './previz';

/** 一个关节关键帧：[t（秒，相对这一段起点）, rx, ry, rz（度）] */
export type PrevizMotionKey = [number, number, number, number];
/** 单值曲线关键帧：[t, 值] */
export type PrevizMotionCurveKey = [number, number];

export type PrevizMotionTrackMap = Partial<Record<PrevizJoint, PrevizMotionKey[]>>;

/** 关节轨迹（MotionProvider / 追加请求的输出，与脚本里 motion 的轨迹部分相同） */
export interface PrevizMotionTracks {
  tracks: PrevizMotionTrackMap;
  rootBob?: PrevizMotionCurveKey[];
  lean?: PrevizMotionCurveKey[];
  loop?: boolean;
}

/** 人物关键帧上的动作：从这一帧开始播放，到下一关键帧前交叉淡化 */
export interface PrevizMotion extends Partial<PrevizMotionTracks> {
  /** 叠加在姿势之上的权重（0–1，默认 1） */
  weight?: number;
  /** 动作描述：还没有轨迹时交给 MotionProvider / 追加 AI 请求生成 */
  generate?: string;
}

/** 校验上限：一个动作最多 24 个关节、每个关节 120 个关键帧、合计 600 个关键帧；整个脚本合计 3000 个 */
export const PREVIZ_MOTION_MAX_JOINTS = 24;
export const PREVIZ_MOTION_MAX_KEYS = 120;
export const PREVIZ_MOTION_MAX_TOTAL_KEYS = 600;
export const PREVIZ_SCRIPT_MAX_MOTION_KEYS = 3000;
/** 轨迹时间上限（秒） */
export const PREVIZ_MOTION_MAX_SEC = 10;
export const PREVIZ_MOTION_PROMPT_MAX = 200;
/** 髋部起伏范围（米）与整体前倾范围（度） */
export const PREVIZ_ROOT_BOB_RANGE: readonly [number, number] = [-0.9, 0.5];
export const PREVIZ_LEAN_RANGE: readonly [number, number] = [-60, 90];

type Range = readonly [number, number];
export type PrevizJointRange = readonly [Range, Range, Range];

/** 各关节的活动范围（度，[x, y, z]），轨迹采样与校验都夹在这里 */
export const PREVIZ_JOINT_RANGES: Readonly<Record<PrevizJoint, PrevizJointRange>> = {
  spine: [
    [-30, 60],
    [-45, 45],
    [-30, 30],
  ],
  chest: [
    [-30, 45],
    [-45, 45],
    [-30, 30],
  ],
  neck: [
    [-40, 50],
    [-60, 60],
    [-30, 30],
  ],
  head: [
    [-45, 45],
    [-80, 80],
    [-35, 35],
  ],
  leftUpperArm: [
    [-180, 60],
    [-90, 90],
    [-30, 180],
  ],
  leftForearm: [
    [-150, 10],
    [-90, 90],
    [-45, 45],
  ],
  leftHand: [
    [-80, 80],
    [-90, 90],
    [-60, 60],
  ],
  rightUpperArm: [
    [-180, 60],
    [-90, 90],
    [-180, 30],
  ],
  rightForearm: [
    [-150, 10],
    [-90, 90],
    [-45, 45],
  ],
  rightHand: [
    [-80, 80],
    [-90, 90],
    [-60, 60],
  ],
  leftThigh: [
    [-120, 45],
    [-45, 45],
    [-30, 90],
  ],
  leftShin: [
    [0, 150],
    [-10, 10],
    [-10, 10],
  ],
  leftFoot: [
    [-50, 50],
    [-30, 30],
    [-30, 30],
  ],
  rightThigh: [
    [-120, 45],
    [-45, 45],
    [-90, 30],
  ],
  rightShin: [
    [0, 150],
    [-10, 10],
    [-10, 10],
  ],
  rightFoot: [
    [-50, 50],
    [-30, 30],
    [-30, 30],
  ],
};

/** 关节角度夹到活动范围内 */
export function clampJointAngles(
  joint: PrevizJoint,
  angles: readonly [number, number, number]
): [number, number, number] {
  const range = PREVIZ_JOINT_RANGES[joint];
  return [0, 1, 2].map((axis) =>
    Math.max(range[axis][0], Math.min(range[axis][1], angles[axis]))
  ) as [number, number, number];
}

const KEY_ARRAY = {
  type: 'array',
  maxItems: PREVIZ_MOTION_MAX_KEYS,
  items: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
} as const;

const CURVE_ARRAY = {
  type: 'array',
  maxItems: PREVIZ_MOTION_MAX_KEYS,
  items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
} as const;

/** motion 里轨迹部分的 JSON Schema（预演脚本与追加请求共用） */
export function previzMotionTracksSchema(joints: readonly string[]) {
  return {
    tracks: {
      type: 'object',
      description:
        'joint -> keys [t, rx, ry, rz]; t = seconds from this key, angles in degrees (absolute local rotation from neutral standing, arms down)',
      properties: Object.fromEntries(joints.map((joint) => [joint, KEY_ARRAY])),
    },
    rootBob: { ...CURVE_ARRAY, description: 'hip vertical offset keys [t, meters]' },
    lean: { ...CURVE_ARRAY, description: 'whole-body forward lean keys [t, degrees]' },
    loop: { type: 'boolean', description: 'repeat the tracks (last key should equal the first)' },
  } as const;
}
