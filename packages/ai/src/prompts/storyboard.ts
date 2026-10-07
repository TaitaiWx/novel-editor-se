/**
 * 分镜提示词：场景正文 → 3–6 个镜头的 JSON（场景视频 / CLI ne video storyboard 共用）
 *
 * 期望结构与校验来自 @novel-editor/video（STORYBOARD_JSON_SCHEMA / validateStoryboard），
 * 这里只负责拼提示词与从回复中提取、校验 JSON。
 */
import {
  ASPECT_RATIOS,
  NARRATOR,
  languageLabel,
  normalizeLanguage,
  SHOT_SIZES,
  STORYBOARD_JSON_SCHEMA,
  validateStoryboard,
  type AspectRatio,
  type Storyboard,
} from '@novel-editor/video';
import { truncateToTokens } from '../context/tokens';
import type { ChatMessage } from '../types';
import { extractJson } from './json';

export interface StoryboardCharacter {
  name: string;
  /** 外貌要点（用于画面描述的一致性） */
  appearance?: string;
}

export interface StoryboardPromptInput {
  sceneText: string;
  sceneTitle?: string;
  characters?: StoryboardCharacter[];
  location?: string;
  style?: string;
  aspectRatio?: AspectRatio;
  /** 期望镜头数范围，默认 3–6 */
  minShots?: number;
  maxShots?: number;
  /** 场景正文的 token 上限，默认 3000 */
  sceneTokenBudget?: number;
  /** 对白语言（BCP-47）；给出时要求台词保持 / 译为该语言 */
  language?: string;
}

export interface StoryboardPrompt {
  systemPrompt: string;
  prompt: string;
  messages: ChatMessage[];
  schema: typeof STORYBOARD_JSON_SCHEMA;
  temperature: number;
  maxTokens: number;
}

export const STORYBOARD_SYSTEM_PROMPT = [
  '你是一位影视分镜师，负责把小说场景拆成可交给文生视频模型的镜头脚本。',
  '要求：',
  `1. 景别只能取：${SHOT_SIZES.join('、')}；`,
  '2. 每个镜头的 description 是一段可直接用于视频生成的画面描述：主体 + 动作 + 环境 + 光线 / 氛围，具体可视，不写心理活动；',
  '3. 同一人物在各镜头中的外貌描述保持一致；',
  '4. 每个镜头时长 durationSec 在 3–10 秒之间；',
  `5. 从正文中提取每个镜头里说出口的对白，写进 dialogue 数组：speaker 为说话的人物名（只用出场人物里的名字），旁白 / 画外音写 ${NARRATOR}，text 为台词原文，可选 emotion（平静 / 开心 / 悲伤 / 愤怒 / 害怕 / 惊讶 / 厌恶）；不要编造正文里没有的台词；`,
  '6. 可选 sfx 数组：该镜头值得强调的音效（prompt 简短描述，atSec 为相对镜头开始的秒数）；',
  '7. 只输出一个 JSON 对象，不要任何解释或 Markdown 代码块。',
].join('\n');

export function buildStoryboardPrompt(input: StoryboardPromptInput): StoryboardPrompt {
  const minShots = Math.max(1, input.minShots ?? 3);
  const maxShots = Math.max(minShots, input.maxShots ?? 6);
  const scene = truncateToTokens(input.sceneText.trim(), input.sceneTokenBudget ?? 3000, 'head');
  const aspectRatio =
    input.aspectRatio && ASPECT_RATIOS.includes(input.aspectRatio) ? input.aspectRatio : '16:9';
  const language = normalizeLanguage(input.language);
  const characterLines = (input.characters ?? [])
    .filter((item) => item.name?.trim())
    .map(
      (item) =>
        `- ${item.name.trim()}${item.appearance?.trim() ? `：${item.appearance.trim()}` : ''}`
    );
  const prompt = [
    `【场景${input.sceneTitle ? `：${input.sceneTitle}` : ''}】`,
    scene.text,
    ...(characterLines.length ? ['', '【出场人物】', ...characterLines] : []),
    ...(input.location?.trim() ? ['', `【地点】${input.location.trim()}`] : []),
    '',
    '【分镜要求】',
    `- 拆成 ${minShots}–${maxShots} 个镜头，按时间顺序排列`,
    `- 画面比例 ${aspectRatio}${input.style?.trim() ? `，画面风格：${input.style.trim()}` : ''}`,
    ...(language ? [`- 对白语言：${languageLabel(language)}（${language}），台词保持该语言`] : []),
    '',
    '【输出 JSON 结构（JSON Schema）】',
    JSON.stringify(STORYBOARD_JSON_SCHEMA),
  ].join('\n');
  return {
    systemPrompt: STORYBOARD_SYSTEM_PROMPT,
    prompt,
    messages: [
      { role: 'system', content: STORYBOARD_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    schema: STORYBOARD_JSON_SCHEMA,
    temperature: 0.7,
    maxTokens: 600 * maxShots,
  };
}

export type StoryboardParseResult =
  | { ok: true; storyboard: Storyboard; warnings: string[] }
  | { ok: false; errors: string[] };

/**
 * 解析 AI 返回的分镜：提取 JSON → 校验 / 规范化。
 * defaults 用于补全 AI 没给出的比例与风格（作者在界面上选的值优先）。
 */
export function parseStoryboardResponse(
  text: string,
  defaults: { aspectRatio?: AspectRatio; style?: string; title?: string } = {}
): StoryboardParseResult {
  const extracted = extractJson(text);
  if (!extracted.ok) return { ok: false, errors: [extracted.error] };
  const validation = validateStoryboard(extracted.value);
  if (!validation.ok) return validation;
  const storyboard: Storyboard = { ...validation.storyboard };
  if (defaults.aspectRatio) storyboard.aspectRatio = defaults.aspectRatio;
  if (defaults.style && !storyboard.style) storyboard.style = defaults.style;
  if (defaults.title && !storyboard.title) storyboard.title = defaults.title;
  return { ok: true, storyboard, warnings: validation.warnings };
}
