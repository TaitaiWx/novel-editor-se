/**
 * 续写提示词（Grok 续写 / CLI ne ai continue 共用）
 *
 * 只产出提示词与生成参数，不调用模型；结果清理（去掉复述的前文、引号、代码块）也在这里，
 * 保证 GUI 与 CLI 插入的文本一致。
 */
import type { AssembledContext } from '../context/assembler';
import type { ChatMessage } from '../types';

export const CONTINUATION_LENGTHS = ['sentence', 'paragraph', 'long'] as const;
export type ContinuationLength = (typeof CONTINUATION_LENGTHS)[number];

export const CONTINUATION_DIRECTIONS = ['continue', 'conflict', 'wrap-up'] as const;
export type ContinuationDirection = (typeof CONTINUATION_DIRECTIONS)[number];

const LENGTH_SPEC: Record<ContinuationLength, { instruction: string; chars: number }> = {
  sentence: { instruction: '只续写一到两句话', chars: 60 },
  paragraph: { instruction: '续写一个自然段（约 150–250 字）', chars: 250 },
  long: { instruction: '续写约 500 字，可分为数个自然段', chars: 500 },
};

const DIRECTION_TEXT: Record<ContinuationDirection, string> = {
  continue: '顺着当前情节与节奏自然往下写',
  conflict: '在不违背设定的前提下制造新的冲突或悬念',
  'wrap-up': '开始收束本章的情节，为章末留下余韵或钩子',
};

export interface ContinuationPromptInput {
  context: AssembledContext;
  length?: ContinuationLength;
  /** 预设方向，或作者自由输入的一句话 */
  direction?: ContinuationDirection | string;
  /** 是否严格遵循章纲 */
  followOutline?: boolean;
  /** 指定字数（覆盖 length 的默认字数） */
  chars?: number;
}

export interface ContinuationPrompt {
  systemPrompt: string;
  prompt: string;
  messages: ChatMessage[];
  /** 建议的 max_tokens（按字数估算并留余量） */
  maxTokens: number;
  temperature: number;
  targetChars: number;
}

export const CONTINUATION_SYSTEM_PROMPT = [
  '你是一位资深中文小说作者的写作搭档，负责在作者的光标处续写正文。',
  '要求：',
  '1. 只输出续写的正文本身，不要标题、解释、引号包裹或 Markdown 代码块；',
  '2. 不要重复前文已经写过的句子，从光标处无缝接上；',
  '3. 保持与前文一致的人称、时态、文风、人物口吻与用词习惯；',
  '4. 严格遵守【核心规则】与【成长档案】中的设定：人物的等级、属性、技能不得超出记录，不要凭空获得能力；',
  '5. 不要替作者推进到章纲之外的重大情节转折。',
].join('\n');

function isPresetDirection(value: string): value is ContinuationDirection {
  return (CONTINUATION_DIRECTIONS as readonly string[]).includes(value);
}

export function buildContinuationPrompt(input: ContinuationPromptInput): ContinuationPrompt {
  const length = input.length ?? 'paragraph';
  const spec = LENGTH_SPEC[length];
  const targetChars =
    typeof input.chars === 'number' && input.chars > 0 ? Math.round(input.chars) : spec.chars;
  const direction = input.direction?.trim() || 'continue';
  const directionText = isPresetDirection(direction)
    ? DIRECTION_TEXT[direction]
    : `按作者的要求续写：${direction}`;
  const hasOutline = input.context.sections.some((section) => section.key === 'outline');
  const instructions = [
    typeof input.chars === 'number' && input.chars > 0
      ? `续写约 ${targetChars} 字`
      : spec.instruction,
    directionText,
    hasOutline
      ? input.followOutline === false
        ? '章纲仅供参考，可以自由发挥'
        : '情节发展需与【本章章纲】保持一致'
      : '',
    input.context.sections.some((section) => section.key === 'following')
      ? '续写内容要能与【光标后的内容】自然衔接'
      : '',
  ].filter(Boolean);
  const prompt = [
    input.context.text || '（暂无前文，这是本章的开头）',
    '',
    '【续写要求】',
    ...instructions.map((line, index) => `${index + 1}. ${line}`),
    '',
    '请直接输出续写的正文：',
  ].join('\n');
  return {
    systemPrompt: CONTINUATION_SYSTEM_PROMPT,
    prompt,
    messages: [
      { role: 'system', content: CONTINUATION_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    // 中文 1 字约 1 token（偏保守），留 50% 余量，避免截断在句中
    maxTokens: Math.max(64, Math.ceil(targetChars * 1.5)),
    temperature: direction === 'conflict' ? 1.0 : 0.85,
    targetChars,
  };
}

/** 求 a 的后缀与 b 的前缀的最长重叠（模型有时会先复述前文的最后一句） */
function overlapLength(a: string, b: string, max = 200): number {
  const limit = Math.min(a.length, b.length, max);
  for (let len = limit; len >= 4; len -= 1) {
    if (a.endsWith(b.slice(0, len))) return len;
  }
  return 0;
}

/**
 * 清理模型输出：去掉代码块 / 整体引号 / 「续写：」之类的前缀，以及与前文重复的开头
 */
export function cleanContinuationOutput(text: string, precedingText = ''): string {
  let result = (text ?? '').replace(/\r\n/g, '\n');
  const fenced = result.match(/^\s*```[a-zA-Z]*\n([\s\S]*?)\n?```\s*$/);
  if (fenced) result = fenced[1];
  result = result.replace(
    /^\s*(\u7eed\u5199(\u5185\u5bb9|\u6b63\u6587)?|\u6b63\u6587|\u4ee5\u4e0b\u662f\u7eed\u5199(\u5185\u5bb9)?)[:\uff1a]\s*/u,
    ''
  );
  const quoted = result.trim().match(/^[\u201c"\u300c]([\s\S]*)[\u201d"\u300d]$/u);
  if (quoted && !/[\u201c"\u300c\u201d"\u300d]/u.test(quoted[1])) result = quoted[1];
  const tail = precedingText.trimEnd();
  const trimmedStart = result.replace(/^\s+/, '');
  const overlap = overlapLength(tail, trimmedStart);
  if (overlap > 0) result = trimmedStart.slice(overlap);
  return result.replace(/\s+$/u, '');
}
