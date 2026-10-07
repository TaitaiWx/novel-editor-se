/**
 * 人物悬停卡片的数据（纯函数）：人物卡 + 当前作品的成长卡 + 上次出场章节 → 卡片要显示的内容
 *
 * 信息少时自动收缩：没有别名 / 简介 / 状态 / 成长卡的部分直接省略。
 */
import { getLevelProgress, type GrowthRuleset, type GrowthSheet } from '@novel-editor/core/growth';
import type { Character } from '../RightPanel/types';
import { CAMP_LABELS } from '../RightPanel/constants';
import { CHARACTER_CATEGORY_LABELS, inferCharacterCamp } from '../RightPanel/utils';

export interface CharacterCardGrowth {
  level: number;
  /** 0..1 */
  ratio: number;
  /** 例如「经验 2750 / 3000」或「已满级」 */
  expText: string;
}

export interface LastAppearance {
  path: string;
  /** 例如「第一卷-离乡 · 003-雾林」 */
  label: string;
  /** 与当前章相隔的章数（当前章不在列表中时为 null） */
  chaptersAgo: number | null;
}

export interface CharacterCardModel {
  id: number;
  name: string;
  /** 无头像时的首字圆标 */
  initial: string;
  color: string;
  aliases: string[];
  /** 「主要角色 · 主角团」 */
  tags: string[];
  /** 角色定位（role），例如「主角 · 旅人」 */
  role: string;
  /** 一句话简介 */
  summary: string;
  /** 最近 1–2 条当前状态 */
  states: Array<{ label: string; value: string }>;
  growth: CharacterCardGrowth | null;
}

const SUMMARY_MAX = 48;

/** 取第一句，超长时截断 */
export function oneLine(text: string, max = SUMMARY_MAX): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  const firstSentence = /^(.+?[\u3002\uff01\uff1f!?])/.exec(compact)?.[1] ?? compact;
  const chars = Array.from(firstSentence);
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : firstSentence;
}

/** 按名字或别名把人物卡与成长卡对上（成长卡也可能以别名建档） */
export function findGrowthSheetForCharacter(
  sheets: readonly GrowthSheet[],
  character: Pick<Character, 'name' | 'aliases'>
): GrowthSheet | null {
  const keys = new Set([character.name, ...(character.aliases ?? [])].map((key) => key.trim()));
  keys.delete('');
  return (
    sheets.find((sheet) => keys.has(sheet.name)) ??
    sheets.find((sheet) => sheet.aliases.some((alias) => keys.has(alias))) ??
    null
  );
}

export function buildCardGrowth(sheet: GrowthSheet, ruleset: GrowthRuleset): CharacterCardGrowth {
  const progress = getLevelProgress(ruleset, sheet);
  return {
    level: sheet.level,
    ratio: progress.ratio,
    expText:
      progress.nextLevelExp === null
        ? `经验 ${sheet.exp} · 已满级`
        : `经验 ${sheet.exp} / ${progress.nextLevelExp}`,
  };
}

export interface CharacterCardSource {
  character: Character;
  growth?: { sheet: GrowthSheet; ruleset: GrowthRuleset } | null;
}

export function buildCharacterCardModel({
  character,
  growth,
}: CharacterCardSource): CharacterCardModel {
  const name = character.name.trim();
  const stateItems = character.currentState.length
    ? character.currentState.slice(-2).map((item) => ({ label: item.label, value: item.value }))
    : (growth?.sheet.notes ?? [])
        .slice(-2)
        .filter((note) => note.trim())
        .map((note) => ({ label: '状态', value: note.trim() }));
  const camp = CAMP_LABELS[inferCharacterCamp(character, [])];
  return {
    id: character.id,
    name,
    initial: Array.from(name)[0] ?? '?',
    color: character.highlightColor || '#9cdcfe',
    aliases: (character.aliases ?? []).filter((alias) => alias.trim() && alias.trim() !== name),
    tags: [CHARACTER_CATEGORY_LABELS[character.category], camp],
    role: character.role.trim(),
    summary: oneLine(character.description),
    states: stateItems,
    growth: growth ? buildCardGrowth(growth.sheet, growth.ruleset) : null,
  };
}

export interface ChapterRef {
  path: string;
  /** 例如「第一卷-离乡 · 003-雾林」 */
  label: string;
}

/** 最多往前查找的章节数（几百章的作品也只读最近这些章） */
export const LAST_APPEARANCE_LOOKBACK = 200;

/**
 * 在按顺序排列的章节中，找某人物最近一次出场（不含当前章）：
 * 从当前章的前一章往前逐章读取，找到即停；当前章不在列表中时从最后一章开始。
 */
export async function findLastAppearance(
  chapters: readonly ChapterRef[],
  tokens: readonly string[],
  currentPath: string | null,
  getText: (path: string) => Promise<string> | string,
  lookback = LAST_APPEARANCE_LOOKBACK
): Promise<LastAppearance | null> {
  const needles = tokens.map((token) => token.trim()).filter((token) => token.length >= 2);
  if (!needles.length) return null;
  const currentIndex = currentPath ? chapters.findIndex((item) => item.path === currentPath) : -1;
  const end = currentIndex >= 0 ? currentIndex : chapters.length;
  for (let index = end - 1; index >= Math.max(0, end - lookback); index -= 1) {
    const chapter = chapters[index];
    const text = await getText(chapter.path);
    if (needles.some((needle) => text.includes(needle))) {
      return {
        path: chapter.path,
        label: chapter.label,
        chaptersAgo: currentIndex >= 0 ? currentIndex - index : null,
      };
    }
  }
  return null;
}

export function formatLastAppearance(value: LastAppearance | null): string {
  if (!value) return '此前没有出场';
  if (value.chaptersAgo === 1) return `${value.label}（上一章）`;
  if (value.chaptersAgo !== null) return `${value.label}（${value.chaptersAgo} 章前）`;
  return value.label;
}
