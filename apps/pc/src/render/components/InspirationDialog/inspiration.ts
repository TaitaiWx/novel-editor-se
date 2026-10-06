import type { StoryIdeaCardRow } from '@/render/types/electron-api';
import {
  STORY_IDEA_GENERATION_SCOPE_LABELS,
  createEmptyStoryIdeaDraft,
  draftToStoryIdeaUpdatePayload,
  getIdeaTermPoolValues,
  toStoryIdeaDraft,
  type StoryIdeaCardDraft,
  type StoryIdeaGenerationScope,
  type StoryIdeaTermPoolState,
  type StoryIdeaTermSection,
} from '../RightPanel/story-idea';

/**
 * 「灵感」抽签：一键抽出 人物 / 地点 / 冲突 三张签，零输入即可用。
 *
 * 纯函数集中在这里（便于单测）；存储复用三签卡：
 * 词池沿用 `novel-editor:story-idea-term-pool:<作品>`，历史沿用 story_idea_card 表。
 */

export type InspirationSlot = 'person' | 'place' | 'conflict';

export const INSPIRATION_SLOTS: readonly InspirationSlot[] = ['person', 'place', 'conflict'];

export const INSPIRATION_SLOT_LABELS: Record<InspirationSlot, string> = {
  person: '人物',
  place: '地点',
  conflict: '冲突',
};

export const INSPIRATION_SLOT_HINTS: Record<InspirationSlot, string> = {
  person: '谁在场',
  place: '在哪里',
  conflict: '为什么拧起来',
};

/** 复用三签卡的分区存储：题眼签存人物、变形签存地点、冲突签存冲突 */
export const INSPIRATION_SLOT_SECTIONS: Record<InspirationSlot, StoryIdeaTermSection> = {
  person: 'theme',
  place: 'twist',
  conflict: 'conflict',
};

/** 内置词库：保证没有任何历史数据时也能直接抽签 */
export const BUILTIN_INSPIRATION_POOLS: Record<InspirationSlot, readonly string[]> = {
  person: [
    '失忆的守门人',
    '欠债的说书人',
    '退隐的女刺客',
    '不会撒谎的少年',
    '替人写信的哑巴',
    '落榜的书生',
    '被逐出师门的弟子',
    '假装失明的琴师',
    '收尸人的女儿',
    '戴面具的商人',
    '一心求死的将军',
    '记性极好的乞丐',
    '迷路的信使',
    '偷学禁术的药童',
    '被冒名顶替的县令',
    '只在夜里出现的旅人',
  ],
  place: [
    '雨夜的渡口',
    '废弃的驿站',
    '封山的古寺',
    '集市散场后的街口',
    '漏雨的书铺',
    '结冰的湖心',
    '塌了一半的城墙',
    '午夜的戏台',
    '无人看守的灯塔',
    '山腰的茶棚',
    '地下的赌坊',
    '被大火烧过的祠堂',
    '只剩一班的末班车',
    '边境的哨所',
    '潮水退去的滩涂',
    '堆满旧账本的库房',
  ],
  conflict: [
    '必须在天亮前交出一样东西',
    '救一个人就要背叛另一个人',
    '守了多年的秘密被人当众说破',
    '欠下的人情到了必须还的时候',
    '唯一的证人不肯开口',
    '两个人要的是同一件东西',
    '约定的人始终没有来',
    '一封信送错了人',
    '为了赢必须先认输',
    '真相会毁掉最亲近的人',
    '规矩与良心只能选一个',
    '旧敌突然上门求助',
    '出发前一刻发现被出卖',
    '想留下的人偏偏要走',
    '一句玩笑被当了真',
    '赢了比赛却输了名声',
  ],
};

/** 抽签词源：内置词库 / 内置 + 我的词池 / 只用我的词池 */
export type InspirationSource = 'builtin' | 'mixed' | 'mine';

export const INSPIRATION_SOURCE_LABELS: Record<InspirationSource, string> = {
  builtin: '内置词库',
  mixed: '内置 + 我的词池',
  mine: '只用我的词池',
};

export type InspirationDraw = Record<InspirationSlot, string>;

export type InspirationPools = Record<InspirationSlot, string[]>;

export type RandomSource = () => number;

/** 按词源合成三张签各自的候选词；「只用我的词池」时某一签为空则退回内置词库，保证总能抽出 */
export function buildInspirationPools(
  source: InspirationSource,
  termPool: StoryIdeaTermPoolState
): InspirationPools {
  const pools = {} as InspirationPools;
  INSPIRATION_SLOTS.forEach((slot) => {
    const builtin = [...BUILTIN_INSPIRATION_POOLS[slot]];
    const mine = getIdeaTermPoolValues(termPool[INSPIRATION_SLOT_SECTIONS[slot]]);
    if (source === 'builtin') pools[slot] = builtin;
    else if (source === 'mine') pools[slot] = mine.length > 0 ? mine : builtin;
    else pools[slot] = Array.from(new Set([...builtin, ...mine]));
  });
  return pools;
}

function pickOne(candidates: string[], exclude: string, random: RandomSource): string {
  const filtered = candidates.filter((term) => term !== exclude);
  const list = filtered.length > 0 ? filtered : candidates;
  if (list.length === 0) return exclude;
  const index = Math.min(list.length - 1, Math.floor(random() * list.length));
  return list[index];
}

/** 一次抽出三张签 */
export function drawInspiration(
  pools: InspirationPools,
  random: RandomSource = Math.random
): InspirationDraw {
  return {
    person: pickOne(pools.person, '', random),
    place: pickOne(pools.place, '', random),
    conflict: pickOne(pools.conflict, '', random),
  };
}

/** 只重抽一张签，尽量不与当前相同 */
export function rerollInspirationSlot(
  draw: InspirationDraw,
  slot: InspirationSlot,
  pools: InspirationPools,
  random: RandomSource = Math.random
): InspirationDraw {
  return { ...draw, [slot]: pickOne(pools[slot], draw[slot], random) };
}

/** 插入正文 / 复制用的一行文本（跳过空签） */
export function formatInspiration(draw: InspirationDraw): string {
  return INSPIRATION_SLOTS.filter((slot) => draw[slot])
    .map((slot) => `${INSPIRATION_SLOT_LABELS[slot]}：${draw[slot]}`)
    .join('｜');
}

const PROMPT_CONTEXT_CHARS = 1200;

/** 「交给 AI 扩写」：把三张签扩成一段可直接接在正文后的场景 */
export function buildInspirationExpandPrompt(
  draw: InspirationDraw,
  content: string,
  scope: StoryIdeaGenerationScope
): string {
  const context = scope === 'free' ? '' : content.trim().slice(-PROMPT_CONTEXT_CHARS);
  return [
    '请根据下面三张灵感签，写一段 300 字左右的小说场景草稿。',
    `人物：${draw.person}`,
    `地点：${draw.place}`,
    `冲突：${draw.conflict}`,
    `发挥方式：${STORY_IDEA_GENERATION_SCOPE_LABELS[scope]}。`,
    context ? `当前正文结尾（保持人称、语气与之衔接）：\n${context}` : '',
    '只输出正文，不要标题、解释或列表。',
  ]
    .filter(Boolean)
    .join('\n');
}

function formatHistoryTitle(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `灵感 ${now.getMonth() + 1}/${now.getDate()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** 把一次抽签存成三签卡草稿（进入历史） */
export function inspirationToStoryIdeaDraft(
  draw: InspirationDraw,
  now: Date = new Date()
): StoryIdeaCardDraft {
  return {
    ...createEmptyStoryIdeaDraft(),
    title: formatHistoryTitle(now),
    premise: formatInspiration(draw),
    tags: ['灵感'],
    themeTerms: [draw.person],
    twistTerms: [draw.place],
    conflictTerms: [draw.conflict],
  };
}

/** 三签卡 → 抽签（历史回填）；三张签都为空时返回 null */
export function storyIdeaCardToInspiration(card: StoryIdeaCardRow): InspirationDraw | null {
  const draft = toStoryIdeaDraft(card);
  const draw: InspirationDraw = {
    person: draft.themeTerms[0] ?? '',
    place: draft.twistTerms[0] ?? '',
    conflict: draft.conflictTerms[0] ?? '',
  };
  return INSPIRATION_SLOTS.some((slot) => draw[slot]) ? draw : null;
}

/** IPC `db-story-idea-card-create-by-folder` 的载荷 */
export function buildStoryIdeaCreatePayload(draft: StoryIdeaCardDraft) {
  const payload = draftToStoryIdeaUpdatePayload(draft);
  return {
    title: payload.title,
    premise: payload.premise,
    tagsJson: payload.tags_json,
    source: payload.source,
    status: payload.status,
    themeSeed: payload.theme_seed,
    conflictSeed: payload.conflict_seed,
    twistSeed: payload.twist_seed,
    note: payload.note,
  };
}

// ─── 打开请求（工具栏按钮、快捷键、大纲版本「回到来源」） ─────────────────────

export const OPEN_INSPIRATION_EVENT = 'open-inspiration';

export interface OpenInspirationDetail {
  /** 打开后回填这张三签卡（来自大纲版本的来源追溯） */
  cardId?: number;
}

export function requestOpenInspiration(detail: OpenInspirationDetail = {}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<OpenInspirationDetail>(OPEN_INSPIRATION_EVENT, { detail }));
}
