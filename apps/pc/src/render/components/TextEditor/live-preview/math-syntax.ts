/**
 * @lezer/markdown 的数学公式语法扩展：
 * - 行内公式 `$...$`（以及行内的 `$$...$$`）→ InlineMath（两端 InlineMathMark）
 * - 块级公式：以 `$$` 开头的行，直到含 `$$` 结尾的行 → BlockMath（BlockMathMark）
 *
 * 健壮性约定：块级公式遇到空行仍未闭合时就地结束（TeX 的展示公式内本就不允许空行），
 * 不会把后面的整篇文档都吞进一个公式块里；未闭合的块由渲染层标记为错误。
 * 本文件不依赖 KaTeX，可随 markdown 语言包一起加载。
 */
import type { BlockContext, InlineContext, Line, MarkdownConfig } from '@lezer/markdown';

const DOLLAR = 36;
const BACKSLASH = 92;
const NEWLINE = 10;

const isSpace = (ch: number) => ch === 32 || ch === 9 || ch === NEWLINE || ch === 13;
const isDigit = (ch: number) => ch >= 48 && ch <= 57;

/** 解析行内公式，返回结束位置；不匹配返回 -1 */
function parseInlineMath(cx: InlineContext, next: number, start: number): number {
  if (next !== DOLLAR) return -1;
  const double = cx.char(start + 1) === DOLLAR;
  const open = double ? 2 : 1;
  const contentStart = start + open;
  const first = cx.char(contentStart);
  // `$ x$` 这类以空白开头的不视为公式（避免误伤「$5 和 $10」之类的普通文本）
  if (first < 0 || isSpace(first) || first === DOLLAR) return -1;

  for (let pos = contentStart; pos < cx.end; pos += 1) {
    const ch = cx.char(pos);
    if (ch === BACKSLASH) {
      pos += 1;
      continue;
    }
    // 行内公式不跨行
    if (ch === NEWLINE) return -1;
    if (ch !== DOLLAR) continue;
    if (double) {
      if (cx.char(pos + 1) !== DOLLAR) return -1;
      const end = pos + 2;
      return cx.addElement(
        cx.elt('InlineMath', start, end, [
          cx.elt('InlineMathMark', start, contentStart),
          cx.elt('InlineMathMark', pos, end),
        ])
      );
    }
    // 结束的 $ 前不能是空白、后面不能紧跟数字（Pandoc 规则）
    if (isSpace(cx.char(pos - 1)) || isDigit(cx.char(pos + 1))) return -1;
    const end = pos + 1;
    return cx.addElement(
      cx.elt('InlineMath', start, end, [
        cx.elt('InlineMathMark', start, contentStart),
        cx.elt('InlineMathMark', pos, end),
      ])
    );
  }
  return -1;
}

/** 当前行是否以 `$$` 开头（允许前导缩进） */
const startsBlockMath = (line: Line) =>
  line.next === DOLLAR && line.text.charCodeAt(line.pos + 1) === DOLLAR;

/** 解析块级公式 */
function parseBlockMath(cx: BlockContext, line: Line): boolean {
  if (!startsBlockMath(line)) return false;
  const start = cx.lineStart + line.pos;
  const marks = [cx.elt('BlockMathMark', start, start + 2)];
  const firstRest = line.text.slice(line.pos + 2);
  const firstTrimmed = firstRest.trimEnd();

  // 单行形式：$$ x^2 $$
  if (firstTrimmed.length >= 2 && firstTrimmed.endsWith('$$')) {
    const closeFrom = cx.lineStart + line.pos + 2 + firstTrimmed.length - 2;
    const end = cx.lineStart + line.text.trimEnd().length;
    marks.push(cx.elt('BlockMathMark', closeFrom, closeFrom + 2));
    cx.nextLine();
    cx.addElement(cx.elt('BlockMath', start, end, marks));
    return true;
  }

  let end = cx.lineStart + line.text.length;
  while (cx.nextLine()) {
    const text = line.text;
    // 遇到空行仍未闭合：就地结束，避免吞掉后续内容
    if (text.trim() === '') break;
    const trimmed = text.trimEnd();
    if (trimmed.endsWith('$$')) {
      const closeFrom = cx.lineStart + trimmed.length - 2;
      marks.push(cx.elt('BlockMathMark', closeFrom, closeFrom + 2));
      end = cx.lineStart + trimmed.length;
      cx.nextLine();
      cx.addElement(cx.elt('BlockMath', start, end, marks));
      return true;
    }
    end = cx.lineStart + text.length;
  }
  cx.addElement(cx.elt('BlockMath', start, end, marks));
  return true;
}

/** 数学公式 Markdown 扩展（与 GFM 一起传给 `markdown({ extensions })`） */
export const mathMarkdownSyntax: MarkdownConfig = {
  defineNodes: [
    { name: 'InlineMath' },
    { name: 'InlineMathMark' },
    { name: 'BlockMath', block: true },
    { name: 'BlockMathMark' },
  ],
  parseInline: [{ name: 'InlineMath', parse: parseInlineMath }],
  parseBlock: [
    {
      name: 'BlockMath',
      parse: parseBlockMath,
      // 段落中途出现 `$$` 行时打断段落
      endLeaf: (_cx, line) => startsBlockMath(line),
      before: 'FencedCode',
    },
  ],
};
