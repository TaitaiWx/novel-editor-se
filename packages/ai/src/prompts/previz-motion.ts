/**
 * 预演动作提示词：关节约定（预演脚本与追加请求共用）+ 「一句话动作描述 → 关节轨迹」的追加请求。
 *
 * 文本模型写预演脚本时可以直接写 motion.tracks；动作太复杂时只写 motion.generate（描述），
 * 由 ../motion.ts 的 resolvePrevizMotionRequests 对每个不同的描述追加一次请求（buildMotionPrompt），
 * 回复经 parseMotionResponse → @novel-editor/video validateMotionTracks 校验 / 夹值后写回脚本。
 */
import {
  PREVIZ_JOINTS,
  PREVIZ_JOINT_RANGES,
  PREVIZ_MOTION_MAX_KEYS,
  PREVIZ_MOTION_MAX_SEC,
  previzMotionTracksSchema,
  validateMotionTracks,
  type PrevizMotionTracks,
} from '@novel-editor/video';
import type { ChatMessage } from '../types';
import { extractJson } from './json';

/** 系统提示词里的标记（mock 服务 / 日志据此识别动作追加请求） */
export const PREVIZ_MOTION_PROMPT_TAG = 'previz-motion/v1';

/** 关节表：名字 + 各轴范围（度） */
export function previzJointLines(): string[] {
  return PREVIZ_JOINTS.map((joint) => {
    const [x, y, z] = PREVIZ_JOINT_RANGES[joint];
    return `- ${joint}: x ${x[0]}..${x[1]}, y ${y[0]}..${y[1]}, z ${z[0]}..${z[1]}`;
  });
}

/** 关节约定说明（预演脚本系统提示词与追加请求共用） */
export const PREVIZ_JOINT_CONVENTIONS = [
  '关节轨迹约定：',
  '- tracks 的键是关节名，值是关键帧数组 [t, rx, ry, rz]：t 是相对这一段起点的秒数，角度单位度（XYZ 欧拉角），',
  '  表示关节相对「自然站立、手臂下垂、面向 +z」的局部旋转（不是增量）；没写的关节保持 pose；',
  '- 肢体绕 x 为负 = 向前抬（大臂 x -90 = 手臂向前平举，-170 = 举过头顶）；小臂 x 为负 = 屈肘；小腿 x 为正 = 屈膝；',
  '- 左臂 / 左腿绕 z 为正 = 向外侧展开，右臂 / 右腿绕 z 为负 = 向外侧展开（右大臂 z -150 = 从侧面举过头顶）；',
  '- 躯干 / 颈 / 头绕 x 为正 = 前倾 / 低头，绕 y 为正 = 向人物自己的左侧转；',
  '- rootBob：[t, 米] 髋部上下起伏（负 = 下沉）；lean：[t, 度] 整体前倾（负 = 后仰）；',
  `- 每个关节最多 ${PREVIZ_MOTION_MAX_KEYS} 个关键帧，通常 3–8 个就够，引擎会平滑插值并夹到关节范围；`,
  '- loop: true 时轨迹循环播放，最后一个关键帧要与第一个相同。',
].join('\n');

/** 紧凑示例：右手举起挥手（循环） */
export const PREVIZ_MOTION_EXAMPLE = {
  tracks: {
    rightUpperArm: [
      [0, 0, 0, -150],
      [0.4, 0, 0, -160],
      [0.8, 0, 0, -150],
    ],
    rightForearm: [
      [0, -20, 0, 25],
      [0.4, -20, 0, -25],
      [0.8, -20, 0, 25],
    ],
  },
  loop: true,
} as const;

export interface MotionPromptInput {
  description: string;
  durationSec: number;
  /** 人物名（只帮助理解） */
  figure?: string;
  /** 起始姿势 id（stand / walk …） */
  pose?: string;
}

export interface MotionPrompt {
  systemPrompt: string;
  prompt: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
}

export const PREVIZ_MOTION_SYSTEM_PROMPT = [
  `[${PREVIZ_MOTION_PROMPT_TAG}]`,
  '你是一位动作设计师，把一句动作描述写成 3D 木偶的关节动画（关键帧轨迹）。',
  PREVIZ_JOINT_CONVENTIONS,
  '关节与范围（度）：',
  ...previzJointLines(),
  '只输出一个 JSON 对象 { "tracks": {...}, "rootBob"?: [...], "lean"?: [...], "loop"?: boolean }，不要任何解释或 Markdown 代码块。',
].join('\n');

export function buildMotionPrompt(input: MotionPromptInput): MotionPrompt {
  const durationSec = Math.min(PREVIZ_MOTION_MAX_SEC, Math.max(0.5, input.durationSec || 2));
  const prompt = [
    `【动作】${input.description.trim()}`,
    ...(input.figure ? [`【人物】${input.figure}`] : []),
    ...(input.pose ? [`【起始姿势】${input.pose}`] : []),
    `【时长】${Math.round(durationSec * 100) / 100} 秒（关键帧时间 0 到 ${Math.round(durationSec * 100) / 100}）`,
    '',
    '【示例：举起右手挥手（循环）】',
    JSON.stringify(PREVIZ_MOTION_EXAMPLE),
    '',
    '【输出 JSON 结构】',
    JSON.stringify({ type: 'object', properties: previzMotionTracksSchema(PREVIZ_JOINTS) }),
  ].join('\n');
  return {
    systemPrompt: PREVIZ_MOTION_SYSTEM_PROMPT,
    prompt,
    messages: [
      { role: 'system', content: PREVIZ_MOTION_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    temperature: 0.4,
    maxTokens: 2400,
  };
}

export type MotionParseResult =
  | { ok: true; motion: PrevizMotionTracks; warnings: string[] }
  | { ok: false; errors: string[] };

/** 解析追加请求的回复：提取 JSON → 校验 / 夹值 */
export function parseMotionResponse(text: string): MotionParseResult {
  const extracted = extractJson(text);
  if (!extracted.ok) return { ok: false, errors: [extracted.error] };
  return validateMotionTracks(extracted.value);
}
