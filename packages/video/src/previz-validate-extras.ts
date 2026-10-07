/**
 * 预演脚本第 2 版字段的校验：缓动、动作片段、视线、手部目标、道具尺寸 / 颜色 / 关键帧、机位跟随 / 绝对机位。
 * 第 1 版脚本没有这些字段，读取结果与原来一致（向下兼容）。
 */
import {
  PREVIZ_CLIP_ID_MAX,
  PREVIZ_EASINGS,
  PREVIZ_MAX_PROP_KEYS,
  PREVIZ_MOTION_PROMPT_MAX,
  PREVIZ_MOTION_SPEED_MAX,
  PREVIZ_MOTION_SPEED_MIN,
  PREVIZ_POINT_Y_MAX,
  PREVIZ_POINT_Y_MIN,
  PREVIZ_PROP_SIZE_MAX,
  clampNumber,
  clampToPrevizStage,
  normalizeDegrees,
  roundTo,
  type PrevizEase,
  type PrevizFigureTrack,
  type PrevizHandTargets,
  type PrevizLookAt,
  type PrevizMotionRef,
  type PrevizPoint3,
  type PrevizPropKey,
} from './previz';
import {
  FACING_KEYS,
  TIME_KEYS,
  asBoolean,
  asNumber,
  asText,
  isRecord,
  pick,
  readPoint,
  slug,
} from './previz-validate-utils';

const EASE_ALIASES: Readonly<Record<string, PrevizEase>> = {
  linear: 'linear',
  none: 'linear',
  constant: 'linear',
  'ease-in': 'ease-in',
  easein: 'ease-in',
  accelerate: 'ease-in',
  'ease-out': 'ease-out',
  easeout: 'ease-out',
  decelerate: 'ease-out',
  'ease-in-out': 'ease-in-out',
  easeinout: 'ease-in-out',
  ease: 'ease-in-out',
  smooth: 'ease-in-out',
};

export function readEase(value: unknown): PrevizEase | undefined {
  const text = asText(value);
  if (!text) return undefined;
  const id = slug(text);
  if ((PREVIZ_EASINGS as readonly string[]).includes(id)) return id as PrevizEase;
  return EASE_ALIASES[id] ?? EASE_ALIASES[id.replace(/-/g, '')];
}

/** 三维点（米）：x / z 夹在舞台内，y 夹在 0–12 */
export function readPoint3(raw: unknown, defaultY: number): PrevizPoint3 | undefined {
  let record: Record<string, unknown> | null = null;
  if (isRecord(raw)) record = raw;
  else if (Array.isArray(raw) && raw.length >= 2) {
    record = raw.length >= 3 ? { x: raw[0], y: raw[1], z: raw[2] } : { x: raw[0], z: raw[1] };
  }
  if (!record) return undefined;
  const x = asNumber(record.x);
  const z = asNumber(record.z);
  if (x === undefined || z === undefined) return undefined;
  const y = asNumber(pick(record, ['y', 'height']));
  return {
    x: clampToPrevizStage(x),
    y: roundTo(clampNumber(y ?? defaultY, PREVIZ_POINT_Y_MIN, PREVIZ_POINT_Y_MAX), 3),
    z: clampToPrevizStage(z),
  };
}

export interface MotionValidateContext {
  /** 可用的片段 id（内置 + 动作库）；省略时不检查是否存在（例如读取已保存的脚本） */
  availableClips?: readonly string[];
  warnings: string[];
  label: string;
}

/** 片段 id：允许省略 builtin: / lib: 前缀（在可用列表里查找） */
function resolveClipId(raw: string, available: readonly string[] | undefined): string | null {
  const id = raw.trim().slice(0, PREVIZ_CLIP_ID_MAX);
  if (!id) return null;
  if (!available) return id;
  if (available.includes(id)) return id;
  for (const candidate of [`builtin:${id}`, `builtin:${slug(id)}`, `lib:${id}`]) {
    if (available.includes(candidate)) return candidate;
  }
  return null;
}

/** 动作片段引用：字符串（clip id）或对象 { clip, start, speed, loop, generate } */
export function readMotion(
  raw: unknown,
  context: MotionValidateContext
): PrevizMotionRef | undefined {
  if (raw === undefined || raw === null) return undefined;
  const record: Record<string, unknown> | null =
    typeof raw === 'string' ? { clip: raw } : isRecord(raw) ? raw : null;
  if (!record) return undefined;
  const motion: PrevizMotionRef = {};
  const rawClip = asText(pick(record, ['clip', 'id', 'clipId', 'name', 'motion']));
  if (rawClip) {
    const clip = resolveClipId(rawClip, context.availableClips);
    if (clip) motion.clip = clip;
    else context.warnings.push(`${context.label} 的动作 ${rawClip} 不在动作库里，已改用姿势`);
  }
  const generate = asText(pick(record, ['generate', 'prompt', 'describe', 'description']));
  if (generate) motion.generate = generate.slice(0, PREVIZ_MOTION_PROMPT_MAX);
  if (!motion.clip && !motion.generate) return undefined;
  const start = asNumber(pick(record, ['start', 'offset', 'from']));
  if (start !== undefined && start > 0) motion.start = roundTo(clampNumber(start, 0, 600), 3);
  const speed = asNumber(pick(record, ['speed', 'rate', 'timeScale']));
  if (speed !== undefined && speed !== 1) {
    motion.speed = roundTo(
      clampNumber(Math.abs(speed), PREVIZ_MOTION_SPEED_MIN, PREVIZ_MOTION_SPEED_MAX),
      3
    );
  }
  const loop = asBoolean(pick(record, ['loop', 'repeat', 'cycle']));
  if (loop !== undefined) motion.loop = loop;
  return motion;
}

/** 视线：{ figure: 名字 } / 名字字符串 / 点；人物名在所有人物读完后再换成 id（resolveFigureRefs） */
export function readLookAt(raw: unknown): PrevizLookAt | undefined {
  if (typeof raw === 'string') {
    const name = asText(raw);
    return name ? { figure: name } : undefined;
  }
  if (!isRecord(raw)) return undefined;
  const figure = asText(pick(raw, ['figure', 'character', 'who', 'name', 'target']));
  if (figure) return { figure };
  return readPoint3(raw, 1.6);
}

export function readHands(raw: unknown): PrevizHandTargets | undefined {
  if (!isRecord(raw)) return undefined;
  const hands: PrevizHandTargets = {};
  const left = readPoint3(pick(raw, ['left', 'leftHand', 'l']), 1);
  const right = readPoint3(pick(raw, ['right', 'rightHand', 'r']), 1);
  if (left) hands.left = left;
  if (right) hands.right = right;
  return hands.left || hands.right ? hands : undefined;
}

/** 人物引用（名字 / id）→ 人物 id；找不到时为 null */
function figureIdOf(ref: string, figures: readonly PrevizFigureTrack[]): string | null {
  const key = ref.trim().toLowerCase();
  const hit =
    figures.find((item) => item.id.toLowerCase() === key) ??
    figures.find((item) => item.name.trim().toLowerCase() === key);
  return hit?.id ?? null;
}

/** 把视线 / 跟随里的人物名字换成人物 id；不存在的引用去掉并给出警告 */
export function resolveFigureRef(
  ref: string,
  figures: readonly PrevizFigureTrack[],
  warnings: string[],
  label: string
): string | null {
  const id = figureIdOf(ref, figures);
  if (!id) warnings.push(`${label} 引用的人物 ${ref} 不存在，已忽略`);
  return id;
}

export function resolveFigureLookAts(figures: PrevizFigureTrack[], warnings: string[]): void {
  for (const track of figures) {
    for (const key of track.keys) {
      if (!key.lookAt || !('figure' in key.lookAt)) continue;
      const id = resolveFigureRef(key.lookAt.figure, figures, warnings, `${track.name} 的视线`);
      if (id && id !== track.id) key.lookAt = { figure: id };
      else delete key.lookAt;
    }
  }
}

/** 道具尺寸：[宽, 高, 深] / { w, h, d } / 单个数字（等比） */
export function readSize(raw: unknown): [number, number, number] | undefined {
  let values: (number | undefined)[] = [];
  if (Array.isArray(raw)) values = raw.slice(0, 3).map(asNumber);
  else if (isRecord(raw)) {
    values = [
      asNumber(pick(raw, ['w', 'width', 'x'])),
      asNumber(pick(raw, ['h', 'height', 'y'])),
      asNumber(pick(raw, ['d', 'depth', 'z'])),
    ];
  } else {
    const single = asNumber(raw);
    if (single !== undefined) values = [single, single, single];
  }
  if (values.length !== 3 || values.some((value) => value === undefined)) return undefined;
  return values.map((value) =>
    roundTo(clampNumber(Math.abs(value ?? 1), 0.02, PREVIZ_PROP_SIZE_MAX), 3)
  ) as [number, number, number];
}

/** 道具关键帧（按时间排序，同一时间保留最后一个） */
export function readPropKeys(raw: unknown, duration: number): PrevizPropKey[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const list = raw.slice(0, PREVIZ_MAX_PROP_KEYS);
  const keys: PrevizPropKey[] = [];
  let previous: PrevizPropKey | null = null;
  list.forEach((item, index) => {
    if (!isRecord(item)) return;
    const point = readPoint(item);
    const fallbackT = list.length > 1 ? (duration * index) / (list.length - 1) : 0;
    const key: PrevizPropKey = {
      t: roundTo(clampNumber(asNumber(pick(item, TIME_KEYS)) ?? fallbackT, 0, duration), 3),
      x: clampToPrevizStage(point.x ?? previous?.x ?? 0),
      z: clampToPrevizStage(point.z ?? previous?.z ?? 0),
      facing: normalizeDegrees(asNumber(pick(item, FACING_KEYS)) ?? previous?.facing ?? 0),
    };
    const y = asNumber(pick(item, ['y', 'height', 'elevation']));
    if (y !== undefined || previous?.y !== undefined) {
      key.y = roundTo(
        clampNumber(y ?? previous?.y ?? 0, PREVIZ_POINT_Y_MIN, PREVIZ_POINT_Y_MAX),
        3
      );
    }
    const ease = readEase(item.ease);
    if (ease && ease !== 'linear') key.ease = ease;
    keys.push(key);
    previous = key;
  });
  const byTime = new Map<number, PrevizPropKey>();
  for (const key of keys) byTime.set(key.t, key);
  const sorted = [...byTime.values()].sort((a, b) => a.t - b.t);
  return sorted.length ? sorted : undefined;
}
