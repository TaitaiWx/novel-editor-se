/**
 * 预演脚本校验（validatePrevizScript）：把 AI 返回（或作者保存）的 JSON 规范化为 PrevizScript。
 * 宽松解析：容忍字段别名、字符串数字；所有数值夹到安全范围；未知枚举回退默认值并给出警告。
 * 枚举只接受英文 id 与英文别名（分镜景别经 storyboard 的 normalizeShotSize 映射），不按中文关键词判断。
 */
import { SHOT_SIZES, normalizeShotSize } from './storyboard';
import {
  PREVIZ_ANGLES,
  PREVIZ_FIGURE_COLORS,
  PREVIZ_FRAMING,
  PREVIZ_JOINTS,
  PREVIZ_JOINT_LIMIT,
  PREVIZ_HEIGHT_LIMIT,
  PREVIZ_LENS_MAX,
  PREVIZ_LENS_MIN,
  PREVIZ_MAX_CAMERA_KEYS,
  PREVIZ_MAX_DURATION,
  PREVIZ_MAX_FIGURES,
  PREVIZ_MAX_FIGURE_KEYS,
  PREVIZ_MAX_PROPS,
  PREVIZ_MIN_DURATION,
  PREVIZ_MOODS,
  PREVIZ_PITCH_MAX,
  PREVIZ_PITCH_MIN,
  PREVIZ_POSES,
  PREVIZ_PROP_KINDS,
  PREVIZ_SCRIPT_VERSION,
  PREVIZ_SHOT_SIZES,
  clampNumber,
  clampToPrevizStage,
  normalizeDegrees,
  roundTo,
  rowFigures,
  staticCameraKey,
  type PrevizAngle,
  type PrevizCameraKey,
  type PrevizFigureKey,
  type PrevizFigureTrack,
  type PrevizJointAngles,
  type PrevizMood,
  type PrevizPoseId,
  type PrevizPropItem,
  type PrevizPropKind,
  type PrevizScript,
  type PrevizShotSize,
  type PrevizValidation,
} from './previz';

const round = roundTo;

/* ----------------------------- 基础工具 ----------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const match = value.match(/-?\d+(?:\.\d+)?/);
    if (match) return Number(match[0]);
  }
  return undefined;
}

function asText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function pick(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

/** 枚举 id 规范化：小写、空格 / 下划线换成连字符 */
function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

/* ----------------------------- 别名 ----------------------------- */

const POSE_ALIASES: Readonly<Record<string, PrevizPoseId>> = {
  idle: 'stand',
  standing: 'stand',
  walking: 'walk',
  running: 'run',
  sprint: 'run',
  sitting: 'sit',
  seated: 'sit',
  squat: 'crouch',
  crouching: 'crouch',
  kneeling: 'kneel',
  draw: 'draw-sword',
  drawsword: 'draw-sword',
  'draw-weapon': 'draw-sword',
  confront: 'face-off',
  faceoff: 'face-off',
  standoff: 'face-off',
  'fight-stance': 'face-off',
  pointing: 'point',
  talking: 'talk',
  speak: 'talk',
  speaking: 'talk',
  lookback: 'look-back',
  'looking-back': 'look-back',
  hug: 'embrace',
  hugging: 'embrace',
  fall: 'fallen',
  lying: 'fallen',
  'lie-down': 'fallen',
};

export function normalizePrevizPose(value: unknown): PrevizPoseId | undefined {
  const text = asText(value);
  if (!text) return undefined;
  const id = slug(text);
  if ((PREVIZ_POSES as readonly string[]).includes(id)) return id as PrevizPoseId;
  return POSE_ALIASES[id];
}

const SHOT_SIZE_ID_ALIASES: Readonly<Record<string, PrevizShotSize>> = {
  'extreme-long': 'extreme-wide',
  'extreme-long-shot': 'extreme-wide',
  'extreme-wide-shot': 'extreme-wide',
  long: 'wide',
  'long-shot': 'wide',
  'wide-shot': 'wide',
  'full-shot': 'full',
  mid: 'medium',
  'mid-shot': 'medium',
  'medium-shot': 'medium',
  'medium-close-up': 'medium-close',
  closeup: 'close-up',
  close: 'close-up',
  'extreme-closeup': 'extreme-close-up',
};

/** 景别：接受 PrevizShotSize id、分镜景别（storyboard SHOT_SIZES）与常见英文别名 */
export function normalizePrevizShotSize(value: unknown): PrevizShotSize | undefined {
  const text = asText(value);
  if (!text) return undefined;
  const id = slug(text);
  if ((PREVIZ_SHOT_SIZES as readonly string[]).includes(id)) return id as PrevizShotSize;
  if (SHOT_SIZE_ID_ALIASES[id]) return SHOT_SIZE_ID_ALIASES[id];
  const storyboardSize = normalizeShotSize(text);
  if (!storyboardSize) return undefined;
  return PREVIZ_SHOT_SIZES[SHOT_SIZES.indexOf(storyboardSize)];
}

/** 分镜景别（storyboard SHOT_SIZES）→ 预演景别；无法识别时为中景 */
export function previzShotSizeOf(shotSize: string | undefined): PrevizShotSize {
  return normalizePrevizShotSize(shotSize) ?? 'medium';
}

function normalizeEnum<T extends string>(value: unknown, list: readonly T[]): T | undefined {
  const text = asText(value);
  if (!text) return undefined;
  const id = slug(text);
  return (list as readonly string[]).includes(id) ? (id as T) : undefined;
}

const ANGLE_ALIASES: Readonly<Record<string, PrevizAngle>> = {
  'eye-level': 'eye',
  level: 'eye',
  front: 'eye',
  'high-angle': 'high',
  top: 'high',
  overhead: 'high',
  'low-angle': 'low',
};

const MOOD_ALIASES: Readonly<Record<string, PrevizMood>> = {
  daytime: 'day',
  noon: 'day',
  morning: 'day',
  sunset: 'dusk',
  evening: 'dusk',
  dawn: 'dusk',
  'golden-hour': 'dusk',
  'night-time': 'night',
  midnight: 'night',
};

function normalizeAngle(value: unknown): PrevizAngle | undefined {
  const text = asText(value);
  return normalizeEnum(value, PREVIZ_ANGLES) ?? (text ? ANGLE_ALIASES[slug(text)] : undefined);
}

function normalizeMood(value: unknown): PrevizMood | undefined {
  const text = asText(value);
  return normalizeEnum(value, PREVIZ_MOODS) ?? (text ? MOOD_ALIASES[slug(text)] : undefined);
}

function normalizePropKind(value: unknown): PrevizPropKind | undefined {
  const text = asText(value);
  if (!text) return undefined;
  const id = slug(text).replace(/s$/, '');
  return (PREVIZ_PROP_KINDS as readonly string[]).includes(id) ? (id as PrevizPropKind) : undefined;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/* ----------------------------- 字段读取 ----------------------------- */

const TIME_KEYS = ['t', 'time', 'at', 'sec', 'seconds', 'timeSec'];
const X_KEYS = ['x', 'posX', 'positionX'];
const Z_KEYS = ['z', 'posZ', 'positionZ', 'depth'];
const FACING_KEYS = ['facing', 'rotation', 'heading', 'direction', 'dir', 'rotY', 'face'];

/** 位置：x / z，或 position: { x, z } / [x, z] */
function readPoint(record: Record<string, unknown>): { x?: number; z?: number } {
  let x = asNumber(pick(record, X_KEYS));
  let z = asNumber(pick(record, Z_KEYS));
  const nested = pick(record, ['position', 'pos', 'at', 'location']);
  if (isRecord(nested)) {
    x ??= asNumber(nested.x);
    z ??= asNumber(nested.z ?? nested.y);
  } else if (Array.isArray(nested) && nested.length >= 2) {
    x ??= asNumber(nested[0]);
    z ??= asNumber(nested[nested.length === 3 ? 2 : 1]);
  }
  return { x, z };
}

function readJoints(
  raw: unknown,
  warnings: string[],
  label: string
): PrevizJointAngles | undefined {
  if (!isRecord(raw)) return undefined;
  const joints: PrevizJointAngles = {};
  for (const [key, value] of Object.entries(raw)) {
    const joint = PREVIZ_JOINTS.find((item) => item.toLowerCase() === key.toLowerCase());
    if (!joint) {
      warnings.push(`${label} 的关节 ${key} 不存在，已忽略`);
      continue;
    }
    const list = Array.isArray(value)
      ? value
      : isRecord(value)
        ? [value.x, value.y, value.z]
        : [value, 0, 0];
    const angles = [0, 1, 2].map((index) =>
      round(clampNumber(asNumber(list[index]) ?? 0, -PREVIZ_JOINT_LIMIT, PREVIZ_JOINT_LIMIT), 2)
    ) as [number, number, number];
    if (angles.some((angle) => angle !== 0)) joints[joint] = angles;
  }
  return Object.keys(joints).length ? joints : undefined;
}

/** 关键帧按时间排序；同一时间只保留最后一个 */
function sortKeys<T extends { t: number }>(keys: T[]): T[] {
  const byTime = new Map<number, T>();
  for (const key of keys) byTime.set(key.t, key);
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

function clampTime(value: number | undefined, duration: number, fallback: number): number {
  return round(clampNumber(value ?? fallback, 0, duration), 3);
}

/* ----------------------------- 校验 ----------------------------- */

export interface PrevizValidateOptions {
  /** 镜头人物：AI 没有给出人物时按它们一字排开 */
  characters?: readonly string[];
  /** AI 没给时长时使用（默认 6 秒） */
  durationSec?: number;
  /** AI 没给机位时使用的景别 */
  shotSize?: PrevizShotSize;
}

function readFigure(
  raw: unknown,
  index: number,
  duration: number,
  usedColors: Set<string>,
  options: PrevizValidateOptions,
  warnings: string[]
): PrevizFigureTrack | null {
  const label = `人物 ${index + 1}`;
  if (!isRecord(raw)) {
    warnings.push(`${label} 不是对象，已忽略`);
    return null;
  }
  const name =
    asText(pick(raw, ['name', 'character', 'who', 'label', 'id'])) ??
    options.characters?.[index] ??
    `人物${index + 1}`;
  const rawColor = asText(raw.color);
  const color =
    rawColor && HEX_COLOR.test(rawColor)
      ? rawColor.toLowerCase()
      : (PREVIZ_FIGURE_COLORS.find((item) => !usedColors.has(item)) ??
        PREVIZ_FIGURE_COLORS[index % PREVIZ_FIGURE_COLORS.length]);
  usedColors.add(color);

  const rawKeys = pick(raw, ['keys', 'keyframes', 'frames', 'track', 'path', 'motion']);
  const list = Array.isArray(rawKeys) ? rawKeys : [raw];
  if (list.length > PREVIZ_MAX_FIGURE_KEYS) {
    warnings.push(`${label} 的关键帧超过 ${PREVIZ_MAX_FIGURE_KEYS} 个，只保留前面的`);
  }
  const keys: PrevizFigureKey[] = [];
  let previous: PrevizFigureKey | null = null;
  list.slice(0, PREVIZ_MAX_FIGURE_KEYS).forEach((item, keyIndex) => {
    if (!isRecord(item)) return;
    const point = readPoint(item);
    const rawPose = pick(item, ['pose', 'action', 'state', 'posture']);
    const pose = normalizePrevizPose(rawPose);
    if (rawPose !== undefined && !pose) {
      warnings.push(`${label} 的姿势 ${String(rawPose)} 不支持，已改为 stand`);
    }
    const fallbackT = list.length > 1 ? (duration * keyIndex) / (list.length - 1) : 0;
    const key: PrevizFigureKey = {
      t: clampTime(asNumber(pick(item, TIME_KEYS)), duration, fallbackT),
      x: clampToPrevizStage(point.x ?? previous?.x ?? 0),
      z: clampToPrevizStage(point.z ?? previous?.z ?? 0),
      facing: normalizeDegrees(asNumber(pick(item, FACING_KEYS)) ?? previous?.facing ?? 0),
      pose: pose ?? previous?.pose ?? 'stand',
    };
    const joints = readJoints(
      pick(item, ['joints', 'jointOverrides', 'overrides']),
      warnings,
      label
    );
    if (joints) key.joints = joints;
    keys.push(key);
    previous = key;
  });
  if (!keys.length) {
    warnings.push(`${label} 没有有效的关键帧，已忽略`);
    return null;
  }
  return { id: `f${index + 1}`, name, color, keys: sortKeys(keys) };
}

function readCameraKey(
  raw: unknown,
  index: number,
  count: number,
  duration: number,
  previous: PrevizCameraKey | null,
  options: PrevizValidateOptions,
  warnings: string[]
): PrevizCameraKey | null {
  if (!isRecord(raw)) return null;
  const rawSize = pick(raw, ['shotSize', 'size', 'framing', 'shot']);
  const shotSize =
    normalizePrevizShotSize(rawSize) ?? previous?.shotSize ?? options.shotSize ?? 'medium';
  if (rawSize !== undefined && !normalizePrevizShotSize(rawSize)) {
    warnings.push(`机位 ${index + 1} 的景别 ${String(rawSize)} 不支持，已改为 ${shotSize}`);
  }
  const lens = asNumber(pick(raw, ['lens', 'focalLength', 'focal', 'mm']));
  const fallbackT = count > 1 ? (duration * index) / (count - 1) : 0;
  const key: PrevizCameraKey = {
    t: clampTime(asNumber(pick(raw, TIME_KEYS)), duration, fallbackT),
    shotSize,
    lens: round(
      clampNumber(
        lens ?? previous?.lens ?? PREVIZ_FRAMING[shotSize].lens,
        PREVIZ_LENS_MIN,
        PREVIZ_LENS_MAX
      ),
      1
    ),
    angle: normalizeAngle(pick(raw, ['angle', 'cameraAngle'])) ?? previous?.angle ?? 'eye',
    yaw: normalizeDegrees(
      asNumber(pick(raw, ['yaw', 'orbit', 'azimuth', 'pan'])) ?? previous?.yaw ?? 0
    ),
    pitch: round(
      clampNumber(
        asNumber(pick(raw, ['pitch', 'tilt', 'elevation'])) ?? previous?.pitch ?? 0,
        PREVIZ_PITCH_MIN,
        PREVIZ_PITCH_MAX
      ),
      2
    ),
    height: round(
      clampNumber(
        asNumber(pick(raw, ['height', 'pedestal', 'crane', 'rise'])) ?? previous?.height ?? 0,
        -PREVIZ_HEIGHT_LIMIT,
        PREVIZ_HEIGHT_LIMIT
      ),
      3
    ),
  };
  const focusRaw = pick(raw, ['focus', 'target', 'lookAt']);
  if (isRecord(focusRaw) || Array.isArray(focusRaw)) {
    const point = readPoint({ position: focusRaw });
    if (point.x !== undefined && point.z !== undefined) {
      key.focus = { x: clampToPrevizStage(point.x), z: clampToPrevizStage(point.z) };
    }
  }
  return key;
}

/**
 * 校验并规范化 AI 返回的预演脚本（或作者保存的脚本）。
 * - 容忍字段别名（duration / characters / keyframes / position / rotation / focalLength 等）与字符串数字
 * - 数值一律夹到安全范围：时长 1–10 秒、站位 ±8 米、焦距 18–135、关节 ±170 度
 * - 未知姿势回退 stand、未知景别回退给定景别，并给出警告
 * - 既没有人物也没有机位 → 报错（交给调用方回退默认脚本）
 */
export function validatePrevizScript(
  raw: unknown,
  options: PrevizValidateOptions = {}
): PrevizValidation {
  const warnings: string[] = [];
  const root = isRecord(raw) && isRecord(raw.previz) ? raw.previz : raw;
  if (!isRecord(root)) return { ok: false, errors: ['预演脚本必须是 JSON 对象'] };

  const rawDuration = asNumber(pick(root, ['durationSec', 'duration', 'seconds', 'length']));
  const durationSource = rawDuration ?? options.durationSec ?? 6;
  const durationSec = round(
    clampNumber(durationSource, PREVIZ_MIN_DURATION, PREVIZ_MAX_DURATION),
    2
  );
  if (rawDuration !== undefined && rawDuration !== durationSec) {
    warnings.push(`时长 ${rawDuration} 秒超出范围，已调整为 ${durationSec} 秒`);
  }

  const rawFigures = pick(root, ['figures', 'characters', 'actors', 'people', 'cast']);
  const rawCamera = pick(root, ['camera', 'cameraKeys', 'cameras', 'shots']);
  if (!Array.isArray(rawFigures) && rawCamera === undefined) {
    return { ok: false, errors: ['预演脚本缺少人物（figures）与机位（camera）'] };
  }

  const usedColors = new Set<string>();
  const figureList = Array.isArray(rawFigures) ? rawFigures : [];
  if (figureList.length > PREVIZ_MAX_FIGURES) {
    warnings.push(`人物超过 ${PREVIZ_MAX_FIGURES} 个，只保留前 ${PREVIZ_MAX_FIGURES} 个`);
  }
  let figures = figureList
    .slice(0, PREVIZ_MAX_FIGURES)
    .map((item, index) => readFigure(item, index, durationSec, usedColors, options, warnings))
    .filter((item): item is PrevizFigureTrack => item !== null)
    .map((item, index) => ({ ...item, id: `f${index + 1}` }));
  if (!figures.length && options.characters?.length) {
    warnings.push('脚本没有人物，已按镜头人物站成一排');
    figures = rowFigures(options.characters);
  }

  const cameraList = Array.isArray(rawCamera) ? rawCamera : isRecord(rawCamera) ? [rawCamera] : [];
  if (cameraList.length > PREVIZ_MAX_CAMERA_KEYS) {
    warnings.push(`机位关键帧超过 ${PREVIZ_MAX_CAMERA_KEYS} 个，只保留前面的`);
  }
  const cameraKeys: PrevizCameraKey[] = [];
  const trimmedCamera = cameraList.slice(0, PREVIZ_MAX_CAMERA_KEYS);
  trimmedCamera.forEach((item, index) => {
    const key = readCameraKey(
      item,
      index,
      trimmedCamera.length,
      durationSec,
      cameraKeys[cameraKeys.length - 1] ?? null,
      options,
      warnings
    );
    if (key) cameraKeys.push(key);
  });
  if (!cameraKeys.length) {
    warnings.push('脚本没有机位，已使用固定机位');
    cameraKeys.push(staticCameraKey(options.shotSize ?? 'medium'));
  }

  const rawProps = pick(root, ['props', 'objects', 'set', 'scenery']);
  const propList = Array.isArray(rawProps) ? rawProps : [];
  const props: PrevizPropItem[] = [];
  for (const item of propList.slice(0, PREVIZ_MAX_PROPS)) {
    if (!isRecord(item)) continue;
    const rawKind = pick(item, ['kind', 'type', 'prop', 'name']);
    const kind = normalizePropKind(rawKind);
    if (!kind) {
      warnings.push(`道具 ${String(rawKind)} 不支持，已忽略`);
      continue;
    }
    const point = readPoint(item);
    props.push({
      id: `p${props.length + 1}`,
      kind,
      x: clampToPrevizStage(point.x ?? 0),
      z: clampToPrevizStage(point.z ?? -1.5),
      facing: normalizeDegrees(asNumber(pick(item, FACING_KEYS)) ?? 0),
    });
  }

  const rawMood = pick(root, ['mood', 'lighting', 'timeOfDay', 'light']);
  const mood = normalizeMood(rawMood) ?? 'day';
  if (rawMood !== undefined && !normalizeMood(rawMood)) {
    warnings.push(`时段 ${String(rawMood)} 不支持，已改为 day`);
  }

  const script: PrevizScript = {
    version: PREVIZ_SCRIPT_VERSION,
    durationSec,
    mood,
    figures,
    camera: sortKeys(cameraKeys),
    props,
  };
  const summary = asText(pick(root, ['summary', 'description', 'note']));
  if (summary) script.summary = summary.slice(0, 300);
  return { ok: true, script, warnings };
}
