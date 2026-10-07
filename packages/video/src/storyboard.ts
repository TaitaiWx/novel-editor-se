/**
 * 分镜（storyboard）数据模型与校验
 *
 * 一个场景拆成 N 个镜头（shot）：景别、时长、画面描述、运镜、出场人物、地点、台词。
 * AI 生成的分镜是「不可信输入」：validateStoryboard 宽松解析（容忍字段别名、字符串数字），
 * 但对结构性错误（没有镜头、时长非法）直接报错，交给调用方提示作者或重试。
 */

export const SHOT_SIZES = ['大远景', '远景', '全景', '中景', '近景', '特写', '大特写'] as const;
export type ShotSize = (typeof SHOT_SIZES)[number];

export const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

/** 单个镜头时长的上下限（秒）：主流文生视频模型单段 2–10 秒 */
export const SHOT_DURATION_MIN = 1;
export const SHOT_DURATION_MAX = 15;
export const STORYBOARD_MAX_SHOTS = 12;

export interface Shot {
  /** 稳定 id（同一分镜内唯一），作者增删排序后不变 */
  id: string;
  /** 景别 */
  shotSize: ShotSize;
  /** 时长（秒） */
  durationSec: number;
  /** 画面描述（交给视频模型的主要提示词） */
  description: string;
  /** 运镜，例如「缓慢推近」「横移」 */
  camera?: string;
  /** 出场人物 */
  characters?: string[];
  /** 地点 */
  location?: string;
  /** 台词 / 旁白（视频模型通常不生成声音，仅供剪辑参考） */
  dialogue?: string;
}

export interface Storyboard {
  version: 1;
  title?: string;
  aspectRatio: AspectRatio;
  /** 画面风格，例如「写实」「国漫」「水墨」 */
  style?: string;
  shots: Shot[];
}

export type StoryboardValidation =
  | { ok: true; storyboard: Storyboard; warnings: string[] }
  | { ok: false; errors: string[] };

/**
 * 期望 AI 返回的 JSON 结构（JSON Schema draft-07 子集）。
 * 同时写进提示词，CLI `ne video storyboard` 也原样输出给 AI agent。
 */
export const STORYBOARD_JSON_SCHEMA = {
  type: 'object',
  required: ['shots'],
  properties: {
    title: { type: 'string' },
    aspectRatio: { type: 'string', enum: [...ASPECT_RATIOS] },
    style: { type: 'string' },
    shots: {
      type: 'array',
      minItems: 1,
      maxItems: STORYBOARD_MAX_SHOTS,
      items: {
        type: 'object',
        required: ['shotSize', 'durationSec', 'description'],
        properties: {
          shotSize: { type: 'string', enum: [...SHOT_SIZES] },
          durationSec: {
            type: 'number',
            minimum: SHOT_DURATION_MIN,
            maximum: SHOT_DURATION_MAX,
          },
          description: { type: 'string', description: '画面描述：主体、动作、环境、光线' },
          camera: { type: 'string', description: '运镜' },
          characters: { type: 'array', items: { type: 'string' } },
          location: { type: 'string' },
          dialogue: { type: 'string' },
        },
      },
    },
  },
} as const;

/** 英文 / 常见别名景别映射到标准景别 */
const SHOT_SIZE_ALIASES: Record<string, ShotSize> = {
  'extreme long shot': '大远景',
  els: '大远景',
  'long shot': '远景',
  ls: '远景',
  wide: '远景',
  'wide shot': '远景',
  'full shot': '全景',
  fs: '全景',
  'medium shot': '中景',
  ms: '中景',
  'medium close-up': '近景',
  mcu: '近景',
  'close-up': '特写',
  'close up': '特写',
  cu: '特写',
  'extreme close-up': '大特写',
  ecu: '大特写',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const match = value.match(/-?\d+(?:\.\d+)?/);
    if (match) return Number(match[0]);
  }
  return undefined;
}

function asStringList(value: unknown): string[] | undefined {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,，、;；]/)
      : [];
  const result = list.map((item) => asText(item)).filter((item): item is string => Boolean(item));
  return result.length ? Array.from(new Set(result)) : undefined;
}

export function normalizeShotSize(value: unknown): ShotSize | undefined {
  const text = asText(value);
  if (!text) return undefined;
  if ((SHOT_SIZES as readonly string[]).includes(text)) return text as ShotSize;
  return SHOT_SIZE_ALIASES[text.toLowerCase()];
}

function pick(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

/** 生成镜头 id：shot-1、shot-2…（与已有 id 不冲突） */
export function createShotId(existing: Iterable<string>): string {
  const used = new Set(existing);
  for (let i = 1; ; i += 1) {
    const id = `shot-${i}`;
    if (!used.has(id)) return id;
  }
}

/**
 * 校验并规范化分镜（接受 AI 原始 JSON 或作者编辑后的对象）。
 * - 缺少景别时默认「中景」并给出警告；时长越界时截断到 [1, 15] 并警告
 * - 没有镜头、镜头缺少画面描述、时长不是数字：报错
 */
export function validateStoryboard(raw: unknown): StoryboardValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const root = Array.isArray(raw) ? { shots: raw } : raw;
  if (!isRecord(root)) return { ok: false, errors: ['分镜必须是 JSON 对象'] };

  const rawShots = pick(root, 'shots', 'scenes', '镜头');
  if (!Array.isArray(rawShots) || rawShots.length === 0) {
    return { ok: false, errors: ['分镜至少需要一个镜头（shots）'] };
  }
  if (rawShots.length > STORYBOARD_MAX_SHOTS) {
    warnings.push(`镜头数量超过 ${STORYBOARD_MAX_SHOTS} 个，只保留前 ${STORYBOARD_MAX_SHOTS} 个`);
  }

  const shots: Shot[] = [];
  const usedIds = new Set<string>();
  rawShots.slice(0, STORYBOARD_MAX_SHOTS).forEach((item, index) => {
    const label = `镜头 ${index + 1}`;
    if (!isRecord(item)) {
      errors.push(`${label} 不是对象`);
      return;
    }
    const description = asText(pick(item, 'description', 'prompt', 'visual', '画面'));
    if (!description) {
      errors.push(`${label} 缺少画面描述（description）`);
      return;
    }
    const rawDuration = pick(item, 'durationSec', 'duration', 'seconds', '时长');
    const parsedDuration = asNumber(rawDuration);
    if (rawDuration !== undefined && parsedDuration === undefined) {
      errors.push(`${label} 的时长不是数字: ${String(rawDuration)}`);
      return;
    }
    let durationSec = parsedDuration ?? 5;
    if (parsedDuration === undefined) warnings.push(`${label} 未指定时长，默认 5 秒`);
    if (durationSec < SHOT_DURATION_MIN || durationSec > SHOT_DURATION_MAX) {
      const clamped = Math.min(SHOT_DURATION_MAX, Math.max(SHOT_DURATION_MIN, durationSec));
      warnings.push(`${label} 时长 ${durationSec} 秒超出范围，已调整为 ${clamped} 秒`);
      durationSec = clamped;
    }
    const rawSize = pick(item, 'shotSize', 'size', 'shot_size', '景别');
    let shotSize = normalizeShotSize(rawSize);
    if (!shotSize) {
      if (rawSize !== undefined) warnings.push(`${label} 的景别「${String(rawSize)}」无法识别`);
      shotSize = '中景';
    }
    const requestedId = asText(item.id);
    const id = requestedId && !usedIds.has(requestedId) ? requestedId : createShotId(usedIds);
    usedIds.add(id);
    const shot: Shot = {
      id,
      shotSize,
      durationSec: Math.round(durationSec * 10) / 10,
      description,
    };
    const camera = asText(pick(item, 'camera', 'cameraMovement', '运镜'));
    const characters = asStringList(pick(item, 'characters', '人物'));
    const location = asText(pick(item, 'location', '地点'));
    const dialogue = asText(pick(item, 'dialogue', 'line', '台词'));
    if (camera) shot.camera = camera;
    if (characters) shot.characters = characters;
    if (location) shot.location = location;
    if (dialogue) shot.dialogue = dialogue;
    shots.push(shot);
  });

  if (errors.length) return { ok: false, errors };

  const rawRatio = asText(pick(root, 'aspectRatio', 'ratio'));
  let aspectRatio: AspectRatio = '16:9';
  if (rawRatio) {
    if ((ASPECT_RATIOS as readonly string[]).includes(rawRatio)) {
      aspectRatio = rawRatio as AspectRatio;
    } else {
      warnings.push(`画面比例「${rawRatio}」不受支持，已使用 16:9`);
    }
  }
  const storyboard: Storyboard = { version: 1, aspectRatio, shots };
  const title = asText(root.title);
  const style = asText(root.style);
  if (title) storyboard.title = title;
  if (style) storyboard.style = style;
  return { ok: true, storyboard, warnings };
}

/** 分镜总时长（秒） */
export function storyboardDurationSec(storyboard: Storyboard): number {
  return storyboard.shots.reduce((sum, shot) => sum + shot.durationSec, 0);
}

/** 导出为 Markdown 分镜表（离线可用：没有配置视频服务时也能交付分镜脚本） */
export function storyboardToMarkdown(storyboard: Storyboard): string {
  const escape = (text: string | undefined) =>
    (text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const lines = [
    `# ${storyboard.title ?? '分镜表'}`,
    '',
    `比例：${storyboard.aspectRatio}${storyboard.style ? ` · 风格：${storyboard.style}` : ''} · 总时长：${storyboardDurationSec(storyboard)} 秒`,
    '',
    '| # | 景别 | 时长 | 画面 | 运镜 | 人物 | 台词 |',
    '|---|---|---|---|---|---|---|',
  ];
  storyboard.shots.forEach((shot, index) => {
    lines.push(
      `| ${index + 1} | ${shot.shotSize} | ${shot.durationSec}s | ${escape(shot.description)} | ${escape(shot.camera)} | ${escape(shot.characters?.join('、'))} | ${escape(shot.dialogue)} |`
    );
  });
  return `${lines.join('\n')}\n`;
}
