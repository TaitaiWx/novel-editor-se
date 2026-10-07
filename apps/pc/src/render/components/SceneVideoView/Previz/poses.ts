/**
 * 3D 预演的人物姿势预设（纯数据）。
 *
 * 约定（与 mannequin.ts 一致）：人物面向 +Z，左手在 +X 一侧；肢体默认竖直向下。
 * - 绕 X 轴为负：肢体向前摆（抬腿 / 前举手臂）；为正：向后摆（屈膝时小腿向后）
 * - 绕 Z 轴：左臂 / 左腿为正向外展开，右臂 / 右腿为负向外展开
 * - 头 / 胸 / 腰绕 Y 轴为正：向人物自己的左侧转
 */

export type JointName =
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'leftUpperArm'
  | 'leftForearm'
  | 'leftHand'
  | 'rightUpperArm'
  | 'rightForearm'
  | 'rightHand'
  | 'leftThigh'
  | 'leftShin'
  | 'leftFoot'
  | 'rightThigh'
  | 'rightShin'
  | 'rightFoot';

/** 关节旋转（弧度，XYZ 欧拉角）；没写的关节保持自然站立 */
export type JointRotation = readonly [number, number, number];

export interface PosePreset {
  id: string;
  label: string;
  joints: Partial<Record<JointName, JointRotation>>;
  /** 髋部下移（米）：坐、蹲、跪、倒地 */
  drop?: number;
  /** 以髋部为轴的整体前倾（正）/ 后仰（负），弧度 */
  tilt?: number;
}

const D = Math.PI / 180;

/** 角度（度）→ 关节旋转（弧度） */
const r = (x: number, y = 0, z = 0): JointRotation => [x * D, y * D, z * D];

/** 站立时的髋关节高度（米），坐 / 跪的下移量按它和腿长推算 */
export const HIP_HEIGHT = 0.95;

export const POSE_PRESETS: readonly PosePreset[] = [
  {
    id: 'stand',
    label: '站立',
    joints: {
      leftUpperArm: r(0, 0, 6),
      rightUpperArm: r(0, 0, -6),
      leftForearm: r(-8),
      rightForearm: r(-8),
      leftThigh: r(0, 0, 3),
      rightThigh: r(0, 0, -3),
    },
  },
  {
    id: 'walk',
    label: '行走',
    drop: 0.04,
    joints: {
      chest: r(0, 6, 0),
      leftUpperArm: r(22, 0, 5),
      leftForearm: r(-12),
      rightUpperArm: r(-22, 0, -5),
      rightForearm: r(-25),
      leftThigh: r(-24),
      leftShin: r(8),
      leftFoot: r(-6),
      rightThigh: r(16),
      rightShin: r(28),
      rightFoot: r(10),
    },
  },
  {
    id: 'run',
    label: '奔跑',
    tilt: 12 * D,
    drop: 0.05,
    joints: {
      head: r(-10),
      chest: r(0, 10, 0),
      leftUpperArm: r(48, 0, 8),
      leftForearm: r(-85),
      rightUpperArm: r(-55, 0, -8),
      rightForearm: r(-90),
      leftThigh: r(-40),
      leftShin: r(30),
      leftFoot: r(-4),
      rightThigh: r(26),
      rightShin: r(85),
      rightFoot: r(25),
    },
  },
  {
    id: 'sit',
    label: '坐',
    drop: 0.44,
    joints: {
      spine: r(-4),
      head: r(4),
      leftThigh: r(-90, 0, 5),
      rightThigh: r(-90, 0, -5),
      leftShin: r(90),
      rightShin: r(90),
      leftUpperArm: r(-28, 0, 8),
      rightUpperArm: r(-28, 0, -8),
      leftForearm: r(-50),
      rightForearm: r(-50),
    },
  },
  {
    id: 'crouch',
    label: '蹲下',
    drop: 0.58,
    joints: {
      spine: r(22),
      chest: r(8),
      head: r(-25),
      leftThigh: r(-80, 0, 12),
      rightThigh: r(-80, 0, -12),
      leftShin: r(140),
      rightShin: r(140),
      leftFoot: r(-60),
      rightFoot: r(-60),
      leftUpperArm: r(-50, 0, 10),
      rightUpperArm: r(-50, 0, -10),
      leftForearm: r(-40),
      rightForearm: r(-40),
    },
  },
  {
    id: 'kneel',
    label: '跪地',
    drop: 0.45,
    joints: {
      head: r(6),
      leftThigh: r(-90, 0, 6),
      leftShin: r(90),
      rightThigh: r(0, 0, -4),
      rightShin: r(90),
      rightFoot: r(90),
      leftUpperArm: r(-35, 0, 6),
      leftForearm: r(-45),
      rightUpperArm: r(-5, 0, -8),
      rightForearm: r(-15),
    },
  },
  {
    id: 'draw-sword',
    label: '拔剑',
    drop: 0.02,
    joints: {
      chest: r(0, 18, 0),
      head: r(0, -14, 0),
      rightUpperArm: r(-40, 0, 32),
      rightForearm: r(-65),
      rightHand: r(0, 0, 20),
      leftUpperArm: r(-12, 0, 14),
      leftForearm: r(-55),
      leftThigh: r(-18, 0, 12),
      leftShin: r(20),
      rightThigh: r(12, 0, -12),
      rightShin: r(12),
    },
  },
  {
    id: 'face-off',
    label: '对峙',
    drop: 0.07,
    joints: {
      spine: r(8),
      head: r(-8),
      leftUpperArm: r(-55, 0, 22),
      leftForearm: r(-75),
      rightUpperArm: r(-40, 0, -24),
      rightForearm: r(-90),
      leftThigh: r(-26, 0, 10),
      leftShin: r(28),
      leftFoot: r(-4),
      rightThigh: r(18, 0, -10),
      rightShin: r(22),
    },
  },
  {
    id: 'point',
    label: '指向',
    joints: {
      chest: r(0, -12, 0),
      head: r(0, -10, 0),
      rightUpperArm: r(-86, 0, -12),
      rightForearm: r(-4),
      leftUpperArm: r(0, 0, 8),
      leftForearm: r(-10),
      leftThigh: r(-8, 0, 4),
      rightThigh: r(6, 0, -6),
    },
  },
  {
    id: 'talk',
    label: '交谈',
    joints: {
      head: r(-4, 8, 4),
      chest: r(0, 6, 0),
      rightUpperArm: r(-28, 0, -16),
      rightForearm: r(-72),
      rightHand: r(0, 0, -20),
      leftUpperArm: r(-6, 0, 10),
      leftForearm: r(-30),
      leftThigh: r(0, 0, 6),
      rightThigh: r(4, 0, -2),
      rightShin: r(8),
    },
  },
  {
    id: 'look-back',
    label: '回头',
    joints: {
      spine: r(0, 14, 0),
      chest: r(0, 24, 0),
      head: r(0, 55, 0),
      leftUpperArm: r(10, 0, 8),
      rightUpperArm: r(-10, 0, -8),
      leftForearm: r(-12),
      rightForearm: r(-12),
      leftThigh: r(-6, 0, 3),
      rightThigh: r(4, 0, -3),
    },
  },
  {
    id: 'embrace',
    label: '拥抱',
    joints: {
      head: r(8, 18, 0),
      leftUpperArm: r(-72, 0, 12),
      leftForearm: r(0, 0, -80),
      rightUpperArm: r(-72, 0, -12),
      rightForearm: r(0, 0, 80),
    },
  },
  {
    id: 'fallen',
    label: '倒地',
    drop: 0.84,
    tilt: -90 * D,
    joints: {
      head: r(0, 25, 0),
      leftUpperArm: r(0, 0, 62),
      rightUpperArm: r(0, 0, -70),
      leftForearm: r(-30),
      leftThigh: r(-10, 0, 10),
      leftShin: r(20),
      rightThigh: r(0, 0, -6),
    },
  },
];

export function poseById(id: string): PosePreset {
  return POSE_PRESETS.find((pose) => pose.id === id) ?? POSE_PRESETS[0];
}

/** 步态（迈步摆臂）影响的关节 */
export const GAIT_JOINTS: readonly JointName[] = [
  'leftUpperArm',
  'leftForearm',
  'rightUpperArm',
  'rightForearm',
  'leftThigh',
  'leftShin',
  'leftFoot',
  'rightThigh',
  'rightShin',
  'rightFoot',
];

/**
 * 步态周期里的关节角度（弧度）：phase 随走过的距离增长（2π = 左右各一步）。
 * 左腿向前时右臂向前（对侧摆臂）；腿向前摆的半个周期里膝盖弯曲（抬脚），落地后伸直。
 */
export function gaitJoints(
  kind: 'walk' | 'run',
  phase: number
): Partial<Record<JointName, JointRotation>> {
  const swing = Math.sin(phase);
  const lift = Math.cos(phase);
  const run = kind === 'run';
  const thigh = run ? 42 : 24;
  const arm = run ? 48 : 20;
  const knee = run ? 75 : 32;
  const kneeBase = run ? 22 : 5;
  const forearm = run ? -88 : -14;
  return {
    leftThigh: r(-thigh * swing, 0, 3),
    rightThigh: r(thigh * swing, 0, -3),
    leftShin: r(kneeBase + knee * Math.max(0, lift)),
    rightShin: r(kneeBase + knee * Math.max(0, -lift)),
    leftFoot: r(-8 * Math.max(0, lift)),
    rightFoot: r(-8 * Math.max(0, -lift)),
    leftUpperArm: r(arm * swing, 0, 6),
    rightUpperArm: r(-arm * swing, 0, -6),
    leftForearm: r(forearm),
    rightForearm: r(forearm),
  };
}
