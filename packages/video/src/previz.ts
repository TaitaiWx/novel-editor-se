/**
 * 3D 预演脚本（PrevizScript）：一个镜头的「走位 + 机位」动画，交给确定性的 three.js 引擎逐帧渲染。
 *
 * 这是 AI（或将来的其他工具）与预演引擎之间的契约：
 * - AI 按 PREVIZ_JSON_SCHEMA 输出人物关键帧（时间、站位、朝向、姿势、可选关节微调）、机位关键帧、道具与时段
 * - validatePrevizScript（previz-validate.ts）宽松解析（容忍字段别名、字符串数字），把所有数值夹到安全范围，未知姿势回退站立
 * - 插值 / 默认脚本 / 微调在 previz-sample.ts（纯函数）
 *
 * 坐标约定（米）：地面为 x / z 平面，默认机位在 +z 方向看向原点；x 正 = 画面右侧，z 正 = 靠近镜头。
 * 朝向 facing（度）：0 = 面向镜头，90 = 面向画面右侧（+x），-90 = 面向画面左侧，180 = 背对镜头。
 *
 * 所有枚举都是英文 id，界面文字由渲染进程映射；不按中文关键词做任何判断。
 */

export const PREVIZ_SCRIPT_VERSION = 1;
export const PREVIZ_MIN_DURATION = 1;
export const PREVIZ_MAX_DURATION = 10;
/** 舞台范围（米）：站位、道具、注视点都夹在 ±8 内 */
export const PREVIZ_STAGE_LIMIT = 8;
export const PREVIZ_MAX_FIGURES = 6;
export const PREVIZ_MAX_FIGURE_KEYS = 24;
export const PREVIZ_MAX_CAMERA_KEYS = 12;
export const PREVIZ_MAX_PROPS = 12;
export const PREVIZ_LENS_MIN = 18;
export const PREVIZ_LENS_MAX = 135;
export const PREVIZ_PITCH_MIN = -50;
export const PREVIZ_PITCH_MAX = 60;
export const PREVIZ_HEIGHT_LIMIT = 2;
/** 关节微调上限（度） */
export const PREVIZ_JOINT_LIMIT = 170;

export const PREVIZ_POSES = [
  'stand',
  'walk',
  'run',
  'sit',
  'crouch',
  'kneel',
  'draw-sword',
  'face-off',
  'point',
  'talk',
  'look-back',
  'embrace',
  'fallen',
] as const;
export type PrevizPoseId = (typeof PREVIZ_POSES)[number];

/** 行走类姿势：移动时腿和手臂按步幅摆动 */
export const PREVIZ_GAIT_POSES: readonly PrevizPoseId[] = ['walk', 'run'];

export const PREVIZ_JOINTS = [
  'spine',
  'chest',
  'neck',
  'head',
  'leftUpperArm',
  'leftForearm',
  'leftHand',
  'rightUpperArm',
  'rightForearm',
  'rightHand',
  'leftThigh',
  'leftShin',
  'leftFoot',
  'rightThigh',
  'rightShin',
  'rightFoot',
] as const;
export type PrevizJoint = (typeof PREVIZ_JOINTS)[number];

/** 景别 id，与 storyboard 的 SHOT_SIZES 按顺序一一对应（从远到近） */
export const PREVIZ_SHOT_SIZES = [
  'extreme-wide',
  'wide',
  'full',
  'medium',
  'medium-close',
  'close-up',
  'extreme-close-up',
] as const;
export type PrevizShotSize = (typeof PREVIZ_SHOT_SIZES)[number];

export const PREVIZ_ANGLES = ['eye', 'high', 'low'] as const;
export type PrevizAngle = (typeof PREVIZ_ANGLES)[number];

export const PREVIZ_MOODS = ['day', 'dusk', 'night'] as const;
export type PrevizMood = (typeof PREVIZ_MOODS)[number];

export const PREVIZ_PROP_KINDS = [
  'wall',
  'door',
  'table',
  'chair',
  'pillar',
  'tree',
  'crate',
] as const;
export type PrevizPropKind = (typeof PREVIZ_PROP_KINDS)[number];

/** 柔和的人物标识色 */
export const PREVIZ_FIGURE_COLORS = [
  '#c9a27a',
  '#8fb3d9',
  '#a9c79a',
  '#d4a5c0',
  '#c7c08a',
  '#9fb0c9',
] as const;

export interface PrevizFraming {
  /** 画面竖直方向框住的高度（米） */
  height: number;
  /** 注视点高度（米） */
  targetY: number;
  /** 默认焦距（毫米） */
  lens: number;
}

/** 景别 → 取景高度 / 注视点高度 / 常用焦距 */
export const PREVIZ_FRAMING: Readonly<Record<PrevizShotSize, PrevizFraming>> = {
  'extreme-wide': { height: 30, targetY: 1.2, lens: 24 },
  wide: { height: 9, targetY: 1.1, lens: 24 },
  full: { height: 2.3, targetY: 0.92, lens: 35 },
  medium: { height: 1.0, targetY: 1.33, lens: 50 },
  'medium-close': { height: 0.7, targetY: 1.5, lens: 50 },
  'close-up': { height: 0.42, targetY: 1.62, lens: 85 },
  'extreme-close-up': { height: 0.2, targetY: 1.67, lens: 85 },
};

/** 各角度的基础仰角（度，正 = 相机在上方往下拍） */
export const PREVIZ_ANGLE_ELEVATION: Readonly<Record<PrevizAngle, number>> = {
  eye: 0,
  high: 32,
  low: -22,
};

/** 关节旋转微调（度，XYZ 欧拉角，叠加在姿势之上） */
export type PrevizJointAngles = Partial<Record<PrevizJoint, [number, number, number]>>;

export interface PrevizFigureKey {
  /** 时间（秒） */
  t: number;
  x: number;
  z: number;
  /** 朝向（度） */
  facing: number;
  pose: PrevizPoseId;
  joints?: PrevizJointAngles;
}

export interface PrevizFigureTrack {
  id: string;
  name: string;
  color: string;
  keys: PrevizFigureKey[];
}

export interface PrevizCameraKey {
  t: number;
  shotSize: PrevizShotSize;
  /** 焦距（毫米，全画幅等效） */
  lens: number;
  angle: PrevizAngle;
  /** 环绕角（度，0 = 正面，正 = 相机绕到画面右侧 +x） */
  yaw: number;
  /** 在角度之上的额外仰角（度） */
  pitch: number;
  /** 机位升降（米） */
  height: number;
  /** 注视的地面点；省略时自动对准人物中心 */
  focus?: { x: number; z: number };
}

export interface PrevizPropItem {
  id: string;
  kind: PrevizPropKind;
  x: number;
  z: number;
  facing: number;
}

export interface PrevizScript {
  version: typeof PREVIZ_SCRIPT_VERSION;
  durationSec: number;
  mood: PrevizMood;
  figures: PrevizFigureTrack[];
  camera: PrevizCameraKey[];
  props: PrevizPropItem[];
  /** 一句话说明（AI 可选） */
  summary?: string;
}

export type PrevizValidation =
  | { ok: true; script: PrevizScript; warnings: string[] }
  | { ok: false; errors: string[] };

const NUMBER_TRIPLE = {
  type: 'array',
  items: { type: 'number' },
  minItems: 3,
  maxItems: 3,
} as const;

/** 期望 AI 返回的 JSON 结构（JSON Schema draft-07 子集），同时写进提示词 */
export const PREVIZ_JSON_SCHEMA = {
  type: 'object',
  required: ['durationSec', 'figures', 'camera'],
  properties: {
    durationSec: { type: 'number', minimum: PREVIZ_MIN_DURATION, maximum: PREVIZ_MAX_DURATION },
    mood: { type: 'string', enum: [...PREVIZ_MOODS] },
    summary: { type: 'string' },
    figures: {
      type: 'array',
      maxItems: PREVIZ_MAX_FIGURES,
      items: {
        type: 'object',
        required: ['name', 'keys'],
        properties: {
          name: { type: 'string' },
          color: { type: 'string', description: '#rrggbb' },
          keys: {
            type: 'array',
            minItems: 1,
            maxItems: PREVIZ_MAX_FIGURE_KEYS,
            items: {
              type: 'object',
              required: ['t', 'x', 'z', 'pose'],
              properties: {
                t: { type: 'number', description: 'seconds' },
                x: { type: 'number', minimum: -PREVIZ_STAGE_LIMIT, maximum: PREVIZ_STAGE_LIMIT },
                z: { type: 'number', minimum: -PREVIZ_STAGE_LIMIT, maximum: PREVIZ_STAGE_LIMIT },
                facing: { type: 'number', description: 'degrees, 0 = toward camera' },
                pose: { type: 'string', enum: [...PREVIZ_POSES] },
                joints: {
                  type: 'object',
                  description: 'optional joint offsets in degrees [x, y, z]',
                  properties: Object.fromEntries(
                    PREVIZ_JOINTS.map((joint) => [joint, NUMBER_TRIPLE])
                  ),
                },
              },
            },
          },
        },
      },
    },
    camera: {
      type: 'array',
      minItems: 1,
      maxItems: PREVIZ_MAX_CAMERA_KEYS,
      items: {
        type: 'object',
        required: ['t', 'shotSize'],
        properties: {
          t: { type: 'number' },
          shotSize: { type: 'string', enum: [...PREVIZ_SHOT_SIZES] },
          lens: { type: 'number', minimum: PREVIZ_LENS_MIN, maximum: PREVIZ_LENS_MAX },
          angle: { type: 'string', enum: [...PREVIZ_ANGLES] },
          yaw: { type: 'number', minimum: -180, maximum: 180 },
          pitch: { type: 'number', minimum: PREVIZ_PITCH_MIN, maximum: PREVIZ_PITCH_MAX },
          height: { type: 'number', minimum: -PREVIZ_HEIGHT_LIMIT, maximum: PREVIZ_HEIGHT_LIMIT },
          focus: {
            type: 'object',
            properties: { x: { type: 'number' }, z: { type: 'number' } },
          },
        },
      },
    },
    props: {
      type: 'array',
      maxItems: PREVIZ_MAX_PROPS,
      items: {
        type: 'object',
        required: ['kind', 'x', 'z'],
        properties: {
          kind: { type: 'string', enum: [...PREVIZ_PROP_KINDS] },
          x: { type: 'number' },
          z: { type: 'number' },
          facing: { type: 'number' },
        },
      },
    },
  },
} as const;

/* ----------------------------- 数值工具 ----------------------------- */

export const clampNumber = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const roundTo = (value: number, digits = 3) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor || 0;
};

/** 角度规范到 (-180, 180] */
export function normalizeDegrees(degrees: number): number {
  let value = degrees % 360;
  if (value > 180) value -= 360;
  if (value <= -180) value += 360;
  return roundTo(value, 2);
}

export const clampToPrevizStage = (value: number) =>
  roundTo(clampNumber(value, -PREVIZ_STAGE_LIMIT, PREVIZ_STAGE_LIMIT), 3);

/** 站成一排、面向镜头的人物（没有 AI 结果或 AI 漏掉人物时使用） */
export function rowFigures(names: readonly string[]): PrevizFigureTrack[] {
  const list = (names.length ? names : ['人物']).slice(0, PREVIZ_MAX_FIGURES);
  const spacing = 0.9;
  const start = (-(list.length - 1) * spacing) / 2;
  return list.map((name, index) => ({
    id: `f${index + 1}`,
    name,
    color: PREVIZ_FIGURE_COLORS[index % PREVIZ_FIGURE_COLORS.length],
    keys: [{ t: 0, x: roundTo(start + index * spacing, 2), z: 0, facing: 0, pose: 'stand' }],
  }));
}

/** 只有一个机位：按景别的常用焦距、平视、正面 */
export function staticCameraKey(shotSize: PrevizShotSize, t = 0): PrevizCameraKey {
  return {
    t,
    shotSize,
    lens: PREVIZ_FRAMING[shotSize].lens,
    angle: 'eye',
    yaw: 0,
    pitch: 0,
    height: 0,
  };
}

/* ----------------------------- 文件名 ----------------------------- */

/** 预演视频 / 首帧落盘文件名：镜头3-预演.mp4、镜头3-预演.png（每个镜头一份，覆盖写入） */
export function previzFileName(shotNumber: number, ext: 'mp4' | 'webm' | 'png'): string {
  return `镜头${shotNumber}-预演.${ext}`;
}

/** 「镜头N-预演.<ext>」：文件名里的汉字用 \uXXXX 转义（\u955c\u5934 = 镜头，\u9884\u6f14 = 预演），与 previzFileName 对应 */
const PREVIZ_FILE_NAME = /^\u955c\u5934([1-9]\d{0,2})-\u9884\u6f14\.(mp4|webm|png)$/;

export function parsePrevizFileName(
  name: string
): { shotNumber: number; ext: 'mp4' | 'webm' | 'png' } | null {
  const match = PREVIZ_FILE_NAME.exec(name);
  if (!match) return null;
  return { shotNumber: Number(match[1]), ext: match[2] as 'mp4' | 'webm' | 'png' };
}
