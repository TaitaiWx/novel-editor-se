/**
 * 实时预览装饰的构建（纯函数，不依赖 EditorView）。
 *
 * 以语法树顶层块（段落、标题、表格、公式块、代码块、列表、引用……）为单位处理：
 * - 只处理与给定范围（可见区域 + 余量）相交的块，块内节点也按范围裁剪
 * - 每个块独立 try/catch：任何一个块出错只会让它退回原文，不影响其它块
 * - 「光标所在即源码」：行内语法按行展开，表格 / 公式块 / 代码块按整块展开
 */
import type { EditorState, Range, SelectionRange, Text } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode, Tree, TreeCursor } from '@lezer/common';
import {
  BulletWidget,
  CheckboxWidget,
  CodeLangWidget,
  ErrorMarkerWidget,
  HrWidget,
  ImageWidget,
  MathPreviewWidget,
  MathWidget,
  TableWidget,
} from './widgets';
import { resolveImageSource } from './image-loader';

export interface LivePreviewBuildOptions {
  /** 当前文件路径，用于解析图片相对路径 */
  filePath: string | null;
}

export interface BlockInfo {
  name: string;
  from: number;
  to: number;
}

/** 超过该长度的单个表格 / 公式块不再渲染为 widget（保持原文，避免一次性大块渲染） */
export const MAX_WIDGET_BLOCK_CHARS = 50_000;

const HIDE = Decoration.replace({});
const SYNTAX_MARK = Decoration.mark({ class: 'cm-lp-syntax' });
const lineDecoCache = new Map<string, Decoration>();
const markDecoCache = new Map<string, Decoration>();

const lineDeco = (cls: string) => {
  let deco = lineDecoCache.get(cls);
  if (!deco) {
    deco = Decoration.line({ class: cls });
    lineDecoCache.set(cls, deco);
  }
  return deco;
};

const markDeco = (cls: string) => {
  let deco = markDecoCache.get(cls);
  if (!deco) {
    deco = Decoration.mark({ class: cls });
    markDecoCache.set(cls, deco);
  }
  return deco;
};

/** 一次构建的上下文：选区、裁剪范围、输出数组 */
class BuildContext {
  readonly doc: Text;
  readonly out: Range<Decoration>[] = [];
  private readonly selection: readonly SelectionRange[];
  clipFrom = 0;
  clipTo = 0;

  constructor(
    readonly state: EditorState,
    readonly options: LivePreviewBuildOptions
  ) {
    this.doc = state.doc;
    this.selection = state.selection.ranges;
  }

  /** 区间是否与任一选区相交（含端点：光标贴在块边缘也算在块内） */
  rangeRevealed(from: number, to: number): boolean {
    for (const range of this.selection) {
      if (range.from <= to && range.to >= from) return true;
    }
    return false;
  }

  /** pos 所在行是否有光标 / 选区 */
  lineRevealed(pos: number): boolean {
    const line = this.doc.lineAt(pos);
    return this.rangeRevealed(line.from, line.to);
  }

  /** 节点覆盖的所有行是否有光标（行内语法跨软换行时使用） */
  linesRevealed(from: number, to: number): boolean {
    return this.rangeRevealed(this.doc.lineAt(from).from, this.doc.lineAt(to).to);
  }

  push(range: Range<Decoration>): void {
    this.out.push(range);
  }

  /** 给 [from, to] 覆盖的每一行（限裁剪范围内）加行装饰 */
  eachLine(from: number, to: number, cls: (index: number, last: boolean) => string): void {
    const start = this.doc.lineAt(Math.max(from, this.clipFrom));
    const endLine = this.doc.lineAt(to);
    const firstLine = this.doc.lineAt(from).number;
    const stop = Math.min(endLine.number, this.doc.lineAt(Math.min(to, this.clipTo)).number);
    for (let n = start.number; n <= stop; n += 1) {
      const line = this.doc.line(n);
      this.push(lineDeco(cls(n - firstLine, n === endLine.number)).range(line.from));
    }
  }

  /** 隐藏语法标记，或在展开时把它染成淡色 */
  hideOrDim(from: number, to: number, revealed: boolean): void {
    if (to <= from) return;
    this.push(revealed ? SYNTAX_MARK.range(from, to) : HIDE.range(from, to));
  }

  /** 标记后面紧跟的空格一起隐藏（如「# 」「> 」） */
  spacesAfter(pos: number, max = 4): number {
    let end = pos;
    const lineEnd = this.doc.lineAt(pos).to;
    while (end < lineEnd && end - pos < max && this.doc.sliceString(end, end + 1) === ' ') end += 1;
    return end;
  }

  /** 区间是否正好是整行（可用块级替换） */
  coversWholeLines(from: number, to: number): boolean {
    return this.doc.lineAt(from).from === from && this.doc.lineAt(to).to === to;
  }
}

/** 列出语法树中与 [from, to] 相交的顶层块 */
export function collectTopLevelBlocks(tree: Tree, from: number, to: number): BlockInfo[] {
  const blocks: BlockInfo[] = [];
  let node: SyntaxNode | null = tree.topNode.childAfter(Math.max(0, from - 1));
  while (node && node.from <= to) {
    if (node.to >= from) blocks.push({ name: node.name, from: node.from, to: node.to });
    node = node.nextSibling;
  }
  return blocks;
}

const childrenOf = (node: SyntaxNode, name: string): SyntaxNode[] => node.getChildren(name);

// ── 各语法节点的处理：返回 true 表示继续处理子节点 ──

function handleHeaderMark(ctx: BuildContext, node: SyntaxNode): void {
  const parent = node.parent;
  if (!parent) return;
  if (parent.name.startsWith('ATXHeading')) {
    const revealed = ctx.lineRevealed(node.from);
    if (node.from === parent.from) {
      ctx.hideOrDim(node.from, ctx.spacesAfter(node.to), revealed);
    } else {
      // 结尾的 ### 连同前面的空格一起隐藏
      let start = node.from;
      while (start > parent.from && ctx.doc.sliceString(start - 1, start) === ' ') start -= 1;
      ctx.hideOrDim(start, node.to, revealed);
    }
    return;
  }
  // Setext 标题的下划线：未展开时连同前面的换行一起隐藏
  const revealed = ctx.rangeRevealed(parent.from, parent.to);
  const markLine = ctx.doc.lineAt(node.from);
  if (revealed) ctx.push(SYNTAX_MARK.range(node.from, node.to));
  else if (markLine.from > parent.from) ctx.push(HIDE.range(markLine.from - 1, markLine.to));
}

function handleLink(ctx: BuildContext, node: SyntaxNode): boolean {
  const marks = childrenOf(node, 'LinkMark');
  const url = node.getChild('URL');
  if (marks.length < 2 || !url) return true;
  const href = ctx.doc.sliceString(url.from, url.to);
  const textFrom = marks[0].to;
  const textTo = marks[1].from;
  if (textTo > textFrom) {
    ctx.push(
      Decoration.mark({
        class: 'cm-lp-link',
        attributes: { 'data-lp-href': href, title: `${href}（⌘/Ctrl + 点击打开）` },
      }).range(textFrom, textTo)
    );
  }
  const revealed = ctx.linesRevealed(node.from, node.to);
  ctx.hideOrDim(marks[0].from, marks[0].to, revealed);
  ctx.hideOrDim(marks[1].from, node.to, revealed);
  return true;
}

function handleUrl(ctx: BuildContext, node: SyntaxNode): void {
  const parentName = node.parent?.name;
  if (parentName === 'Link' || parentName === 'Image' || parentName === 'LinkReference') return;
  const href = ctx.doc.sliceString(node.from, node.to);
  ctx.push(
    Decoration.mark({
      class: 'cm-lp-link',
      attributes: { 'data-lp-href': href, title: `${href}（⌘/Ctrl + 点击打开）` },
    }).range(node.from, node.to)
  );
  if (parentName === 'Autolink') {
    const revealed = ctx.lineRevealed(node.from);
    for (const mark of childrenOf(node.parent as SyntaxNode, 'LinkMark')) {
      ctx.hideOrDim(mark.from, mark.to, revealed);
    }
  }
}

function handleImage(ctx: BuildContext, node: SyntaxNode): void {
  if (ctx.linesRevealed(node.from, node.to)) return;
  const marks = childrenOf(node, 'LinkMark');
  const url = node.getChild('URL');
  if (marks.length < 2 || !url) return;
  const alt = ctx.doc.sliceString(marks[0].to, marks[1].from);
  const src = resolveImageSource(ctx.doc.sliceString(url.from, url.to), ctx.options.filePath);
  ctx.push(Decoration.replace({ widget: new ImageWidget(src, alt) }).range(node.from, node.to));
}

function handleListMark(ctx: BuildContext, node: SyntaxNode): void {
  const revealed = ctx.lineRevealed(node.from);
  const list = node.parent?.parent;
  if (list?.name === 'OrderedList') {
    ctx.push(markDeco(revealed ? 'cm-lp-syntax' : 'cm-lp-list-number').range(node.from, node.to));
    return;
  }
  if (revealed) {
    ctx.push(SYNTAX_MARK.range(node.from, node.to));
    return;
  }
  const hasTask = node.nextSibling?.name === 'Task';
  if (hasTask) ctx.push(HIDE.range(node.from, ctx.spacesAfter(node.to, 1)));
  else ctx.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
}

function handleTaskMarker(ctx: BuildContext, node: SyntaxNode): void {
  const text = ctx.doc.sliceString(node.from, node.to);
  const checked = /x/i.test(text);
  const task = node.parent;
  if (checked && task && task.to > node.to + 1) {
    ctx.push(markDeco('cm-lp-task-done').range(ctx.spacesAfter(node.to, 1), task.to));
  }
  if (ctx.lineRevealed(node.from)) return;
  ctx.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(node.from, node.to));
}

function handleFencedCode(ctx: BuildContext, node: SyntaxNode): void {
  ctx.eachLine(node.from, node.to, (index, last) =>
    index === 0
      ? 'cm-lp-codeblock cm-lp-codeblock-begin'
      : last
        ? 'cm-lp-codeblock cm-lp-codeblock-end'
        : 'cm-lp-codeblock'
  );
  if (ctx.rangeRevealed(node.from, node.to)) return;
  const marks = childrenOf(node, 'CodeMark');
  if (marks.length === 0) return;
  const info = node.getChild('CodeInfo');
  const lang = info ? ctx.doc.sliceString(info.from, info.to).trim() : '';
  const firstLine = ctx.doc.lineAt(marks[0].from);
  ctx.push(
    Decoration.replace({ widget: new CodeLangWidget(lang) }).range(marks[0].from, firstLine.to)
  );
  const closing = marks[marks.length - 1];
  if (marks.length > 1 && ctx.doc.lineAt(closing.from).number !== firstLine.number) {
    ctx.push(HIDE.range(closing.from, closing.to));
  }
}

function handleTable(ctx: BuildContext, node: SyntaxNode): void {
  const tooLarge = node.to - node.from > MAX_WIDGET_BLOCK_CHARS;
  if (tooLarge || ctx.rangeRevealed(node.from, node.to)) {
    ctx.eachLine(node.from, node.to, () => 'cm-lp-table-src');
    return;
  }
  const source = ctx.doc.sliceString(node.from, node.to);
  ctx.push(
    Decoration.replace({
      widget: new TableWidget(source),
      block: ctx.coversWholeLines(node.from, node.to),
    }).range(node.from, node.to)
  );
}

function handleBlockMath(ctx: BuildContext, node: SyntaxNode): void {
  const marks = childrenOf(node, 'BlockMathMark');
  const closed = marks.length >= 2;
  const firstLine = ctx.doc.lineAt(node.from);
  if (!closed) {
    ctx.eachLine(node.from, node.to, () => 'cm-lp-math-src');
    ctx.push(
      Decoration.widget({
        widget: new ErrorMarkerWidget('公式块未闭合', '缺少结尾的 $$'),
        side: 1,
      }).range(firstLine.to)
    );
    return;
  }
  const source = ctx.doc.sliceString(marks[0].to, marks[marks.length - 1].from).trim();
  const tooLarge = node.to - node.from > MAX_WIDGET_BLOCK_CHARS;
  if (tooLarge || ctx.rangeRevealed(node.from, node.to)) {
    ctx.eachLine(node.from, node.to, () => 'cm-lp-math-src');
    // 编辑公式时在源码下方显示实时预览
    if (!tooLarge && ctx.coversWholeLines(node.from, node.to)) {
      ctx.push(
        Decoration.widget({ widget: new MathPreviewWidget(source), block: true, side: 1 }).range(
          node.to
        )
      );
    }
    return;
  }
  ctx.push(
    Decoration.replace({
      widget: new MathWidget(source, true),
      block: ctx.coversWholeLines(node.from, node.to),
    }).range(node.from, node.to)
  );
}

function handleInlineMath(ctx: BuildContext, node: SyntaxNode): void {
  const marks = childrenOf(node, 'InlineMathMark');
  if (marks.length < 2) return;
  const revealed = ctx.lineRevealed(node.from);
  if (revealed) {
    ctx.push(markDeco('cm-lp-math-src-inline').range(node.from, node.to));
    return;
  }
  const source = ctx.doc.sliceString(marks[0].to, marks[1].from);
  ctx.push(Decoration.replace({ widget: new MathWidget(source, false) }).range(node.from, node.to));
}

const INLINE_STYLE: Record<string, string> = {
  Emphasis: 'cm-lp-em',
  StrongEmphasis: 'cm-lp-strong',
  Strikethrough: 'cm-lp-strike',
  InlineCode: 'cm-lp-code',
};

/** 处理单个节点；返回是否继续进入子节点 */
function handleNode(ctx: BuildContext, node: SyntaxNode): boolean {
  const name = node.name;
  if (name.startsWith('ATXHeading')) {
    ctx.push(
      lineDeco(`cm-lp-heading cm-lp-h${name.slice(-1)}`).range(ctx.doc.lineAt(node.from).from)
    );
    return true;
  }
  if (name.startsWith('SetextHeading')) {
    const level = name.slice(-1);
    const marker = node.getChild('HeaderMark');
    const textEnd = marker ? Math.max(node.from, marker.from - 1) : node.to;
    ctx.eachLine(node.from, textEnd, () => `cm-lp-heading cm-lp-h${level}`);
    return true;
  }
  const inlineClass = INLINE_STYLE[name];
  if (inlineClass) {
    ctx.push(markDeco(inlineClass).range(node.from, node.to));
    return true;
  }
  switch (name) {
    case 'HeaderMark':
      handleHeaderMark(ctx, node);
      return false;
    case 'EmphasisMark':
    case 'StrikethroughMark':
      ctx.hideOrDim(node.from, node.to, ctx.lineRevealed(node.from));
      return false;
    case 'CodeMark':
      if (node.parent?.name === 'InlineCode') {
        ctx.hideOrDim(node.from, node.to, ctx.lineRevealed(node.from));
      }
      return false;
    case 'Escape':
      if (!ctx.lineRevealed(node.from)) ctx.push(HIDE.range(node.from, node.from + 1));
      return false;
    case 'Link':
      return handleLink(ctx, node);
    case 'URL':
      handleUrl(ctx, node);
      return false;
    case 'Image':
      handleImage(ctx, node);
      return false;
    case 'ListMark':
      handleListMark(ctx, node);
      return false;
    case 'TaskMarker':
      handleTaskMarker(ctx, node);
      return false;
    case 'Blockquote':
      ctx.eachLine(node.from, node.to, () => 'cm-lp-quote');
      return true;
    case 'QuoteMark':
      ctx.hideOrDim(node.from, ctx.spacesAfter(node.to, 1), ctx.lineRevealed(node.from));
      return false;
    case 'HorizontalRule':
      if (!ctx.lineRevealed(node.from)) {
        ctx.push(Decoration.replace({ widget: new HrWidget() }).range(node.from, node.to));
      }
      return false;
    case 'FencedCode':
      handleFencedCode(ctx, node);
      return false;
    case 'CodeBlock':
      ctx.eachLine(node.from, node.to, () => 'cm-lp-codeblock');
      return false;
    case 'Table':
      handleTable(ctx, node);
      return false;
    case 'BlockMath':
      handleBlockMath(ctx, node);
      return false;
    case 'InlineMath':
      handleInlineMath(ctx, node);
      return false;
    case 'HTMLBlock':
    case 'HTMLTag':
    case 'CommentBlock':
    case 'Comment':
    case 'ProcessingInstructionBlock':
    case 'LinkReference':
      return false;
    default:
      return true;
  }
}

/** 深度优先遍历块内与裁剪范围相交的节点 */
function walkBlock(ctx: BuildContext, cursor: TreeCursor): void {
  let depth = 0;
  for (;;) {
    let descend = false;
    if (cursor.to >= ctx.clipFrom && cursor.from <= ctx.clipTo) {
      descend = handleNode(ctx, cursor.node);
    }
    // childAfter 借助平衡树直接跳到裁剪范围内的第一个子节点（超长列表不必逐项遍历）
    if (descend && cursor.childAfter(ctx.clipFrom - 1)) {
      depth += 1;
      continue;
    }
    for (;;) {
      if (depth === 0) return;
      if (cursor.nextSibling() && cursor.from <= ctx.clipTo) break;
      cursor.parent();
      depth -= 1;
    }
  }
}

/**
 * 为一组顶层块构建装饰（每块独立 try/catch）。
 * clipFrom / clipTo 限定块内参与处理的范围（大列表只处理可见部分）。
 */
export function buildBlockDecorations(
  state: EditorState,
  tree: Tree,
  blocks: readonly BlockInfo[],
  clipFrom: number,
  clipTo: number,
  options: LivePreviewBuildOptions
): Range<Decoration>[] {
  const ctx = new BuildContext(state, options);
  ctx.clipFrom = clipFrom;
  ctx.clipTo = clipTo;
  for (const block of blocks) {
    const node = tree.topNode.childAfter(Math.max(0, block.from - 1));
    if (!node || node.from !== block.from || node.name !== block.name) continue;
    const mark = ctx.out.length;
    try {
      walkBlock(ctx, node.cursor());
    } catch (err) {
      // 单个块出错：丢弃它已生成的装饰，退回原文
      ctx.out.length = mark;
      console.warn('[live-preview] 块渲染失败，已退回原文', block, err);
    }
  }
  return ctx.out;
}

/** 构建 [from, to] 范围内的全部装饰 */
export function buildLivePreviewRanges(
  state: EditorState,
  from: number,
  to: number,
  options: LivePreviewBuildOptions
): Range<Decoration>[] {
  const tree = syntaxTree(state);
  const blocks = collectTopLevelBlocks(tree, from, to);
  return buildBlockDecorations(state, tree, blocks, from, to, options);
}

/** 便于测试 / 基准：直接得到排序好的 DecorationSet */
export function buildLivePreviewDecorations(
  state: EditorState,
  from: number,
  to: number,
  options: LivePreviewBuildOptions
) {
  return Decoration.set(buildLivePreviewRanges(state, from, to, options), true);
}
