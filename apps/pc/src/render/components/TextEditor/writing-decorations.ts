/**
 * CM6 写作装饰插件
 *
 * 为小说/剧本内容提供视觉标记：
 * - 幕标题高亮 (第X幕)
 * - 场景标题高亮 (第X场)
 * - 章节标题高亮 (第X章, 第X卷, 第X回 等)
 * - 角色名称高亮（支持自定义颜色、按章首现强调）
 */
import {
  EditorView,
  Decoration,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import type { Extension } from '@codemirror/state';

/** 编辑器角色高亮规则 */
export interface CharacterHighlightPattern {
  id: number;
  name: string;
  aliases?: string[];
  color?: string;
  highlightFirstMentionOnly?: boolean;
}

export type CharacterHighlightTokenSource = 'name' | 'alias';

type PreparedHighlightPattern = {
  id: number;
  name: string;
  aliases: string[];
  color: string;
  highlightFirstMentionOnly: boolean;
};

type HighlightMatcher = {
  regex: RegExp | null;
  tokenToPattern: Map<string, PreparedHighlightPattern>;
};

// ── 正则 ──

/** 中文幕标记 */
const RE_ACT = /^(第[一二三四五六七八九十百千万零〇\d]+幕)\s*(.*)/;
/** 中文场景标记 */
const RE_SCENE = /^(第[一二三四五六七八九十百千万零〇\d]+场)\s*(.*)/;
/** 中文章节/卷/回/节/部/篇/集 */
const RE_CHAPTER = /^(第[一二三四五六七八九十百千万零〇\d]+[章节幕回篇集卷])\s*(.*)/;
/** Markdown 标题 */
const RE_HEADING = /^(#{1,6})\s+(.+)/;

// ── Decoration 样式 ──

const actLineDeco = Decoration.line({ class: 'cm-act-line' });
const sceneLineDeco = Decoration.line({ class: 'cm-scene-line' });
const chapterLineDeco = Decoration.line({ class: 'cm-chapter-line' });
const headingLineDeco = Decoration.line({ class: 'cm-heading-line' });

const RE_CJK_ONLY = /^[\u3400-\u9fff]+$/;
const RE_ASCII_WORD_ONLY = /^[A-Za-z0-9_-]+$/;
const RE_ASCII_WORD_CHAR = /[A-Za-z0-9_]/;
const GENERIC_CHARACTER_TOKENS = new Set([
  '自己',
  '大家',
  '有人',
  '男人',
  '女人',
  '少年',
  '少女',
  '青年',
  '老者',
  '老人',
  '先生',
  '小姐',
  '夫人',
  '公子',
  '姑娘',
  '少爷',
  '师父',
  '师傅',
  '掌柜',
  '老板',
  '客人',
  '路人',
  '弟子',
  '长老',
  '前辈',
  '后辈',
  '同学',
  '老师',
  '父亲',
  '母亲',
  '哥哥',
  '姐姐',
  '弟弟',
  '妹妹',
  '儿子',
  '女儿',
  '父王',
  '母后',
  '皇帝',
  '皇后',
  '王爷',
  '王妃',
  '丫鬟',
  '侍卫',
  '主角',
  '反派',
]);

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeHighlightColor(color: string | undefined): string {
  if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color.trim())) {
    return color.trim().toLowerCase();
  }
  return '#9cdcfe';
}

export function shouldIgnoreCharacterHighlightToken(
  rawToken: string,
  source: CharacterHighlightTokenSource = 'name'
): boolean {
  const token = rawToken.trim();
  if (!token) return true;
  if (/^\d+$/.test(token)) return true;
  if (GENERIC_CHARACTER_TOKENS.has(token)) return true;

  const compactLength = Array.from(token.replace(/\s+/g, '')).length;
  if (compactLength <= 1) return true;

  if (RE_CJK_ONLY.test(token)) {
    return compactLength < 2;
  }

  if (RE_ASCII_WORD_ONLY.test(token)) {
    return compactLength < 2;
  }

  // 中文说明：别名默认比主名更保守，避免把“他”“她”“老师傅”之类宽泛词误当成稳定角色名。
  if (source === 'alias' && compactLength < 2) {
    return true;
  }

  return false;
}

export function isCharacterHighlightBoundarySafe(
  lineText: string,
  startIndex: number,
  token: string
): boolean {
  if (!RE_ASCII_WORD_CHAR.test(token)) return true;

  const previousCharacter = startIndex > 0 ? lineText[startIndex - 1] : '';
  const nextCharacter =
    startIndex + token.length < lineText.length ? lineText[startIndex + token.length] : '';

  return (
    !RE_ASCII_WORD_CHAR.test(previousCharacter || '') &&
    !RE_ASCII_WORD_CHAR.test(nextCharacter || '')
  );
}

function hexToRgb(hex: string): string {
  const normalized = normalizeHighlightColor(hex).slice(1);
  const channels = normalized.match(/.{2}/g);
  if (!channels) return '156, 220, 254';
  return channels.map((item) => parseInt(item, 16)).join(', ');
}

function prepareHighlightPatterns(
  patterns: CharacterHighlightPattern[]
): PreparedHighlightPattern[] {
  return patterns
    .map((pattern) => ({
      id: pattern.id,
      name: shouldIgnoreCharacterHighlightToken(pattern.name, 'name') ? '' : pattern.name.trim(),
      aliases: Array.from(
        new Set(
          (pattern.aliases || [])
            .map((item) => item.trim())
            .filter(
              (item) =>
                item &&
                item !== pattern.name.trim() &&
                !shouldIgnoreCharacterHighlightToken(item, 'alias')
            )
        )
      ),
      color: normalizeHighlightColor(pattern.color),
      highlightFirstMentionOnly: pattern.highlightFirstMentionOnly !== false,
    }))
    .filter((pattern) => Boolean(pattern.name || pattern.aliases.length > 0));
}

function buildHighlightMatcher(patterns: PreparedHighlightPattern[]): HighlightMatcher {
  const tokenToPattern = new Map<string, PreparedHighlightPattern>();
  const tokens: string[] = [];

  for (const pattern of patterns) {
    for (const token of [pattern.name, ...pattern.aliases]) {
      if (!token || tokenToPattern.has(token)) continue;
      tokenToPattern.set(token, pattern);
      tokens.push(token);
    }
  }

  if (tokens.length === 0) {
    return { regex: null, tokenToPattern };
  }

  // 中文说明：按长度倒序生成正则，避免“张三”和“张”这种前缀词先抢占匹配。
  tokens.sort((left, right) => right.length - left.length);
  return {
    regex: new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'g'),
    tokenToPattern,
  };
}

function isChapterBoundary(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (RE_CHAPTER.test(trimmed)) return true;
  const headingMatch = RE_HEADING.exec(trimmed);
  return Boolean(headingMatch && RE_CHAPTER.test(headingMatch[2].trim()));
}

function getCharacterMark(
  cache: Map<string, Decoration>,
  color: string,
  emphasis: 'first' | 'normal'
): Decoration {
  const cacheKey = `${color}:${emphasis}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const mark = Decoration.mark({
    class: emphasis === 'first' ? 'cm-character-name cm-character-name-first' : 'cm-character-name',
    attributes: {
      style: `--cm-character-color: ${color}; --cm-character-color-rgb: ${hexToRgb(color)};`,
    },
  });
  cache.set(cacheKey, mark);
  return mark;
}

function buildDecorations(
  view: EditorView,
  matcher: HighlightMatcher,
  patterns: PreparedHighlightPattern[]
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const decorationCache = new Map<string, Decoration>();
  let mentionedCharacterIds = new Set<number>();

  // 中文说明：首现高亮必须知道“本章之前是否已经出现过”，所以这里按整篇正文扫描，
  // 避免只扫可视区域时因为滚动位置变化导致高亮结果不稳定。
  for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber);
    const trimmedText = line.text.trim();

    if (lineNumber > 1 && isChapterBoundary(line.text)) {
      mentionedCharacterIds = new Set<number>();
    }

    if (RE_ACT.test(trimmedText)) {
      builder.add(line.from, line.from, actLineDeco);
    } else if (RE_SCENE.test(trimmedText)) {
      builder.add(line.from, line.from, sceneLineDeco);
    } else if (RE_CHAPTER.test(trimmedText)) {
      builder.add(line.from, line.from, chapterLineDeco);
    } else if (RE_HEADING.test(trimmedText)) {
      builder.add(line.from, line.from, headingLineDeco);
    }

    if (!matcher.regex || patterns.length === 0 || !line.text) continue;

    matcher.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = matcher.regex.exec(line.text)) !== null) {
      const matchedToken = match[0];
      const pattern = matcher.tokenToPattern.get(matchedToken);
      if (!pattern) continue;
      if (!isCharacterHighlightBoundarySafe(line.text, match.index, matchedToken)) {
        continue;
      }

      if (pattern.highlightFirstMentionOnly && mentionedCharacterIds.has(pattern.id)) {
        continue;
      }

      const start = line.from + match.index;
      const end = start + matchedToken.length;
      const emphasis = pattern.highlightFirstMentionOnly ? 'first' : 'normal';
      builder.add(start, end, getCharacterMark(decorationCache, pattern.color, emphasis));
      mentionedCharacterIds.add(pattern.id);
    }
  }

  return builder.finish();
}

/**
 * 创建写作装饰扩展
 *
 * @param characterPatterns 需要高亮的角色规则列表
 */
export function writingDecorations(
  characterPatterns: CharacterHighlightPattern[] = []
): Extension {
  const preparedPatterns = prepareHighlightPatterns(characterPatterns);
  const matcher = buildHighlightMatcher(preparedPatterns);

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, matcher, preparedPatterns);
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.decorations = buildDecorations(update.view, matcher, preparedPatterns);
        }
      }
    },
    { decorations: (value) => value.decorations }
  );

  const theme = EditorView.baseTheme({
    '.cm-act-line': {
      backgroundColor: 'rgba(0, 122, 204, 0.12)',
      borderLeft: '3px solid #007acc',
      paddingLeft: '8px',
      fontWeight: 'bold',
    },
    '.cm-scene-line': {
      backgroundColor: 'rgba(78, 201, 176, 0.10)',
      borderLeft: '3px solid #4ec9b0',
      paddingLeft: '8px',
    },
    '.cm-chapter-line': {
      backgroundColor: 'rgba(220, 220, 170, 0.08)',
      borderLeft: '3px solid #dcdcaa',
      paddingLeft: '8px',
      fontWeight: 'bold',
    },
    '.cm-heading-line': {
      backgroundColor: 'rgba(197, 134, 192, 0.06)',
      borderLeft: '2px solid rgba(197, 134, 192, 0.4)',
      paddingLeft: '8px',
    },
    '.cm-character-name': {
      color: 'var(--cm-character-color, #9cdcfe)',
      borderBottom: '1px dotted rgba(var(--cm-character-color-rgb, 156, 220, 254), 0.46)',
      borderRadius: '2px',
    },
    '.cm-character-name-first': {
      backgroundColor: 'rgba(var(--cm-character-color-rgb, 156, 220, 254), 0.16)',
      boxShadow: '0 0 0 1px rgba(var(--cm-character-color-rgb, 156, 220, 254), 0.2)',
      borderBottomStyle: 'solid',
      fontWeight: 600,
      padding: '0 1px',
    },
  });

  return [plugin, theme];
}
