/**
 * 3D 预演脚本的插值、默认脚本与微调（纯函数）。
 *
 * - samplePrevizScript(script, t)：任意时刻的人物站位 / 朝向 / 姿势混合 / 步态相位、机位、道具与时段。
 *   引擎（渲染进程 three.js）逐帧调用它，播放与导出视频都走同一个函数，因此结果确定、可测试
 * - defaultPrevizScript：没有 AI 时的默认脚本（人物站成一排 + 缓慢推近）
 * - translateFigureTrack / orbitScriptCamera：「微调」里拖人物平移整段走位、拖空白处环绕机位
 */
import {
  PREVIZ_ANGLE_ELEVATION,
  PREVIZ_FRAMING,
  PREVIZ_JOINTS,
  PREVIZ_MAX_DURATION,
  PREVIZ_MIN_DURATION,
  PREVIZ_SCRIPT_VERSION,
  PREVIZ_SHOT_SIZES,
  clampNumber,
  clampToPrevizStage,
  normalizeDegrees,
  rowFigures,
  staticCameraKey,
  type PrevizCameraKey,
  type PrevizFigureKey,
  type PrevizFigureTrack,
  type PrevizJointAngles,
  type PrevizMood,
  type PrevizPoseId,
  type PrevizPropItem,
  type PrevizScript,
  type PrevizShotSize,
} from './previz';

export interface PrevizGait {
  /** 步态相位（弧度，随走过的距离增长） */
  phase: number;
  /** 行走 / 奔跑摆臂摆腿的权重（0–1，静止时为 0） */
  walk: number;
  run: number;
}

export interface PrevizFigureSample {
  id: string;
  name: string;
  color: string;
  x: number;
  z: number;
  /** 朝向（度） */
  facing: number;
  /** 姿势混合：from → to，mix ∈ [0, 1] */
  poseFrom: PrevizPoseId;
  poseTo: PrevizPoseId;
  mix: number;
  /** 关节微调（度，已插值） */
  joints: PrevizJointAngles;
  gait: PrevizGait;
}

export interface PrevizCameraSample {
  /** 画面竖直方向框住的高度（米） */
  framingHeight: number;
  /** 注视点高度（米，未含升降） */
  targetY: number;
  lens: number;
  /** 总仰角（度）= 角度基础仰角 + pitch */
  elevation: number;
  yaw: number;
  /** 机位升降（米） */
  height: number;
  focusX: number;
  focusZ: number;
}

export interface PrevizSample {
  t: number;
  mood: PrevizMood;
  figures: PrevizFigureSample[];
  camera: PrevizCameraSample;
  props: PrevizPropItem[];
}

/** 一个完整步态周期（左右各一步）走过的距离（米） */
export const PREVIZ_STRIDE = { walk: 1.4, run: 2.4 } as const;
/** 速度达到这个值（米/秒）时步态权重为 1 */
const GAIT_FULL_SPEED = 0.35;

const lerp = (a: number, b: number, s: number) => a + (b - a) * s;
/** 平滑过渡（两端速度为 0） */
export const easeInOut = (s: number) => s * s * (3 - 2 * s);

/** 最短弧插值（度） */
export function lerpDegrees(a: number, b: number, s: number): number {
  let delta = (b - a) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return normalizeDegrees(a + delta * s);
}

/** t 所在的区间：[前一个关键帧, 后一个关键帧, 区间内进度 0–1] */
function segment<T extends { t: number }>(keys: readonly T[], t: number): [T, T, number, number] {
  const first = keys[0];
  if (keys.length === 1 || t <= first.t) return [first, first, 0, 0];
  for (let index = 0; index < keys.length - 1; index += 1) {
    const a = keys[index];
    const b = keys[index + 1];
    if (t < b.t) {
      const span = b.t - a.t;
      return [a, b, span > 0 ? (t - a.t) / span : 1, index];
    }
  }
  const last = keys[keys.length - 1];
  return [last, last, 0, keys.length - 1];
}

function blendJoints(
  a: PrevizJointAngles | undefined,
  b: PrevizJointAngles | undefined,
  s: number
): PrevizJointAngles {
  const result: PrevizJointAngles = {};
  if (!a && !b) return result;
  for (const joint of PREVIZ_JOINTS) {
    const from = a?.[joint];
    const to = b?.[joint];
    if (!from && !to) continue;
    const x = from ?? [0, 0, 0];
    const y = to ?? [0, 0, 0];
    result[joint] = [lerp(x[0], y[0], s), lerp(x[1], y[1], s), lerp(x[2], y[2], s)];
  }
  return result;
}

const distance = (a: PrevizFigureKey, b: PrevizFigureKey) => Math.hypot(b.x - a.x, b.z - a.z);

const gaitWeight = (pose: PrevizPoseId, kind: 'walk' | 'run') => (pose === kind ? 1 : 0);

/** 人物在 t 时刻的状态：位置匀速（像走路一样不顿挫），朝向 / 姿势 / 关节平滑过渡 */
export function sampleFigure(track: PrevizFigureTrack, t: number): PrevizFigureSample {
  const [a, b, s, index] = segment(track.keys, t);
  const eased = easeInOut(s);
  let travelled = 0;
  for (let i = 0; i < index; i += 1) travelled += distance(track.keys[i], track.keys[i + 1]);
  const length = distance(a, b);
  travelled += length * s;
  const span = b.t - a.t;
  const speed = a !== b && span > 0 ? length / span : 0;
  const moving = clampNumber(speed / GAIT_FULL_SPEED, 0, 1);
  const walk = lerp(gaitWeight(a.pose, 'walk'), gaitWeight(b.pose, 'walk'), eased) * moving;
  const run = lerp(gaitWeight(a.pose, 'run'), gaitWeight(b.pose, 'run'), eased) * moving;
  const stride = run > walk ? PREVIZ_STRIDE.run : PREVIZ_STRIDE.walk;
  // 移动中朝向默认就是 AI 给的朝向；步态相位只取决于走过的距离，播放 / 拖动进度条都一致
  return {
    id: track.id,
    name: track.name,
    color: track.color,
    x: lerp(a.x, b.x, s),
    z: lerp(a.z, b.z, s),
    facing: lerpDegrees(a.facing, b.facing, eased),
    poseFrom: a.pose,
    poseTo: b.pose,
    mix: a.pose === b.pose ? 0 : eased,
    joints: blendJoints(a.joints, b.joints, eased),
    gait: { phase: (travelled / stride) * Math.PI * 2, walk, run },
  };
}

/** 人物中心（自动对准时的注视点） */
function figuresCenter(figures: readonly PrevizFigureSample[]): { x: number; z: number } {
  if (!figures.length) return { x: 0, z: 0 };
  const sum = figures.reduce((acc, item) => ({ x: acc.x + item.x, z: acc.z + item.z }), {
    x: 0,
    z: 0,
  });
  return { x: sum.x / figures.length, z: sum.z / figures.length };
}

function cameraValues(key: PrevizCameraKey, center: { x: number; z: number }) {
  const framing = PREVIZ_FRAMING[key.shotSize];
  return {
    framingHeight: framing.height,
    targetY: framing.targetY,
    lens: key.lens,
    elevation: PREVIZ_ANGLE_ELEVATION[key.angle] + key.pitch,
    yaw: key.yaw,
    height: key.height,
    focusX: key.focus?.x ?? center.x,
    focusZ: key.focus?.z ?? center.z,
  };
}

/** 机位在 t 时刻的状态：景别高度按对数插值（推拉匀速），其余平滑过渡 */
export function sampleCamera(
  keys: readonly PrevizCameraKey[],
  t: number,
  figures: readonly PrevizFigureSample[]
): PrevizCameraSample {
  const center = figuresCenter(figures);
  const fallback = keys.length ? keys : [staticCameraKey('medium')];
  const [a, b, s] = segment(fallback, t);
  const from = cameraValues(a, center);
  const to = cameraValues(b, center);
  const eased = easeInOut(s);
  return {
    framingHeight: Math.exp(lerp(Math.log(from.framingHeight), Math.log(to.framingHeight), eased)),
    targetY: lerp(from.targetY, to.targetY, eased),
    lens: lerp(from.lens, to.lens, eased),
    elevation: lerp(from.elevation, to.elevation, eased),
    yaw: lerpDegrees(from.yaw, to.yaw, eased),
    height: lerp(from.height, to.height, eased),
    focusX: lerp(from.focusX, to.focusX, eased),
    focusZ: lerp(from.focusZ, to.focusZ, eased),
  };
}

/** 脚本在 t 秒时的完整状态（t 夹在 [0, durationSec]） */
export function samplePrevizScript(script: PrevizScript, t: number): PrevizSample {
  const time = clampNumber(Number.isFinite(t) ? t : 0, 0, script.durationSec);
  const figures = script.figures.map((track) => sampleFigure(track, time));
  return {
    t: time,
    mood: script.mood,
    figures,
    camera: sampleCamera(script.camera, time, figures),
    props: script.props,
  };
}

/** 导出视频的帧数（至少 1 帧） */
export function previzFrameCount(script: PrevizScript, fps: number): number {
  return Math.max(1, Math.round(script.durationSec * fps));
}

export interface DefaultPrevizInput {
  characters: readonly string[];
  shotSize: PrevizShotSize;
  durationSec?: number;
}

/**
 * 默认脚本（没有配置 AI 或 AI 失败时）：人物站成一排面向镜头，机位从宽一级的景别缓慢推近到本镜头景别。
 * 不解析画面描述，结果只取决于人物、景别与时长。
 */
export function defaultPrevizScript(input: DefaultPrevizInput): PrevizScript {
  const durationSec = clampNumber(
    Math.round((input.durationSec ?? 6) * 100) / 100 || 6,
    PREVIZ_MIN_DURATION,
    PREVIZ_MAX_DURATION
  );
  const index = PREVIZ_SHOT_SIZES.indexOf(input.shotSize);
  const wider = PREVIZ_SHOT_SIZES[Math.max(0, index - 1)];
  const start = staticCameraKey(wider, 0);
  const end = { ...staticCameraKey(input.shotSize, durationSec), lens: start.lens };
  return {
    version: PREVIZ_SCRIPT_VERSION,
    durationSec,
    mood: 'day',
    figures: rowFigures(input.characters),
    camera: wider === input.shotSize ? [start] : [start, end],
    props: [],
  };
}

/** 整段走位平移（拖动人物）：所有关键帧一起移动，结果夹在舞台内 */
export function translateFigureTrack(
  script: PrevizScript,
  id: string,
  dx: number,
  dz: number
): PrevizScript {
  return {
    ...script,
    figures: script.figures.map((track) =>
      track.id === id
        ? {
            ...track,
            keys: track.keys.map((key) => ({
              ...key,
              x: clampToPrevizStage(key.x + dx),
              z: clampToPrevizStage(key.z + dz),
            })),
          }
        : track
    ),
  };
}

/** 环绕机位（拖动空白处）：所有机位关键帧的环绕角一起转 */
export function orbitScriptCamera(script: PrevizScript, deltaYaw: number): PrevizScript {
  return {
    ...script,
    camera: script.camera.map((key) => ({ ...key, yaw: normalizeDegrees(key.yaw + deltaYaw) })),
  };
}

/** 换时段 */
export function withPrevizMood(script: PrevizScript, mood: PrevizMood): PrevizScript {
  return { ...script, mood };
}

/**
 * 把「自动对准人物中心」的机位关键帧固定到当时的人物中心。
 * 拖动人物前调用：否则机位跟着人物中心一起移动，人物在画面里看起来没动。
 */
export function pinCameraFocus(script: PrevizScript): PrevizScript {
  if (script.camera.every((key) => key.focus)) return script;
  return {
    ...script,
    camera: script.camera.map((key) => {
      if (key.focus) return key;
      const center = figuresCenter(script.figures.map((track) => sampleFigure(track, key.t)));
      return {
        ...key,
        focus: { x: clampToPrevizStage(center.x), z: clampToPrevizStage(center.z) },
      };
    }),
  };
}
