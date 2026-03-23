import type {
  PersistedOutlineNodeInput,
  StoryIdeaCardRow,
  StoryIdeaCardSource,
  StoryIdeaCardStatus,
  StoryIdeaOutputRow,
} from '@/render/types/electron-api';
import { extractJsonBlock } from './utils';

export interface StoryIdeaCardDraft {
  title: string;
  premise: string;
  tags: string[];
  source: StoryIdeaCardSource;
  status: StoryIdeaCardStatus;
  themeTerms: string[];
  conflictTerms: string[];
  twistTerms: string[];
  selectedLogline: string;
  selectedDirection: string;
  note: string;
}

export type StoryIdeaTermSection = 'theme' | 'conflict' | 'twist';

export type StoryIdeaTermPoolSource = 'history' | 'ai' | 'manual';

export interface StoryIdeaTermPoolEntry {
  term: string;
  sources: StoryIdeaTermPoolSource[];
}

export interface StoryIdeaTermPoolState {
  theme: StoryIdeaTermPoolEntry[];
  conflict: StoryIdeaTermPoolEntry[];
  twist: StoryIdeaTermPoolEntry[];
}

export interface StoryIdeaSnapshot {
  title: string;
  premise: string;
  tags: string[];
  themeTerms: string[];
  conflictTerms: string[];
  twistTerms: string[];
  selectedLogline: string;
  selectedDirection: string;
  createdFromOutputId?: number;
}

export type StoryIdeaGenerationScope = 'free' | 'hybrid' | 'anchored';

export interface StoryIdeaGenerationConfig {
  scope: StoryIdeaGenerationScope;
  guidance: string;
}

interface StoryIdeaSeedResponse {
  title?: string;
  premise?: string;
  tags?: string[];
  themeTerms?: string[];
  conflictTerms?: string[];
  twistTerms?: string[];
  note?: string;
}

interface StoryIdeaOutlineDirectionResponse {
  title?: string;
  summary?: string;
  beats?: string[];
  outlineTree?: PersistedOutlineNodeInput[];
}

interface StoryIdeaOutputsResponse {
  loglines?: Array<{ content?: string; reason?: string }>;
  sceneHooks?: Array<{ content?: string; focus?: string }>;
  outlineDirections?: StoryIdeaOutlineDirectionResponse[];
}

interface StoryIdeaRelatedTermsResponse {
  terms?: string[];
}

export const STORY_IDEA_STATUS_LABELS: Record<StoryIdeaCardStatus, string> = {
  draft: '草稿',
  exploring: '探索中',
  shortlisted: '已入围',
  promoted_to_board: '已送情节板',
  promoted_to_outline: '已转大纲',
  archived: '已归档',
};

export const STORY_IDEA_SOURCE_LABELS: Record<StoryIdeaCardSource, string> = {
  manual: '手填',
  ai: 'AI',
};

export const STORY_IDEA_OUTPUT_LABELS = {
  logline: '一句话卖点',
  scene_hook: '场景钩子',
  outline_direction: '大纲方向',
} as const;

export const STORY_IDEA_TERM_SECTION_LABELS = {
  theme: '题眼签',
  conflict: '冲突签',
  twist: '变形签',
} as const;

export const STORY_IDEA_TERM_POOL_SOURCE_LABELS: Record<StoryIdeaTermPoolSource, string> = {
  history: '历史',
  ai: 'AI',
  manual: '手动',
};

export const STORY_IDEA_GENERATION_SCOPE_LABELS: Record<StoryIdeaGenerationScope, string> = {
  free: '自由发散',
  hybrid: '贴近正文但允许跳脱',
  anchored: '尽量贴近当前正文',
};

const STORY_IDEA_TERM_LIMIT = 6;
const STORY_IDEA_POOL_LIMIT = 24;

function cleanText(value: string | undefined, maxLength = 200): string {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength).trim();
}

export function normalizeIdeaTags(input: string[] | string): string[] {
  const items = Array.isArray(input) ? input : input.split(/[，,、]/g);
  const seen = new Set<string>();
  return items
    .map((item) => cleanText(item, 20))
    .filter((item) => {
      if (!item) return false;
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    })
    .slice(0, 8);
}

export function normalizeIdeaTerms(input: string[] | string): string[] {
  const items = Array.isArray(input) ? input : input.split(/[，,、/|｜\n]/g);
  const seen = new Set<string>();
  return items
    .map((item) => cleanText(item, 16))
    .filter((item) => {
      if (!item) return false;
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    })
    .slice(0, STORY_IDEA_TERM_LIMIT);
}

export function normalizeIdeaTermPool(input: string[] | string): string[] {
  const items = Array.isArray(input) ? input : input.split(/[，,、/|｜\n]/g);
  const seen = new Set<string>();
  return items
    .map((item) => cleanText(item, 16))
    .filter((item) => {
      if (!item) return false;
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    })
    .slice(0, STORY_IDEA_POOL_LIMIT);
}

function normalizeIdeaTermPoolSources(
  input: StoryIdeaTermPoolSource[] | undefined
): StoryIdeaTermPoolSource[] {
  const allowed: StoryIdeaTermPoolSource[] = ['history', 'ai', 'manual'];
  const seen = new Set<StoryIdeaTermPoolSource>();
  return (input || [])
    .filter((item): item is StoryIdeaTermPoolSource => allowed.includes(item))
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function normalizeIdeaTermPoolEntries(
  input: Array<string | StoryIdeaTermPoolEntry>,
  defaultSource: StoryIdeaTermPoolSource
): StoryIdeaTermPoolEntry[] {
  const entryMap = new Map<string, Set<StoryIdeaTermPoolSource>>();
  input.forEach((item) => {
    const term = normalizeIdeaTerms(typeof item === 'string' ? [item] : [item.term])[0];
    if (!term) return;
    const sources =
      typeof item === 'string'
        ? [defaultSource]
        : normalizeIdeaTermPoolSources(item.sources).length > 0
          ? normalizeIdeaTermPoolSources(item.sources)
          : [defaultSource];
    const current = entryMap.get(term) || new Set<StoryIdeaTermPoolSource>();
    sources.forEach((source) => current.add(source));
    entryMap.set(term, current);
  });

  return [...entryMap.entries()].slice(0, STORY_IDEA_POOL_LIMIT).map(([term, sources]) => ({
    term,
    sources: normalizeIdeaTermPoolSources([...sources]),
  }));
}

export function getIdeaTermPoolValues(entries: StoryIdeaTermPoolEntry[]): string[] {
  return entries.map((entry) => entry.term);
}

export function buildStoryIdeaTermSummary(
  terms: string[],
  maxVisible = 3
): { visibleTerms: string[]; hiddenCount: number } {
  const normalized = normalizeIdeaTerms(terms);
  return {
    visibleTerms: normalized.slice(0, maxVisible),
    hiddenCount: Math.max(0, normalized.length - maxVisible),
  };
}

export function pickRandomStoryIdeaTerms(
  pool: StoryIdeaTermPoolEntry[],
  count = 3,
  excludeTerms: string[] = []
): string[] {
  const excluded = new Set(normalizeIdeaTerms(excludeTerms));
  const candidates = getIdeaTermPoolValues(pool).filter((term) => !excluded.has(term));
  if (candidates.length === 0) {
    return [];
  }

  const sampleSize = Math.min(count, candidates.length);
  const next = [...candidates];
  for (let index = 0; index < sampleSize; index += 1) {
    const swapIndex = index + Math.floor(Math.random() * (next.length - index));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return normalizeIdeaTerms(next.slice(0, sampleSize));
}

function serializeIdeaTerms(terms: string[]): string {
  return normalizeIdeaTerms(terms).join(' / ');
}

function parseSeedTerms(raw: string | undefined): string[] {
  return raw ? normalizeIdeaTerms(raw) : [];
}

function parseTagsJson(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? normalizeIdeaTags(parsed as string[]) : [];
  } catch {
    return [];
  }
}

export function createEmptyStoryIdeaDraft(): StoryIdeaCardDraft {
  return {
    title: '未命名创意卡',
    premise: '',
    tags: [],
    source: 'manual',
    status: 'draft',
    themeTerms: [],
    conflictTerms: [],
    twistTerms: [],
    selectedLogline: '',
    selectedDirection: '',
    note: '',
  };
}

export function createEmptyStoryIdeaTermPool(): StoryIdeaTermPoolState {
  return {
    theme: [],
    conflict: [],
    twist: [],
  };
}

export function getStoryIdeaTermsBySection(
  draft: StoryIdeaCardDraft,
  section: StoryIdeaTermSection
): string[] {
  if (section === 'theme') return draft.themeTerms;
  if (section === 'conflict') return draft.conflictTerms;
  return draft.twistTerms;
}

export function setStoryIdeaTermsBySection(
  draft: StoryIdeaCardDraft,
  section: StoryIdeaTermSection,
  nextTerms: string[]
): StoryIdeaCardDraft {
  const normalized = normalizeIdeaTerms(nextTerms);
  if (section === 'theme') return { ...draft, themeTerms: normalized };
  if (section === 'conflict') return { ...draft, conflictTerms: normalized };
  return { ...draft, twistTerms: normalized };
}

export function mergeStoryIdeaTermPool(
  ...pools: Array<Partial<StoryIdeaTermPoolState> | null | undefined>
): StoryIdeaTermPoolState {
  return {
    theme: normalizeIdeaTermPoolEntries(
      pools.flatMap((pool) => pool?.theme || []),
      'manual'
    ),
    conflict: normalizeIdeaTermPoolEntries(
      pools.flatMap((pool) => pool?.conflict || []),
      'manual'
    ),
    twist: normalizeIdeaTermPoolEntries(
      pools.flatMap((pool) => pool?.twist || []),
      'manual'
    ),
  };
}

export function buildStoryIdeaTermPoolFromCards(cards: StoryIdeaCardRow[]): StoryIdeaTermPoolState {
  return mergeStoryIdeaTermPool(
    cards.reduce<StoryIdeaTermPoolState>((pool, card) => {
      const draft = toStoryIdeaDraft(card);
      pool.theme.push(
        ...draft.themeTerms.map((term): StoryIdeaTermPoolEntry => ({ term, sources: ['history'] }))
      );
      pool.conflict.push(
        ...draft.conflictTerms.map(
          (term): StoryIdeaTermPoolEntry => ({ term, sources: ['history'] })
        )
      );
      pool.twist.push(
        ...draft.twistTerms.map((term): StoryIdeaTermPoolEntry => ({ term, sources: ['history'] }))
      );
      return pool;
    }, createEmptyStoryIdeaTermPool())
  );
}

export function parseStoryIdeaTermPool(raw: string | null | undefined): StoryIdeaTermPoolState {
  if (!raw) return createEmptyStoryIdeaTermPool();
  try {
    const parsed = JSON.parse(raw) as
      | Partial<StoryIdeaTermPoolState>
      | Partial<Record<StoryIdeaTermSection, string[]>>;
    return {
      theme: normalizeIdeaTermPoolEntries(
        (parsed.theme as Array<string | StoryIdeaTermPoolEntry>) || [],
        'manual'
      ),
      conflict: normalizeIdeaTermPoolEntries(
        (parsed.conflict as Array<string | StoryIdeaTermPoolEntry>) || [],
        'manual'
      ),
      twist: normalizeIdeaTermPoolEntries(
        (parsed.twist as Array<string | StoryIdeaTermPoolEntry>) || [],
        'manual'
      ),
    };
  } catch {
    return createEmptyStoryIdeaTermPool();
  }
}

export function serializeStoryIdeaTermPool(pool: StoryIdeaTermPoolState): string {
  return JSON.stringify(mergeStoryIdeaTermPool(pool));
}

export function buildStoryIdeaSnapshot(
  draft: StoryIdeaCardDraft,
  output?: StoryIdeaOutputRow | null
): StoryIdeaSnapshot {
  return {
    title: draft.title.trim() || '未命名创意卡',
    premise: draft.premise.trim(),
    tags: normalizeIdeaTags(draft.tags),
    themeTerms: normalizeIdeaTerms(draft.themeTerms),
    conflictTerms: normalizeIdeaTerms(draft.conflictTerms),
    twistTerms: normalizeIdeaTerms(draft.twistTerms),
    selectedLogline: draft.selectedLogline.trim(),
    selectedDirection: (output?.content || draft.selectedDirection || '').trim(),
    createdFromOutputId: output?.id,
  };
}

export function parseStoryIdeaSnapshot(raw: string | null | undefined): StoryIdeaSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoryIdeaSnapshot>;
    return {
      title: cleanText(parsed.title, 32),
      premise: cleanText(parsed.premise, 80),
      tags: normalizeIdeaTags(parsed.tags || []),
      themeTerms: normalizeIdeaTerms(parsed.themeTerms || []),
      conflictTerms: normalizeIdeaTerms(parsed.conflictTerms || []),
      twistTerms: normalizeIdeaTerms(parsed.twistTerms || []),
      selectedLogline: cleanText(parsed.selectedLogline, 160),
      selectedDirection: cleanText(parsed.selectedDirection, 200),
      createdFromOutputId:
        typeof parsed.createdFromOutputId === 'number' ? parsed.createdFromOutputId : undefined,
    };
  } catch {
    return null;
  }
}

export function replaceStoryIdeaTermRandomly(
  draft: StoryIdeaCardDraft,
  section: StoryIdeaTermSection,
  pool: StoryIdeaTermPoolEntry[]
): StoryIdeaCardDraft | null {
  const currentTerms = getStoryIdeaTermsBySection(draft, section);
  const candidates = pickRandomStoryIdeaTerms(pool, pool.length, currentTerms);
  if (candidates.length === 0) return null;
  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  const targetIndex =
    currentTerms.length > 0 ? Math.floor(Math.random() * currentTerms.length) : currentTerms.length;
  const nextTerms = [...currentTerms];
  if (targetIndex < nextTerms.length) nextTerms[targetIndex] = picked;
  else nextTerms.push(picked);
  return setStoryIdeaTermsBySection(draft, section, nextTerms);
}

export function toStoryIdeaDraft(row: StoryIdeaCardRow | null | undefined): StoryIdeaCardDraft {
  if (!row) {
    return createEmptyStoryIdeaDraft();
  }
  return {
    title: row.title || '未命名创意卡',
    premise: row.premise || '',
    tags: parseTagsJson(row.tags_json),
    source: row.source,
    status: row.status,
    themeTerms: parseSeedTerms(row.theme_seed),
    conflictTerms: parseSeedTerms(row.conflict_seed),
    twistTerms: parseSeedTerms(row.twist_seed),
    selectedLogline: row.selected_logline || '',
    selectedDirection: row.selected_direction || '',
    note: row.note || '',
  };
}

export function draftToStoryIdeaUpdatePayload(draft: StoryIdeaCardDraft) {
  return {
    title: draft.title.trim() || '未命名创意卡',
    premise: draft.premise.trim(),
    tags_json: JSON.stringify(normalizeIdeaTags(draft.tags)),
    source: draft.source,
    status: draft.status,
    theme_seed: serializeIdeaTerms(draft.themeTerms),
    conflict_seed: serializeIdeaTerms(draft.conflictTerms),
    twist_seed: serializeIdeaTerms(draft.twistTerms),
    protagonist_wish: '',
    core_obstacle: '',
    irony_or_gap: '',
    escalation_path: '',
    payoff_hint: '',
    selected_logline: draft.selectedLogline.trim(),
    selected_direction: draft.selectedDirection.trim(),
    note: draft.note.trim(),
  };
}

export function serializeStoryIdeaDraft(draft: StoryIdeaCardDraft): string {
  return JSON.stringify(draftToStoryIdeaUpdatePayload(draft));
}

function buildIdeaContext(content: string): string {
  const normalized = content.trim();
  if (!normalized) return '当前没有正文上下文，仅基于创意卡字段推演。';
  return `正文上下文（截断）:\n${normalized.slice(0, 5000)}`;
}

function buildStoryIdeaGenerationGuide(config?: StoryIdeaGenerationConfig): string {
  const scope = config?.scope || 'hybrid';
  const guidance = cleanText(config?.guidance, 160);
  const scopeText =
    scope === 'free'
      ? '创作范围：不要被当前正文束缚，可以大胆跳脱、联想、混搭。'
      : scope === 'anchored'
        ? '创作范围：尽量贴近当前正文语境、题材气质与已有信息，不要跳太远。'
        : '创作范围：优先参考当前正文，但允许为了创意张力进行适度跳脱。';
  return guidance ? `${scopeText}\n用户限定：${guidance}` : scopeText;
}

function buildIdeaContextByConfig(content: string, config?: StoryIdeaGenerationConfig): string {
  const scope = config?.scope || 'hybrid';
  const normalized = content.trim();
  if (!normalized) {
    return [
      buildStoryIdeaGenerationGuide(config),
      '当前没有正文上下文，仅基于创意卡字段推演。',
    ].join('\n');
  }
  if (scope === 'free') {
    return [
      buildStoryIdeaGenerationGuide(config),
      `可参考的正文线索（非强约束，截断）:\n${normalized.slice(0, 2200)}`,
    ].join('\n');
  }
  if (scope === 'anchored') {
    return [
      buildStoryIdeaGenerationGuide(config),
      `必须优先贴合的正文上下文（截断）:\n${normalized.slice(0, 5000)}`,
    ].join('\n');
  }
  return [buildStoryIdeaGenerationGuide(config), buildIdeaContext(content)].join('\n');
}

export function buildStoryIdeaSeedPrompt(
  draft: StoryIdeaCardDraft,
  content: string,
  config?: StoryIdeaGenerationConfig
): string {
  return [
    '请根据当前创意卡和正文上下文，补全或洗练“三签创作法”的签词。',
    '只返回 JSON 对象，不要解释，不要 Markdown。',
    '字段必须包含：title, premise, tags, themeTerms, conflictTerms, twistTerms, note。',
    '要求：',
    '1. title 控制在 14 字内，像一个可记忆的故事命名。',
    '2. premise 是一句话故事假设，控制在 40 字内。',
    '3. tags 是 3-5 个中文标签数组。',
    '4. themeTerms / conflictTerms / twistTerms 各返回 3-5 个中文词语或短词组，偏“抽签词”，不要写成长句。',
    '5. 三组签词要能直接触发故事联想，避免空泛概念。',
    '6. note 写成一条简短的创作提示，指出这些签词适合往什么故事方向组合。',
    '7. 如果用户已填写的签词可用，优先在原意基础上洗练和补足，而不是完全推翻。',
    '',
    `当前创意卡：${JSON.stringify({
      title: draft.title,
      premise: draft.premise,
      tags: draft.tags,
      themeTerms: draft.themeTerms,
      conflictTerms: draft.conflictTerms,
      twistTerms: draft.twistTerms,
      note: draft.note,
    })}`,
    buildIdeaContextByConfig(content, config),
  ].join('\n');
}

export function buildStoryIdeaExtractPrompt(
  content: string,
  config?: StoryIdeaGenerationConfig
): string {
  return [
    '请生成一组适合“三签创作法”的签词。',
    '只返回 JSON 对象，不要解释，不要 Markdown。',
    '字段必须包含：title, premise, tags, themeTerms, conflictTerms, twistTerms, note。',
    '要求：',
    '1. themeTerms / conflictTerms / twistTerms 各返回 3-5 个中文词语或短词组。',
    '2. themeTerms 偏题眼和气质，conflictTerms 偏对撞和代价，twistTerms 偏反差和翻面。',
    '3. premise 用一句话概括可以从这些签词延展出的故事假设。',
    '4. note 提示作者这些签词最值得往哪种题材或人物关系上发散。',
    '5. 尽量抽出有画面、有张力、能组合的词，不要抽象空话。',
    '6. 如果创作范围允许跳脱，不要只做摘要提炼，要主动给出更能激发创意的签词。',
    '',
    buildIdeaContextByConfig(content, config),
  ].join('\n');
}

export function buildStoryIdeaOutputsPrompt(
  draft: StoryIdeaCardDraft,
  content: string,
  config?: StoryIdeaGenerationConfig
): string {
  return [
    '请基于这张以“签词”为核心的三签创意卡，输出可供作者挑选的候选结果。',
    '只返回 JSON 对象，不要解释，不要 Markdown。',
    'JSON 字段固定为：loglines, sceneHooks, outlineDirections。',
    '其中：',
    '1. loglines: 返回 3 条，每条为 {"content":"","reason":""}。',
    '2. sceneHooks: 返回 4 条，每条为 {"content":"","focus":""}。',
    '3. outlineDirections: 返回 2 条，每条为 {"title":"","summary":"","beats":[...],"outlineTree":[...]}。',
    '4. outlineTree 为大纲树数组；每个节点必须有 title，可选 content 和 children；最多 3 层。',
    '5. beats 保留 3-5 条，适合作者快速比较路线。',
    '6. 输出必须显式利用三组签词的组合张力，而不是泛泛生成套路剧情。',
    '',
    `创意卡：${JSON.stringify({
      title: draft.title,
      premise: draft.premise,
      tags: draft.tags,
      themeTerms: draft.themeTerms,
      conflictTerms: draft.conflictTerms,
      twistTerms: draft.twistTerms,
    })}`,
    buildIdeaContextByConfig(content, config),
  ].join('\n');
}

export function buildStoryIdeaRelatedTermsPrompt(
  draft: StoryIdeaCardDraft,
  section: StoryIdeaTermSection,
  content: string,
  config?: StoryIdeaGenerationConfig
): string {
  const currentTerms = getStoryIdeaTermsBySection(draft, section);
  const sectionLabel = STORY_IDEA_TERM_SECTION_LABELS[section];
  return [
    `请围绕当前“三签创作法”创意卡，为“${sectionLabel}”随机补一批相关签词。`,
    '只返回 JSON 对象，不要解释，不要 Markdown。',
    'JSON 字段固定为：terms。',
    '要求：',
    '1. 返回 6-10 个中文词语或短词组，偏可抽取、可联想、可组合。',
    '2. 尽量与已有签词相关，但不要简单同义重复。',
    '3. 保持题材气质一致，尽量给出有画面感和转折性的词。',
    '4. 不要输出完整句子。',
    '',
    `当前创意卡：${JSON.stringify({
      title: draft.title,
      premise: draft.premise,
      tags: draft.tags,
      themeTerms: draft.themeTerms,
      conflictTerms: draft.conflictTerms,
      twistTerms: draft.twistTerms,
      targetSection: section,
      currentTerms,
    })}`,
    buildIdeaContextByConfig(content, config),
  ].join('\n');
}

export function parseStoryIdeaSeedResponse(raw: string): Partial<StoryIdeaCardDraft> | null {
  const jsonBlock = extractJsonBlock(raw);
  if (!jsonBlock) return null;

  try {
    const parsed = JSON.parse(jsonBlock) as StoryIdeaSeedResponse;
    return {
      title: cleanText(parsed.title, 32) || undefined,
      premise: cleanText(parsed.premise, 80) || undefined,
      tags: parsed.tags ? normalizeIdeaTags(parsed.tags) : undefined,
      themeTerms: parsed.themeTerms ? normalizeIdeaTerms(parsed.themeTerms) : undefined,
      conflictTerms: parsed.conflictTerms ? normalizeIdeaTerms(parsed.conflictTerms) : undefined,
      twistTerms: parsed.twistTerms ? normalizeIdeaTerms(parsed.twistTerms) : undefined,
      note: cleanText(parsed.note, 200) || undefined,
    };
  } catch {
    return null;
  }
}

export function parseStoryIdeaRelatedTermsResponse(raw: string): string[] | null {
  const jsonBlock = extractJsonBlock(raw);
  if (!jsonBlock) return null;
  try {
    const parsed = JSON.parse(jsonBlock) as StoryIdeaRelatedTermsResponse;
    return normalizeIdeaTermPool(parsed.terms || []);
  } catch {
    return null;
  }
}

function sanitizeOutlineTree(
  nodes: PersistedOutlineNodeInput[] | undefined,
  depth = 1
): PersistedOutlineNodeInput[] {
  if (!Array.isArray(nodes)) return [];
  return nodes
    .map((node, index) => ({
      title: cleanText(node.title, 32) || `节点 ${index + 1}`,
      content: cleanText(node.content, 80),
      children: depth >= 3 ? [] : sanitizeOutlineTree(node.children, depth + 1),
      sortOrder: index,
    }))
    .filter((node) => node.title);
}

export function parseStoryIdeaOutputsResponse(raw: string): {
  loglines: Array<{ content: string; metaJson: string; isSelected: boolean }>;
  sceneHooks: Array<{ content: string; metaJson: string; isSelected: boolean }>;
  outlineDirections: Array<{ content: string; metaJson: string; isSelected: boolean }>;
} | null {
  const jsonBlock = extractJsonBlock(raw);
  if (!jsonBlock) return null;

  try {
    const parsed = JSON.parse(jsonBlock) as StoryIdeaOutputsResponse;
    const loglines = (parsed.loglines || [])
      .map((item, index) => {
        const content = cleanText(item.content, 120);
        if (!content) return null;
        return {
          content,
          metaJson: JSON.stringify({ reason: cleanText(item.reason, 80) }),
          isSelected: index === 0,
        };
      })
      .filter((item): item is { content: string; metaJson: string; isSelected: boolean } => !!item);

    const sceneHooks = (parsed.sceneHooks || [])
      .map((item, index) => {
        const content = cleanText(item.content, 160);
        if (!content) return null;
        return {
          content,
          metaJson: JSON.stringify({ focus: cleanText(item.focus, 80) }),
          isSelected: index === 0,
        };
      })
      .filter((item): item is { content: string; metaJson: string; isSelected: boolean } => !!item);

    const outlineDirections = (parsed.outlineDirections || [])
      .map((item, index) => {
        const title = cleanText(item.title, 32);
        const summary = cleanText(item.summary, 160);
        const beats = Array.isArray(item.beats)
          ? item.beats
              .map((beat) => cleanText(beat, 60))
              .filter(Boolean)
              .slice(0, 5)
          : [];
        const outlineTree = sanitizeOutlineTree(item.outlineTree);
        if (!title && !summary && outlineTree.length === 0) {
          return null;
        }
        return {
          content: title ? `${title}：${summary || beats[0] || '可转为大纲草案'}` : summary,
          metaJson: JSON.stringify({ title, summary, beats, outlineTree }),
          isSelected: index === 0,
        };
      })
      .filter((item): item is { content: string; metaJson: string; isSelected: boolean } => !!item);

    return { loglines, sceneHooks, outlineDirections };
  } catch {
    return null;
  }
}

export function buildOutlineTreeFromIdeaOutput(
  draft: StoryIdeaCardDraft,
  output: StoryIdeaOutputRow | null | undefined
): PersistedOutlineNodeInput[] {
  if (!output) return [];

  try {
    const parsed = JSON.parse(output.meta_json) as {
      title?: string;
      summary?: string;
      beats?: string[];
      outlineTree?: PersistedOutlineNodeInput[];
    };
    const outlineTree = sanitizeOutlineTree(parsed.outlineTree);
    if (outlineTree.length > 0) {
      return outlineTree;
    }

    const beatNodes = Array.isArray(parsed.beats)
      ? parsed.beats
          .map((beat, index) => ({
            title: cleanText(beat, 36) || `推进 ${index + 1}`,
            content: '',
            children: [],
            sortOrder: index,
          }))
          .filter((node) => node.title)
      : [];

    return [
      {
        title: cleanText(parsed.title, 32) || draft.title || '三签草案',
        content: cleanText(parsed.summary, 80) || draft.premise,
        sortOrder: 0,
        children: beatNodes,
      },
    ];
  } catch {
    return [
      {
        title: draft.title || '三签草案',
        content: output.content,
        sortOrder: 0,
        children: [],
      },
    ];
  }
}

export function buildStoryIdeaVersionName(draft: StoryIdeaCardDraft): string {
  const base = cleanText(draft.title, 18) || '三签草案';
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `三签草案 ${base} ${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function buildStoryIdeaSearchText(draft: StoryIdeaCardDraft): string {
  return [
    draft.title,
    draft.premise,
    draft.note,
    draft.tags.join(' '),
    draft.themeTerms.join(' '),
    draft.conflictTerms.join(' '),
    draft.twistTerms.join(' '),
  ]
    .join(' ')
    .toLowerCase();
}

export function pickSelectedOutput(
  outputs: StoryIdeaOutputRow[],
  type: StoryIdeaOutputRow['type']
): StoryIdeaOutputRow | null {
  return outputs.find((item) => item.type === type && item.is_selected === 1) || null;
}
