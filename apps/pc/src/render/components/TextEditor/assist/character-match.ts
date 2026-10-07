/**
 * 人物名 / 别名识别（悬停卡片、⌘K、「高亮全部」共用）
 *
 * - 识别口径与写作装饰的人物高亮一致：忽略泛称、单字、纯数字；英文名要求单词边界
 * - 长名优先：「苏晴儿」不会被拆成「苏晴」+「儿」；同一位置只取一个，结果互不重叠
 * - 只按行匹配，结果按「文档版本（Text 对象）→ 行号」缓存；调用方只传可见范围，不扫描全文
 */
import type { Text } from '@codemirror/state';
import {
  isCharacterHighlightBoundarySafe,
  shouldIgnoreCharacterHighlightToken,
} from '../writing-decorations';

export interface MatchableCharacter {
  id: number;
  name: string;
  aliases?: string[];
}

export interface CharacterMention {
  /** 文档偏移（含） */
  from: number;
  /** 文档偏移（不含） */
  to: number;
  characterId: number;
  token: string;
  source: 'name' | 'alias';
}

interface TokenOwner {
  characterId: number;
  source: 'name' | 'alias';
}

export interface CharacterMatcher {
  readonly regex: RegExp | null;
  readonly tokens: ReadonlyMap<string, TokenOwner>;
  /** 文档版本 → 行号 → 该行的识别结果 */
  readonly cache: WeakMap<Text, Map<number, CharacterMention[]>>;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 同一个词属于多个人物时，先出现的人物优先（与人物高亮一致） */
export function buildCharacterMatcher(characters: readonly MatchableCharacter[]): CharacterMatcher {
  const tokens = new Map<string, TokenOwner>();
  for (const character of characters) {
    const name = character.name.trim();
    if (name && !shouldIgnoreCharacterHighlightToken(name, 'name') && !tokens.has(name)) {
      tokens.set(name, { characterId: character.id, source: 'name' });
    }
    for (const raw of character.aliases ?? []) {
      const alias = raw.trim();
      if (!alias || alias === name || tokens.has(alias)) continue;
      if (shouldIgnoreCharacterHighlightToken(alias, 'alias')) continue;
      tokens.set(alias, { characterId: character.id, source: 'alias' });
    }
  }
  const sorted = Array.from(tokens.keys()).sort((a, b) => b.length - a.length);
  return {
    regex: sorted.length ? new RegExp(sorted.map(escapeRegExp).join('|'), 'g') : null,
    tokens,
    cache: new WeakMap(),
  };
}

/** 在一行文字中识别人物（offset 为该行在文档中的起点） */
export function matchLine(matcher: CharacterMatcher, text: string, offset = 0): CharacterMention[] {
  const { regex } = matcher;
  if (!regex || !text) return [];
  const result: CharacterMention[] = [];
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const token = match[0];
    const owner = matcher.tokens.get(token);
    if (!owner || !isCharacterHighlightBoundarySafe(text, match.index, token)) continue;
    result.push({
      from: offset + match.index,
      to: offset + match.index + token.length,
      characterId: owner.characterId,
      token,
      source: owner.source,
    });
  }
  return result;
}

/** 某一行的识别结果（按文档版本缓存） */
export function lineMentions(
  matcher: CharacterMatcher,
  doc: Text,
  lineNumber: number
): CharacterMention[] {
  let byLine = matcher.cache.get(doc);
  if (!byLine) {
    byLine = new Map();
    matcher.cache.set(doc, byLine);
  }
  const cached = byLine.get(lineNumber);
  if (cached) return cached;
  const line = doc.line(lineNumber);
  const mentions = matchLine(matcher, line.text, line.from);
  byLine.set(lineNumber, mentions);
  return mentions;
}

/** 位置 pos 处的人物（pos 落在名字内部或紧贴名字两端都算）；side 与 hoverTooltip 一致 */
export function mentionAt(
  matcher: CharacterMatcher,
  doc: Text,
  pos: number,
  side: -1 | 1 = 1
): CharacterMention | null {
  if (!matcher.regex || pos < 0 || pos > doc.length) return null;
  const line = doc.lineAt(pos);
  const mentions = lineMentions(matcher, doc, line.number);
  return (
    mentions.find((item) =>
      side < 0 ? item.from < pos && pos <= item.to : item.from <= pos && pos < item.to
    ) ??
    mentions.find((item) => item.from <= pos && pos <= item.to) ??
    null
  );
}

/** 范围内（通常是可见范围）的识别结果，可只取某个人物 */
export function mentionsInRanges(
  matcher: CharacterMatcher,
  doc: Text,
  ranges: ReadonlyArray<{ from: number; to: number }>,
  characterId?: number
): CharacterMention[] {
  if (!matcher.regex) return [];
  const result: CharacterMention[] = [];
  let lastLine = 0;
  for (const range of ranges) {
    const start = doc.lineAt(Math.max(0, Math.min(range.from, doc.length))).number;
    const end = doc.lineAt(Math.max(0, Math.min(range.to, doc.length))).number;
    for (let lineNumber = Math.max(start, lastLine + 1); lineNumber <= end; lineNumber += 1) {
      for (const mention of lineMentions(matcher, doc, lineNumber)) {
        if (characterId === undefined || mention.characterId === characterId) {
          result.push(mention);
        }
      }
      lastLine = lineNumber;
    }
  }
  return result;
}
