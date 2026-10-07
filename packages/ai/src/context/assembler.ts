/**
 * 写作上下文组装器：把 章正文 / 章纲 / 人物卡 / 成长档案 / 核心规则 / 设定 按 token 预算拼成提示词上下文
 *
 * 裁剪是确定性的（相同输入 → 相同输出），GUI 与 CLI 共用：
 * 1. 可选分区按优先级各有一个上限比例（规则 > 章纲 > 人物 > 成长 > 设定 > 后文），先各自截断到上限
 * 2. 前文（光标前的正文，保留结尾）拿走剩余预算，至少保证 MIN_PRECEDING_SHARE
 * 3. 前文较短用不完时，剩余预算按优先级回填给被截断的分区
 * 人物按「在光标附近被提及的次数」排序，没被提及的人物排在最后、最先被裁掉。
 */
import { estimateTokens, truncateToTokens } from './tokens';

export interface ContextCharacter {
  name: string;
  aliases?: string[];
  /** 一句话简介 / 人物卡要点 */
  summary?: string;
  /** 当前状态（最近 1–2 条） */
  status?: string;
}

export interface ContextGrowth {
  name: string;
  level?: number;
  /** 成长卡摘要：属性、技能、近期事件 */
  summary: string;
}

export interface ContextLore {
  title: string;
  content: string;
}

export interface WritingContextInput {
  chapterText: string;
  /** 光标在 chapterText 中的偏移（UTF-16），默认文末 */
  cursor?: number;
  chapterTitle?: string;
  /** 章纲（也可以是多条要点） */
  outline?: string | string[];
  characters?: ContextCharacter[];
  growth?: ContextGrowth[];
  /** 作者的核心规则（战力上限、世界观铁律…） */
  rules?: string[];
  lore?: ContextLore[];
  /** token 预算（只计上下文本身，不含指令） */
  budget: number;
  /** 是否带上光标后的文字（插入到中间时有用），默认 true */
  includeFollowing?: boolean;
}

export type ContextSectionKey =
  | 'rules'
  | 'outline'
  | 'characters'
  | 'growth'
  | 'lore'
  | 'following'
  | 'preceding';

export interface AssembledSection {
  key: ContextSectionKey;
  label: string;
  text: string;
  tokens: number;
  truncated: boolean;
  /** 因预算被整条丢弃的条目数（人物 / 成长 / 设定 / 规则） */
  omittedItems: number;
}

export interface AssembledContext {
  sections: AssembledSection[];
  /** 渲染后的完整上下文（带分区标题） */
  text: string;
  usedTokens: number;
  budget: number;
  /** 光标前的正文（未截断），续写结果清理时用于去重 */
  precedingText: string;
}

export const SECTION_LABELS: Record<ContextSectionKey, string> = {
  rules: '核心规则',
  outline: '本章章纲',
  characters: '出场人物',
  growth: '成长档案',
  lore: '相关设定',
  following: '光标后的内容',
  preceding: '前文',
};

/** 各可选分区的预算上限（占总预算的比例），顺序即回填优先级 */
export const SECTION_SHARES: ReadonlyArray<[Exclude<ContextSectionKey, 'preceding'>, number]> = [
  ['rules', 0.12],
  ['outline', 0.15],
  ['characters', 0.15],
  ['growth', 0.1],
  ['lore', 0.08],
  ['following', 0.05],
];
export const MIN_PRECEDING_SHARE = 0.35;

/** 统计人物在文本中被提及的次数（姓名 + 别名） */
export function countMentions(text: string, character: ContextCharacter): number {
  let count = 0;
  for (const name of [character.name, ...(character.aliases ?? [])]) {
    const needle = name.trim();
    if (!needle) continue;
    let index = text.indexOf(needle);
    while (index !== -1) {
      count += 1;
      index = text.indexOf(needle, index + needle.length);
    }
  }
  return count;
}

function formatCharacter(character: ContextCharacter): string {
  const aliases = character.aliases?.filter(Boolean).length
    ? `（又名 ${character.aliases.filter(Boolean).join('、')}）`
    : '';
  const parts = [
    character.summary?.trim(),
    character.status?.trim() ? `当前：${character.status.trim()}` : '',
  ]
    .filter(Boolean)
    .join('；');
  return `- ${character.name}${aliases}${parts ? `：${parts}` : ''}`;
}

function formatGrowth(item: ContextGrowth): string {
  const level = typeof item.level === 'number' ? ` Lv.${item.level}` : '';
  return `- ${item.name}${level}：${item.summary.trim()}`;
}

/** 条目列表按整条装入预算，放不下的整条丢弃；第一条放不下时截断它 */
function fitItems(
  lines: string[],
  maxTokens: number
): { text: string; omitted: number; truncated: boolean } {
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const cost = estimateTokens(line) + (kept.length ? 1 : 0);
    if (used + cost > maxTokens) break;
    kept.push(line);
    used += cost;
  }
  if (kept.length === 0 && lines.length > 0) {
    const cut = truncateToTokens(lines[0], maxTokens, 'head');
    return { text: cut.text, omitted: cut.text ? lines.length - 1 : lines.length, truncated: true };
  }
  return {
    text: kept.join('\n'),
    omitted: lines.length - kept.length,
    truncated: kept.length < lines.length,
  };
}

interface SectionSource {
  key: ContextSectionKey;
  kind: 'items' | 'text';
  items?: string[];
  text?: string;
  keep: 'head' | 'tail';
}

function fitSection(source: SectionSource, maxTokens: number): AssembledSection {
  const label = SECTION_LABELS[source.key];
  if (maxTokens <= 0) {
    const omittedItems = source.items?.length ?? 0;
    return { key: source.key, label, text: '', tokens: 0, truncated: true, omittedItems };
  }
  if (source.kind === 'items') {
    const fitted = fitItems(source.items ?? [], maxTokens);
    return {
      key: source.key,
      label,
      text: fitted.text,
      tokens: estimateTokens(fitted.text),
      truncated: fitted.truncated,
      omittedItems: fitted.omitted,
    };
  }
  const cut = truncateToTokens(source.text ?? '', maxTokens, source.keep);
  return {
    key: source.key,
    label,
    text: cut.text,
    tokens: cut.tokens,
    truncated: cut.truncated,
    omittedItems: 0,
  };
}

function fullTokens(source: SectionSource): number {
  if (source.kind === 'items') {
    const items = source.items ?? [];
    return items.reduce((sum, line, index) => sum + estimateTokens(line) + (index ? 1 : 0), 0);
  }
  return estimateTokens(source.text ?? '');
}

/** 分区标题本身的开销（「【前文】\n」+ 分隔空行） */
function headingTokens(key: ContextSectionKey, chapterTitle?: string): number {
  const title = key === 'preceding' && chapterTitle ? `（${chapterTitle}）` : '';
  return estimateTokens(`【${SECTION_LABELS[key]}${title}】\n\n\n`);
}

export function assembleWritingContext(input: WritingContextInput): AssembledContext {
  const budget = Math.max(0, Math.floor(input.budget));
  const text = input.chapterText ?? '';
  const cursor = Math.min(Math.max(0, input.cursor ?? text.length), text.length);
  const precedingText = text.slice(0, cursor);
  const followingText = input.includeFollowing === false ? '' : text.slice(cursor).trim();

  // 人物按光标附近（前 3000 字 + 章纲）的提及次数排序
  const nearby = `${precedingText.slice(-3000)}\n${followingText.slice(0, 500)}\n${
    Array.isArray(input.outline) ? input.outline.join('\n') : (input.outline ?? '')
  }`;
  const characters = (input.characters ?? [])
    .filter((item) => item.name?.trim())
    .map((item, index) => ({ item, index, mentions: countMentions(nearby, item) }))
    .sort((a, b) => b.mentions - a.mentions || a.index - b.index);
  const mentionedNames = new Set(
    characters.filter((entry) => entry.mentions > 0).map((entry) => entry.item.name)
  );
  // 成长档案只保留被提及的人物（没提及的人物不影响本段战力）；都没提及时保留全部
  const growthItems = (input.growth ?? []).filter((item) => item.summary?.trim());
  const relevantGrowth =
    mentionedNames.size > 0
      ? growthItems.filter((item) => mentionedNames.has(item.name))
      : growthItems;

  const outlineText = Array.isArray(input.outline)
    ? input.outline
        .filter((line) => line.trim())
        .map((line) => `- ${line.trim()}`)
        .join('\n')
    : (input.outline ?? '').trim();

  const sources: Record<Exclude<ContextSectionKey, 'preceding'>, SectionSource> = {
    rules: {
      key: 'rules',
      kind: 'items',
      items: (input.rules ?? [])
        .map((rule) => rule.trim())
        .filter(Boolean)
        .map((rule) => `- ${rule}`),
      keep: 'head',
    },
    outline: { key: 'outline', kind: 'text', text: outlineText, keep: 'head' },
    characters: {
      key: 'characters',
      kind: 'items',
      items: characters.map((entry) => formatCharacter(entry.item)),
      keep: 'head',
    },
    growth: { key: 'growth', kind: 'items', items: relevantGrowth.map(formatGrowth), keep: 'head' },
    lore: {
      key: 'lore',
      kind: 'items',
      items: (input.lore ?? [])
        .filter((item) => item.title?.trim() || item.content?.trim())
        .map((item) => `- ${item.title.trim()}：${item.content.trim().replace(/\s+/g, ' ')}`),
      keep: 'head',
    },
    following: { key: 'following', kind: 'text', text: followingText, keep: 'head' },
  };

  const present = SECTION_SHARES.filter(([key]) => fullTokens(sources[key]) > 0);
  const precedingSource: SectionSource = {
    key: 'preceding',
    kind: 'text',
    text: precedingText,
    keep: 'tail',
  };
  const allKeys: ContextSectionKey[] = [
    ...present.map(([key]) => key),
    ...(precedingText ? ['preceding' as const] : []),
  ];
  const overhead = allKeys.reduce((sum, key) => sum + headingTokens(key, input.chapterTitle), 0);
  const contentBudget = Math.max(0, budget - overhead);

  // 第一轮：可选分区各取上限，但总和不超过 (1 - MIN_PRECEDING_SHARE)（前文为空时不受限）
  const optionalCap = precedingText
    ? Math.floor(contentBudget * (1 - MIN_PRECEDING_SHARE))
    : contentBudget;
  const fitted = new Map<ContextSectionKey, AssembledSection>();
  let optionalUsed = 0;
  for (const [key, share] of present) {
    const cap = Math.min(
      Math.floor(contentBudget * (precedingText ? share : share / (1 - MIN_PRECEDING_SHARE))),
      optionalCap - optionalUsed
    );
    const section = fitSection(sources[key], cap);
    fitted.set(key, section);
    optionalUsed += section.tokens;
  }

  // 第二轮：前文拿剩余预算
  let preceding = fitSection(precedingSource, contentBudget - optionalUsed);
  let remaining = contentBudget - optionalUsed - preceding.tokens;

  // 第三轮：前文用不完时，按优先级回填被截断的分区
  for (const [key] of present) {
    if (remaining <= 0) break;
    const current = fitted.get(key);
    if (!current?.truncated) continue;
    const expanded = fitSection(sources[key], current.tokens + remaining);
    if (expanded.tokens > current.tokens) {
      remaining -= expanded.tokens - current.tokens;
      fitted.set(key, expanded);
    }
  }
  if (!precedingText) preceding = { ...preceding, truncated: false };

  const sections: AssembledSection[] = [
    ...present.map(([key]) => fitted.get(key) as AssembledSection),
    ...(precedingText ? [preceding] : []),
  ].filter((section) => section.text);
  // 后文放在前文之后，阅读顺序更自然
  const ordered = [
    ...sections.filter((section) => section.key !== 'following' && section.key !== 'preceding'),
    ...sections.filter((section) => section.key === 'preceding'),
    ...sections.filter((section) => section.key === 'following'),
  ];
  const rendered = ordered
    .map((section) => {
      const title =
        section.key === 'preceding' && input.chapterTitle
          ? `${section.label}（${input.chapterTitle}）`
          : section.label;
      return `【${title}】\n${section.text}`;
    })
    .join('\n\n');
  return {
    sections: ordered,
    text: rendered,
    usedTokens: estimateTokens(rendered),
    budget,
    precedingText,
  };
}
