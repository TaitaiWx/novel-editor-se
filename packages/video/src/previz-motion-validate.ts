/**
 * 预演动作（关节轨迹）校验：AI 写的 motion、MotionProvider / 追加请求返回的轨迹都经过这里。
 *
 * - 关节名大小写 / 连字符 / 下划线不敏感，未知关节忽略并警告
 * - 关键帧接受 [t, rx, ry, rz] 或 { t, x, y, z }（也接受 rot / rotation: [x, y, z]）；含 NaN / 非数字的关键帧丢弃
 * - 时间夹到 0–10 秒并排序（同一时间保留最后一个），角度夹到关节活动范围，起伏 / 前倾夹到各自范围
 * - 数量上限：每个动作 ≤ 24 个关节、每个关节 ≤ 120 个关键帧、合计 ≤ 600 个；整个脚本合计 ≤ 3000 个（超出的截断并警告）
 * - 旧版脚本的动作片段引用（motion.clip / start / speed，或 motion 直接是字符串）静默丢弃，回退到姿势
 */
import { PREVIZ_JOINTS, roundTo, type PrevizJoint } from './previz';
import {
  PREVIZ_JOINT_RANGES,
  PREVIZ_LEAN_RANGE,
  PREVIZ_MOTION_MAX_JOINTS,
  PREVIZ_MOTION_MAX_KEYS,
  PREVIZ_MOTION_MAX_SEC,
  PREVIZ_MOTION_MAX_TOTAL_KEYS,
  PREVIZ_MOTION_PROMPT_MAX,
  PREVIZ_ROOT_BOB_RANGE,
  PREVIZ_SCRIPT_MAX_MOTION_KEYS,
  type PrevizMotion,
  type PrevizMotionCurveKey,
  type PrevizMotionKey,
  type PrevizMotionTrackMap,
  type PrevizMotionTracks,
} from './previz-motion';
import { asBoolean, asText, isRecord, pick } from './previz-validate-utils';

/** 一次校验（一个脚本）共享的关键帧预算 */
export interface MotionBudget {
  remaining: number;
}

export function createMotionBudget(total = PREVIZ_SCRIPT_MAX_MOTION_KEYS): MotionBudget {
  return { remaining: total };
}

export interface MotionValidateContext {
  warnings: string[];
  label: string;
  budget?: MotionBudget;
}

const clamp = (value: number, range: readonly [number, number]) =>
  Math.max(range[0], Math.min(range[1], value));

/** 严格的数字：有限数字或纯数字字符串；NaN / Infinity / 其他返回 null */
function strictNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && /^\s*-?\d+(\.\d+)?([eE][-+]?\d+)?\s*$/.test(value)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const normalizeName = (name: string) => name.toLowerCase().replace(/[\s_-]+/g, '');
const JOINT_BY_NAME = new Map<string, PrevizJoint>(
  PREVIZ_JOINTS.map((joint) => [normalizeName(joint), joint])
);

export function previzJointOf(name: string): PrevizJoint | undefined {
  return JOINT_BY_NAME.get(normalizeName(name));
}

/** 一个关键帧 → [t, x, y, z]（任一分量不是有限数字时为 null） */
function readKeyValues(raw: unknown, width: 2 | 4): number[] | null {
  let list: unknown[];
  if (Array.isArray(raw)) list = raw;
  else if (isRecord(raw)) {
    const t = pick(raw, ['t', 'time', 'at']);
    if (width === 2) list = [t, pick(raw, ['v', 'value', 'y', 'deg', 'm'])];
    else {
      const rotation = pick(raw, ['rot', 'rotation', 'r', 'angles']);
      list = Array.isArray(rotation)
        ? [t, ...rotation]
        : [t, raw.x ?? raw.rx ?? 0, raw.y ?? raw.ry ?? 0, raw.z ?? raw.rz ?? 0];
    }
  } else return null;
  if (list.length < 2) return null;
  const values: number[] = [];
  for (let index = 0; index < width; index += 1) {
    // 只给了 [t, rx] 时，缺的分量视为 0
    const value = index < list.length ? strictNumber(list[index]) : 0;
    if (value === null) return null;
    values.push(value);
  }
  return values;
}

function sortByTime<T extends number[]>(keys: T[]): T[] {
  const byTime = new Map<number, T>();
  for (const key of keys) byTime.set(key[0], key);
  return [...byTime.values()].sort((a, b) => a[0] - b[0]);
}

interface ReadKeysResult<T> {
  keys: T[];
  dropped: number;
  clamped: boolean;
}

function readKeys<T extends number[]>(
  raw: unknown,
  width: 2 | 4,
  allowance: number,
  convert: (values: number[]) => { key: T; clamped: boolean }
): ReadKeysResult<T> {
  const result: ReadKeysResult<T> = { keys: [], dropped: 0, clamped: false };
  if (!Array.isArray(raw)) return result;
  const limit = Math.min(PREVIZ_MOTION_MAX_KEYS, allowance);
  if (raw.length > limit) result.dropped += raw.length - limit;
  for (const item of raw.slice(0, limit)) {
    const values = readKeyValues(item, width);
    if (!values) {
      result.dropped += 1;
      continue;
    }
    const t = roundTo(clamp(values[0], [0, PREVIZ_MOTION_MAX_SEC]), 3);
    const converted = convert([t, ...values.slice(1)]);
    if (converted.clamped) result.clamped = true;
    result.keys.push(converted.key);
  }
  result.keys = sortByTime(result.keys);
  return result;
}

function readCurve(
  raw: unknown,
  range: readonly [number, number],
  digits: number,
  name: string,
  context: MotionValidateContext,
  allowance: number
): PrevizMotionCurveKey[] | undefined {
  const result = readKeys<PrevizMotionCurveKey>(raw, 2, allowance, ([t, value]) => {
    const clamped = clamp(value, range);
    return { key: [t, roundTo(clamped, digits)], clamped: clamped !== value };
  });
  if (result.dropped) {
    context.warnings.push(
      `${context.label} 的 ${name} 有 ${result.dropped} 个关键帧无效或超出上限，已忽略`
    );
  }
  if (result.clamped) context.warnings.push(`${context.label} 的 ${name} 超出范围，已夹值`);
  return result.keys.length ? result.keys : undefined;
}

/** 读取轨迹部分（tracks / rootBob / lean / loop）；什么都没有时为 null */
export function readMotionTracks(
  raw: unknown,
  context: MotionValidateContext
): PrevizMotionTracks | null {
  if (!isRecord(raw)) return null;
  const budget = context.budget ?? createMotionBudget();
  let used = 0;
  const allowance = () =>
    Math.max(0, Math.min(PREVIZ_MOTION_MAX_TOTAL_KEYS - used, budget.remaining));
  const tracks: PrevizMotionTrackMap = {};
  const rawTracks = pick(raw, ['tracks', 'joints', 'channels']);
  if (isRecord(rawTracks)) {
    const entries = Object.entries(rawTracks);
    if (entries.length > PREVIZ_MOTION_MAX_JOINTS) {
      context.warnings.push(
        `${context.label} 的动作关节超过 ${PREVIZ_MOTION_MAX_JOINTS} 个，只保留前面的`
      );
    }
    let truncated = false;
    for (const [name, value] of entries.slice(0, PREVIZ_MOTION_MAX_JOINTS)) {
      const joint = previzJointOf(name);
      if (!joint) {
        context.warnings.push(`${context.label} 的动作关节 ${name} 不存在，已忽略`);
        continue;
      }
      const room = allowance();
      if (room <= 0) {
        truncated = true;
        break;
      }
      const range = PREVIZ_JOINT_RANGES[joint];
      const result = readKeys<PrevizMotionKey>(value, 4, room, ([t, x, y, z]) => {
        const angles = [x, y, z].map((angle, axis) => clamp(angle, range[axis]));
        return {
          key: [t, roundTo(angles[0], 1), roundTo(angles[1], 1), roundTo(angles[2], 1)],
          clamped: angles.some((angle, axis) => angle !== [x, y, z][axis]),
        };
      });
      if (result.dropped) {
        context.warnings.push(
          `${context.label} 的 ${joint} 动作有 ${result.dropped} 个关键帧无效或超出上限，已忽略`
        );
      }
      if (result.clamped)
        context.warnings.push(`${context.label} 的 ${joint} 动作超出关节范围，已夹值`);
      if (!result.keys.length) continue;
      tracks[joint] = result.keys;
      used += result.keys.length;
      budget.remaining -= result.keys.length;
    }
    if (truncated) context.warnings.push(`${context.label} 的动作关键帧太多，只保留前面的`);
  }
  const motion: PrevizMotionTracks = { tracks };
  const rootBob = readCurve(
    pick(raw, ['rootBob', 'bob', 'rootY', 'hipsY']),
    PREVIZ_ROOT_BOB_RANGE,
    3,
    'rootBob',
    context,
    allowance()
  );
  if (rootBob) {
    motion.rootBob = rootBob;
    used += rootBob.length;
    budget.remaining -= rootBob.length;
  }
  const lean = readCurve(
    pick(raw, ['lean', 'tilt', 'hipsTilt']),
    PREVIZ_LEAN_RANGE,
    1,
    'lean',
    context,
    allowance()
  );
  if (lean) {
    motion.lean = lean;
    budget.remaining -= lean.length;
  }
  if (!Object.keys(tracks).length && !motion.rootBob && !motion.lean) return null;
  const loop = asBoolean(pick(raw, ['loop', 'repeat', 'cycle']));
  if (loop) motion.loop = true;
  return motion;
}

/**
 * 人物关键帧上的 motion：轨迹 + 权重 + 生成描述。
 * 旧版的动作片段引用（字符串、clip / start / speed）没有可用的轨迹，静默丢弃（引擎回退到姿势）。
 */
export function readMotion(raw: unknown, context: MotionValidateContext): PrevizMotion | undefined {
  if (!isRecord(raw)) return undefined;
  const tracks = readMotionTracks(raw, context);
  const motion: PrevizMotion = tracks ? { ...tracks } : {};
  const generate = asText(pick(raw, ['generate', 'prompt', 'describe', 'description']));
  if (generate) motion.generate = generate.slice(0, PREVIZ_MOTION_PROMPT_MAX);
  if (!motion.tracks && !motion.generate) return undefined;
  if (tracks) {
    const weight = strictNumber(pick(raw, ['weight', 'blend', 'amount']));
    if (weight !== null && weight < 1) motion.weight = roundTo(clamp(weight, [0, 1]), 3);
  }
  return motion;
}

/** 校验 MotionProvider / 追加请求返回的轨迹（也接受外层包一层 motion） */
export function validateMotionTracks(
  raw: unknown,
  label = '生成的动作'
): { ok: true; motion: PrevizMotionTracks; warnings: string[] } | { ok: false; errors: string[] } {
  const warnings: string[] = [];
  const root = isRecord(raw) && isRecord(raw.motion) ? raw.motion : raw;
  if (!isRecord(root)) return { ok: false, errors: ['动作必须是 JSON 对象'] };
  const motion = readMotionTracks(root, { warnings, label });
  if (!motion) return { ok: false, errors: ['动作里没有可用的关节轨迹'] };
  return { ok: true, motion, warnings };
}
