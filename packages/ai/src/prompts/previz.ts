/**
 * 3D 预演提示词：作者描述的镜头动作 / 走位 → PrevizScript（人物关键帧 + 机位关键帧 + 道具 + 时段）
 *
 * 期望结构与校验来自 @novel-editor/video（PREVIZ_JSON_SCHEMA / validatePrevizScript），
 * 这里只负责拼提示词与从回复中提取、校验 JSON。AI 描述「有哪些人物 / 物体、谁在什么时候站在哪、朝哪、
 * 做什么姿势或动作片段、看向哪里、物体怎么动、机位怎么动」，渲染完全由渲染进程的确定性引擎完成。
 * 可用的动作片段（内置 + 作品动作库的 BVH）按 id 列在提示词里；没有合适的片段时 AI 可以写 motion.generate，
 * 配置了动作生成服务（MotionProvider，见 ../motion.ts）时会生成对应的 BVH。
 */
import {
  PREVIZ_ANGLES,
  PREVIZ_EASINGS,
  PREVIZ_JOINTS,
  PREVIZ_JSON_SCHEMA,
  PREVIZ_MAX_DURATION,
  PREVIZ_MOODS,
  PREVIZ_POSES,
  PREVIZ_PROP_KINDS,
  PREVIZ_SHOT_SIZES,
  PREVIZ_STAGE_LIMIT,
  validatePrevizScript,
  type PrevizScript,
  type PrevizShotSize,
} from '@novel-editor/video';
import { truncateToTokens } from '../context/tokens';
import type { ChatMessage } from '../types';
import { extractJson } from './json';

/** 系统提示词里的标记（mock 服务 / 日志据此识别预演请求） */
export const PREVIZ_PROMPT_TAG = 'previz-script/v1';

export interface PrevizCharacter {
  name: string;
  /** 外貌 / 体型要点（只用于理解人物，不影响木偶外观） */
  appearance?: string;
}

export interface PrevizPromptInput {
  /** 作者写的镜头动作与走位（默认取镜头画面描述） */
  action: string;
  shotTitle?: string;
  characters?: readonly PrevizCharacter[];
  shotSize: PrevizShotSize;
  durationSec: number;
  aspectRatio?: string;
  /** 运镜说明（分镜里的 camera 字段） */
  cameraNote?: string;
  location?: string;
  /** 动作描述的 token 上限，默认 1200 */
  actionTokenBudget?: number;
  /** 可用的动作片段（内置 + 作品动作库），AI 按 id 引用 */
  motionClips?: readonly PrevizMotionClipInfo[];
  /** 是否配置了动作生成服务（允许 motion.generate） */
  canGenerateMotion?: boolean;
}

export interface PrevizMotionClipInfo {
  id: string;
  label?: string;
  /** 英文一句话说明（内置动作有） */
  description?: string;
  durationSec?: number;
  loop?: boolean;
}

export interface PrevizPrompt {
  systemPrompt: string;
  prompt: string;
  messages: ChatMessage[];
  schema: typeof PREVIZ_JSON_SCHEMA;
  temperature: number;
  maxTokens: number;
}

const POSE_HINTS: Readonly<Record<(typeof PREVIZ_POSES)[number], string>> = {
  stand: '站立',
  walk: '行走（移动时自动摆臂迈步）',
  run: '奔跑（移动时自动摆臂迈步）',
  sit: '坐（需要椅子时放 chair 道具）',
  crouch: '蹲下',
  kneel: '单膝跪地',
  'draw-sword': '拔剑 / 拔武器',
  'face-off': '对峙 / 格斗架势',
  point: '用右手指向前方',
  talk: '交谈（带手势）',
  'look-back': '回头',
  embrace: '拥抱（两人面对面、相距约 0.4 米）',
  fallen: '倒地',
};

export const PREVIZ_SYSTEM_PROMPT = [
  `[${PREVIZ_PROMPT_TAG}]`,
  '你是一位动作预演（previz）导演，把一个镜头的动作与走位写成给 3D 木偶引擎执行的关键帧脚本。',
  '坐标与约定：',
  `- 地面是 x / z 平面，单位米，范围 ±${PREVIZ_STAGE_LIMIT}；默认机位在 +z 方向看向原点：x 正 = 画面右侧，z 正 = 靠近镜头；`,
  '- facing 是人物朝向（度）：0 = 面向镜头，90 = 面向画面右侧，-90 = 面向画面左侧，180 = 背对镜头；',
  '- 人物身高约 1.77 米，两人对话相距 1–1.5 米，拥抱相距约 0.4 米；',
  '- 关键帧时间 t 单位秒，从 0 到 durationSec；引擎在关键帧之间平滑插值，移动时 walk / run 会自动迈步；',
  '- 机位 yaw 是绕人物环绕的角度（正 = 相机绕到画面右侧），pitch 是额外仰角，height 是机位升降（米）；',
  '  focus 省略时自动对准人物中心；景别越近（close-up）画面越小越近。',
  '要求：',
  `1. pose 只能取：${PREVIZ_POSES.join(', ')}；`,
  `2. camera.shotSize 只能取：${PREVIZ_SHOT_SIZES.join(', ')}；angle 只能取：${PREVIZ_ANGLES.join(', ')}；`,
  `3. mood 只能取：${PREVIZ_MOODS.join(', ')}；props.kind 只能取：${PREVIZ_PROP_KINDS.join(', ')}；`,
  `4. 可选的 joints 是关节微调（度，[x, y, z]），关节名：${PREVIZ_JOINTS.join(', ')}；不确定时不要写；`,
  '5. 每个人物 2–6 个关键帧，机位 1–4 个关键帧；动作要能在时长内完成，人物不要互相穿过；',
  '6. 动作：关键帧的 motion.clip 引用【可用动作片段】里的 id，从这一帧开始播放（覆盖 pose，到下一关键帧前自动过渡），',
  '   可设 start（片段内起点秒）、speed（0.1–4）、loop；没有合适片段时保留 pose，不要编造 id；',
  '7. 视线 lookAt：{ "figure": 人物名 } 或一个点 { x, y, z }；手部目标 hands.left / hands.right 是手要够到的点（米，y 为离地高度）；',
  `8. 缓动 ease（${PREVIZ_EASINGS.join(', ')}）作用于这一帧到下一帧的移动；`,
  '9. 道具 props：kind 之外可写 name、size [宽, 高, 深]（米）、color、y（离地高度）；会移动的物体写 keys（t, x, z, y, facing）。',
  '   不在 kind 列表里的物体用 box / cylinder / sphere 加 size 与 name 表示；',
  '10. 机位 follow 写人物名可让镜头一直对准该人物；需要精确机位时写 position { x, y, z } 与 target { x, y, z }；',
  '11. 只输出一个 JSON 对象，不要任何解释或 Markdown 代码块。',
].join('\n');

export function buildPrevizPrompt(input: PrevizPromptInput): PrevizPrompt {
  const durationSec = Math.min(PREVIZ_MAX_DURATION, Math.max(1, input.durationSec || 6));
  const action = truncateToTokens(input.action.trim(), input.actionTokenBudget ?? 1200, 'head');
  const characterLines = (input.characters ?? [])
    .filter((item) => item.name?.trim())
    .map(
      (item) =>
        `- ${item.name.trim()}${item.appearance?.trim() ? `：${item.appearance.trim()}` : ''}`
    );
  const poseLines = PREVIZ_POSES.map((pose) => `- ${pose}：${POSE_HINTS[pose]}`);
  const clipLines = (input.motionClips ?? []).slice(0, 60).map((clip) => {
    const parts = [clip.label, clip.description].filter(Boolean).join('，');
    const meta = [
      clip.durationSec ? `${Math.round(clip.durationSec * 10) / 10}s` : '',
      clip.loop ? 'loop' : '',
    ]
      .filter(Boolean)
      .join(', ');
    return `- ${clip.id}${parts ? `：${parts}` : ''}${meta ? `（${meta}）` : ''}`;
  });
  const prompt = [
    `【镜头${input.shotTitle ? `：${input.shotTitle}` : ''}】`,
    action.text || '（作者没有写动作，按人物站位给一个自然的走位）',
    ...(characterLines.length
      ? ['', '【出场人物（figures 的 name 必须用这些名字）】', ...characterLines]
      : []),
    ...(input.location?.trim() ? ['', `【地点】${input.location.trim()}`] : []),
    '',
    '【镜头要求】',
    `- 时长 durationSec = ${durationSec}`,
    `- 景别从 ${input.shotSize} 出发（可以推拉）${input.cameraNote?.trim() ? `，运镜：${input.cameraNote.trim()}` : ''}`,
    ...(input.aspectRatio ? [`- 画面比例 ${input.aspectRatio}`] : []),
    '',
    '【可用姿势】',
    ...poseLines,
    '',
    '【可用动作片段（motion.clip）】',
    ...(clipLines.length ? clipLines : ['- （没有可用片段，只用 pose）']),
    ...(input.canGenerateMotion
      ? ['没有合适片段时可以写 motion: { "generate": "一句话描述动作" }，会由动作生成服务生成；']
      : []),
    '',
    '【输出 JSON 结构（JSON Schema）】',
    JSON.stringify(PREVIZ_JSON_SCHEMA),
  ].join('\n');
  return {
    systemPrompt: PREVIZ_SYSTEM_PROMPT,
    prompt,
    messages: [
      { role: 'system', content: PREVIZ_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    schema: PREVIZ_JSON_SCHEMA,
    temperature: 0.5,
    maxTokens: 3200,
  };
}

export type PrevizParseResult =
  | { ok: true; script: PrevizScript; warnings: string[] }
  | { ok: false; errors: string[] };

/**
 * 解析 AI 返回的预演脚本：提取 JSON → 校验 / 夹值。
 * defaults 补全 AI 没给的时长 / 景别 / 人物（AI 给的时长超过上限会被夹到 10 秒）。
 */
export function parsePrevizResponse(
  text: string,
  defaults: {
    characters?: readonly string[];
    durationSec?: number;
    shotSize?: PrevizShotSize;
    /** 可用的动作片段 id：引用不存在的片段会被去掉 */
    availableClips?: readonly string[];
  } = {}
): PrevizParseResult {
  const extracted = extractJson(text);
  if (!extracted.ok) return { ok: false, errors: [extracted.error] };
  return validatePrevizScript(extracted.value, defaults);
}
