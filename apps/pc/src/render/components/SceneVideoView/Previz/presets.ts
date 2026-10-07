/**
 * 3D 预演（摆拍）的预设：人物姿势与机位。纯数据 + 纯函数，便于测试；渲染在 Previz/stage.ts。
 *
 * 只管构图：站位、朝向、姿势和镜头远近 / 角度，截图后作为生成首帧图的构图参考，不导出动作视频。
 */

/** 关节旋转（弧度，XYZ 欧拉角）；没写的关节保持站立姿势 */
export type JointName =
  | 'spine'
  | 'head'
  | 'leftUpperArm'
  | 'leftForearm'
  | 'rightUpperArm'
  | 'rightForearm'
  | 'leftThigh'
  | 'leftShin'
  | 'rightThigh'
  | 'rightShin';

export type JointRotation = readonly [number, number, number];

export interface PosePreset {
  id: string;
  label: string;
  joints: Partial<Record<JointName, JointRotation>>;
  /** 身体整体下移（坐 / 倒地） */
  drop?: number;
  /** 身体整体前倾 / 倒地（绕 X 轴） */
  tilt?: number;
}

const D = Math.PI / 180;

export const POSE_PRESETS: readonly PosePreset[] = [
  {
    id: 'stand',
    label: '站立',
    joints: { leftUpperArm: [0, 0, 8 * D], rightUpperArm: [0, 0, -8 * D] },
  },
  {
    id: 'walk',
    label: '行走',
    joints: {
      leftUpperArm: [25 * D, 0, 6 * D],
      rightUpperArm: [-25 * D, 0, -6 * D],
      leftThigh: [-25 * D, 0, 0],
      rightThigh: [25 * D, 0, 0],
      rightShin: [20 * D, 0, 0],
    },
  },
  {
    id: 'run',
    label: '奔跑',
    tilt: 12 * D,
    joints: {
      leftUpperArm: [50 * D, 0, 8 * D],
      leftForearm: [-70 * D, 0, 0],
      rightUpperArm: [-50 * D, 0, -8 * D],
      rightForearm: [-70 * D, 0, 0],
      leftThigh: [-55 * D, 0, 0],
      leftShin: [60 * D, 0, 0],
      rightThigh: [35 * D, 0, 0],
      rightShin: [70 * D, 0, 0],
    },
  },
  {
    id: 'sit',
    label: '坐',
    drop: 0.42,
    joints: {
      leftThigh: [-90 * D, 0, 0],
      rightThigh: [-90 * D, 0, 0],
      leftShin: [90 * D, 0, 0],
      rightShin: [90 * D, 0, 0],
      leftUpperArm: [-20 * D, 0, 8 * D],
      rightUpperArm: [-20 * D, 0, -8 * D],
    },
  },
  {
    id: 'draw-sword',
    label: '拔剑',
    joints: {
      rightUpperArm: [-150 * D, 0, -10 * D],
      rightForearm: [-10 * D, 0, 0],
      leftUpperArm: [-20 * D, 0, 20 * D],
      leftThigh: [-15 * D, 0, 0],
      rightThigh: [15 * D, 0, 0],
    },
  },
  {
    id: 'face-off',
    label: '对峙',
    joints: {
      spine: [10 * D, 0, 0],
      leftUpperArm: [-60 * D, 0, 20 * D],
      leftForearm: [-40 * D, 0, 0],
      rightUpperArm: [-60 * D, 0, -20 * D],
      rightForearm: [-40 * D, 0, 0],
      leftThigh: [-20 * D, 0, 10 * D],
      rightThigh: [20 * D, 0, -10 * D],
    },
  },
  {
    id: 'embrace',
    label: '拥抱',
    joints: {
      leftUpperArm: [-80 * D, 0, -30 * D],
      leftForearm: [0, -60 * D, 0],
      rightUpperArm: [-80 * D, 0, 30 * D],
      rightForearm: [0, 60 * D, 0],
    },
  },
  {
    id: 'fallen',
    label: '倒地',
    drop: 0.82,
    tilt: -88 * D,
    joints: {
      leftUpperArm: [0, 0, 70 * D],
      rightUpperArm: [0, 0, -70 * D],
      leftThigh: [0, 0, 10 * D],
      rightThigh: [0, 0, -10 * D],
    },
  },
];

export function poseById(id: string): PosePreset {
  return POSE_PRESETS.find((pose) => pose.id === id) ?? POSE_PRESETS[0];
}

/** 机位：景别决定镜头距离与高度；角度决定俯仰 */
export interface CameraPreset {
  distance: number;
  height: number;
  fov: number;
}

export const SHOT_CAMERA: Record<string, CameraPreset> = {
  大远景: { distance: 16, height: 6, fov: 50 },
  远景: { distance: 11, height: 3.2, fov: 45 },
  全景: { distance: 6.5, height: 1.6, fov: 40 },
  中景: { distance: 4, height: 1.45, fov: 38 },
  近景: { distance: 2.4, height: 1.55, fov: 34 },
  特写: { distance: 1.3, height: 1.62, fov: 30 },
  大特写: { distance: 0.8, height: 1.65, fov: 28 },
};

export type CameraAngle = 'eye' | 'high' | 'low';

export const CAMERA_ANGLES: ReadonlyArray<{ id: CameraAngle; label: string }> = [
  { id: 'eye', label: '平视' },
  { id: 'high', label: '俯视' },
  { id: 'low', label: '仰视' },
];

/** 由景别 + 角度得到相机位置与注视点（人物在原点附近，相机在 +Z 方向） */
export function cameraPlacement(
  shotSize: string,
  angle: CameraAngle
): { position: [number, number, number]; target: [number, number, number]; fov: number } {
  const preset = SHOT_CAMERA[shotSize] ?? SHOT_CAMERA['中景'];
  const targetY = Math.min(1.6, Math.max(0.9, preset.height));
  const lift =
    angle === 'high' ? preset.distance * 0.55 : angle === 'low' ? -preset.height * 0.75 : 0;
  return {
    position: [0, Math.max(0.15, preset.height + lift), preset.distance],
    target: [0, targetY, 0],
    fov: preset.fov,
  };
}

export interface PrevizFigure {
  id: string;
  name: string;
  x: number;
  z: number;
  /** 朝向（弧度，0 = 面向镜头） */
  rotation: number;
  pose: string;
  color: string;
}

const FIGURE_COLORS = ['#c9a27a', '#8fb3d9', '#a9c79a', '#d4a5c0', '#c7c08a', '#9fb0c9'];

/** 默认站位：人物沿 X 轴一字排开、面向镜头，间距 0.9 米 */
export function defaultFigures(names: readonly string[]): PrevizFigure[] {
  const list = names.length ? names : ['人物'];
  const spacing = 0.9;
  const start = (-(list.length - 1) * spacing) / 2;
  return list.map((name, index) => ({
    id: `f${index + 1}`,
    name,
    x: Math.round((start + index * spacing) * 100) / 100,
    z: 0,
    rotation: 0,
    pose: 'stand',
    color: FIGURE_COLORS[index % FIGURE_COLORS.length],
  }));
}

/** 地面范围（米）：拖动人物时限制在这个范围内 */
export const STAGE_LIMIT = 8;

export function clampToStage(value: number): number {
  return Math.max(-STAGE_LIMIT, Math.min(STAGE_LIMIT, Math.round(value * 100) / 100));
}
