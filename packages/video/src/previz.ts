/**
 * 3D 预演脚本（PrevizScript）：一个镜头的「走位 + 机位」动画，交给确定性的 three.js 引擎逐帧渲染。
 *
 * 这是 AI（或将来的其他工具）与预演引擎之间的契约：
 * - AI 按 PREVIZ_JSON_SCHEMA 输出人物关键帧（时间、站位、朝向、姿势、可选关节微调）、机位关键帧、道具与时段
 * - validatePrevizScript（previz-validate.ts）宽松解析（容忍字段别名、字符串数字），把所有数值夹到安全范围，未知姿势回退站立
 * - 插值 / 默认脚本 / 微调在 previz-sample.ts（纯函数）
 *
 * 第 2 版（向下兼容第 1 版，validatePrevizScript 自动迁移）由 AI 控制更多内容：
 * - 人物：关键帧之间的缓动（ease）、动作片段（motion：引用内置 / 动作库 BVH 的 clip id，起点 / 速度 / 循环；
 *   或 generate 文字描述，交给 MotionProvider 生成）、视线（lookAt：看向某个人物或某个点）、手部目标（hands，简易 IK）
 * - 道具：类型 / 名字 / 尺寸 / 颜色 / 离地高度，以及位置 / 朝向关键帧（道具也能动）
 * - 机位：跟随某个人物（follow）、绝对机位（position + target），关键帧缓动
 *
 * 坐标约定（米）：地面为 x / z 平面，默认机位在 +z 方向看向原点；x 正 = 画面右侧，z 正 = 靠近镜头。
 * 朝向 facing（度）：0 = 面向镜头，90 = 面向画面右侧（+x），-90 = 面向画面左侧，180 = 背对镜头。
 *
 * 所有枚举都是英文 id，界面文字由渲染进程映射；不按中文关键词做任何判断。
 */

export const PREVIZ_SCRIPT_VERSION = 2;
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
export const PREVIZ_MAX_PROP_KEYS = 12;
/** 道具尺寸上限（米） */
export const PREVIZ_PROP_SIZE_MAX = 20;
/** 手部目标 / 视线目标 / 绝对机位的高度范围（米） */
export const PREVIZ_POINT_Y_MIN = 0;
export const PREVIZ_POINT_Y_MAX = 12;
/** 动作片段播放速度范围 */
export const PREVIZ_MOTION_SPEED_MIN = 0.1;
export const PREVIZ_MOTION_SPEED_MAX = 4;
/** 动作片段 id / 生成描述的长度上限 */
export const PREVIZ_CLIP_ID_MAX = 120;
export const PREVIZ_MOTION_PROMPT_MAX = 200;

/** 关键帧到下一个关键帧之间的缓动 */
export const PREVIZ_EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const;
export type PrevizEase = (typeof PREVIZ_EASINGS)[number];

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
  // 通用几何体：按 size 给出真实尺寸，配合 color / name 表达任意物体（马车、剑、石碑…）
  'box',
  'cylinder',
  'sphere',
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

export interface PrevizPoint3 {
  x: number;
  y: number;
  z: number;
}

/** 视线目标：看向某个人物（人物 id）或舞台上的某个点 */
export type PrevizLookAt = { figure: string } | PrevizPoint3;

/**
 * 动作片段引用：clip 为内置（builtin:wave）或动作库（lib:<文件名>）的 id；
 * generate 是交给动作生成服务（MotionProvider）的描述，生成后写回 clip。两者都没有时只用 pose。
 */
export interface PrevizMotionRef {
  clip?: string;
  /** 片段内起点（秒） */
  start?: number;
  /** 播放速度（1 = 原速） */
  speed?: number;
  loop?: boolean;
  generate?: string;
}

/** 手部目标（世界坐标，米）：手尽量够到这个点（两段臂解析 IK） */
export interface PrevizHandTargets {
  left?: PrevizPoint3;
  right?: PrevizPoint3;
}

export interface PrevizFigureKey {
  /** 时间（秒） */
  t: number;
  x: number;
  z: number;
  /** 朝向（度） */
  facing: number;
  pose: PrevizPoseId;
  joints?: PrevizJointAngles;
  /** 从这一帧到下一帧的位置 / 朝向缓动（默认 linear：匀速，像走路一样不顿挫） */
  ease?: PrevizEase;
  /** 从这一帧开始播放的动作片段（覆盖 pose，片段没驱动的关节仍用 pose） */
  motion?: PrevizMotionRef;
  lookAt?: PrevizLookAt;
  hands?: PrevizHandTargets;
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
  /** 跟随的人物 id：注视点随该人物移动（优先于 focus） */
  follow?: string;
  /** 绝对机位（米）：给出时覆盖景别 / 角度 / 环绕推出的相机位置，lens 仍然有效 */
  position?: PrevizPoint3;
  /** 绝对注视点；省略时用 follow / focus / 人物中心 */
  target?: PrevizPoint3;
  ease?: PrevizEase;
}

export interface PrevizPropKey {
  t: number;
  x: number;
  z: number;
  /** 离地高度（米，默认 0） */
  y?: number;
  facing: number;
  ease?: PrevizEase;
}

export interface PrevizPropItem {
  id: string;
  kind: PrevizPropKind;
  /** 起始位置 / 朝向（有 keys 时等于第一个关键帧） */
  x: number;
  z: number;
  facing: number;
  y?: number;
  /** 名字（例如「马车」），只用于显示 */
  name?: string;
  /** 尺寸（米，[宽, 高, 深]）：通用几何体为真实尺寸，其他类型按默认尺寸缩放 */
  size?: [number, number, number];
  color?: string;
  /** 位置 / 朝向关键帧：道具也能动（推车、飞出的剑） */
  keys?: PrevizPropKey[];
}

/** 各道具类型的默认尺寸（米，[宽, 高, 深]），size 相对它缩放 */
export const PREVIZ_PROP_DEFAULT_SIZE: Readonly<Record<PrevizPropKind, [number, number, number]>> =
  {
    wall: [3.2, 2.7, 0.2],
    door: [1.2, 2.3, 0.16],
    table: [1.4, 0.77, 0.8],
    chair: [0.46, 0.95, 0.44],
    pillar: [0.62, 3.1, 0.62],
    tree: [2, 3.5, 2],
    crate: [0.6, 0.6, 0.6],
    box: [1, 1, 1],
    cylinder: [0.5, 1, 0.5],
    sphere: [0.5, 0.5, 0.5],
  };

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

const POINT3 = {
  type: 'object',
  description: 'meters; y = height above ground',
  properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
} as const;

const EASE = { type: 'string', enum: [...PREVIZ_EASINGS] } as const;

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
                ease: { ...EASE, description: 'easing of position / facing toward the next key' },
                motion: {
                  type: 'object',
                  description:
                    'motion clip played from this key (overrides pose): clip id from the list, or generate = text description',
                  properties: {
                    clip: { type: 'string' },
                    start: { type: 'number', description: 'seconds into the clip' },
                    speed: {
                      type: 'number',
                      minimum: PREVIZ_MOTION_SPEED_MIN,
                      maximum: PREVIZ_MOTION_SPEED_MAX,
                    },
                    loop: { type: 'boolean' },
                    generate: { type: 'string' },
                  },
                },
                lookAt: {
                  type: 'object',
                  description: 'gaze target: { figure: name } or a point { x, y, z }',
                  properties: {
                    figure: { type: 'string' },
                    x: { type: 'number' },
                    y: { type: 'number' },
                    z: { type: 'number' },
                  },
                },
                hands: {
                  type: 'object',
                  description: 'optional hand targets (world meters), e.g. reaching a door handle',
                  properties: { left: POINT3, right: POINT3 },
                },
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
          follow: { type: 'string', description: 'figure name the camera keeps aimed at' },
          position: { ...POINT3, description: 'absolute camera position (overrides yaw / angle)' },
          target: { ...POINT3, description: 'absolute look-at point for position' },
          ease: EASE,
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
          name: { type: 'string' },
          x: { type: 'number' },
          z: { type: 'number' },
          y: { type: 'number', description: 'height above ground (meters)' },
          facing: { type: 'number' },
          size: { ...NUMBER_TRIPLE, description: '[width, height, depth] in meters' },
          color: { type: 'string', description: '#rrggbb' },
          keys: {
            type: 'array',
            maxItems: PREVIZ_MAX_PROP_KEYS,
            description: 'optional motion: position / facing keyframes',
            items: {
              type: 'object',
              required: ['t', 'x', 'z'],
              properties: {
                t: { type: 'number' },
                x: { type: 'number' },
                z: { type: 'number' },
                y: { type: 'number' },
                facing: { type: 'number' },
                ease: EASE,
              },
            },
          },
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
