/**
 * 专注模式（CodeMirror 扩展）：
 * - 渐进淡化：当前段落全亮，上下各 3 段按距离逐级变淡，其余保持可读的低对比度，不模糊
 * - 打字机滚动：光标所在行始终保持在视口中部附近
 *
 * 距离的计量单位：「文档行」，并跳过空行。
 * 小说正文一行就是一个自然段，长段落在屏幕上折成多行时仍是同一个文档行，整段使用同一档透明度，
 * 不会出现「一个段落上半截亮、下半截暗」；段落之间的空行不计入距离（空行本身没有可见内容）。
 * 选择文档行而不是视觉行，是因为视觉行随窗口宽度变化，且需要测量布局才能得到，无法廉价地在每次光标移动时计算。
 *
 * 性能：
 * - 透明度默认值（最远一档）由 CSS 给出，装饰只加在光标附近最多 2×3+1 行上，且只装饰可见范围内的行
 * - 仅在选区 / 文档 / 视口变化时重建
 * - Markdown 实时预览的块级部件（表格、公式块）不是 .cm-line，由 BlockWidgetFocus 在写阶段打上
 *   data-focus-distance 属性（CodeMirror 会忽略部件内部的 DOM 变化）
 */
import type { EditorState, Extension, Text } from '@codemirror/state';
import { Range } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';

/** 计算淡化档位的最大距离（超过即为最远一档） */
export const FOCUS_MAX_DISTANCE = 3;
/** 每个方向最多扫描的文档行数（连续很多空行时不再继续找） */
export const FOCUS_SCAN_LIMIT = 64;
/** 打字机滚动：上下各保留视口高度的比例，光标保持在中间约 16% 的区域内 */
export const TYPEWRITER_MARGIN_RATIO = 0.42;

/** 各档透明度：0 为当前段落，FAR 为其余文字（仍可阅读） */
export const FOCUS_OPACITY = {
  0: 1,
  1: 0.85,
  2: 0.65,
  3: 0.45,
  far: 0.28,
} as const;

export interface FocusRange {
  from: number;
  to: number;
}

const isBlank = (text: string) => text.trim().length === 0;

/**
 * 以光标所在行为中心，向上 / 向下各找最多 maxDistance 个非空行，返回「行号 → 距离」。
 * 光标所在行距离为 0（即使是空行）；未出现在结果中的行属于最远一档。
 */
export function computeFocusDistances(
  doc: Text,
  head: number,
  maxDistance: number = FOCUS_MAX_DISTANCE
): Map<number, number> {
  const active = doc.lineAt(Math.max(0, Math.min(head, doc.length))).number;
  const distances = new Map<number, number>([[active, 0]]);
  for (const step of [-1, 1]) {
    let distance = 0;
    let scanned = 0;
    for (
      let n = active + step;
      n >= 1 && n <= doc.lines && distance < maxDistance && scanned < FOCUS_SCAN_LIMIT;
      n += step, scanned += 1
    ) {
      if (isBlank(doc.line(n).text)) continue;
      distance += 1;
      distances.set(n, distance);
    }
  }
  return distances;
}

/** 行区间 [startLine, endLine] 内最近的距离；都不在附近时返回 null（最远一档） */
export function focusDistanceForLines(
  distances: ReadonlyMap<number, number>,
  startLine: number,
  endLine: number
): number | null {
  let best: number | null = null;
  for (const [line, distance] of distances) {
    if (line < startLine || line > endLine) continue;
    if (best === null || distance < best) best = distance;
  }
  return best;
}

export const focusLineClass = (distance: number) => `cm-focus-d${distance}`;

/** 构建可见范围内的分档行装饰（最远一档不加装饰，由 CSS 默认值处理） */
export function buildFocusDecorations(
  state: EditorState,
  visibleRanges: readonly FocusRange[]
): DecorationSet {
  const { doc } = state;
  const distances = computeFocusDistances(doc, state.selection.main.head);
  const ranges: Range<Decoration>[] = [];
  for (const [lineNumber, distance] of distances) {
    const line = doc.line(lineNumber);
    const visible = visibleRanges.some((r) => line.from <= r.to && line.to >= r.from);
    if (!visible) continue;
    ranges.push(Decoration.line({ class: focusLineClass(distance) }).range(line.from));
  }
  return Decoration.set(ranges, true);
}

class FocusLinePlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildFocusDecorations(view.state, view.visibleRanges);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = buildFocusDecorations(update.state, update.view.visibleRanges);
    }
  }
}

const focusLinePlugin = ViewPlugin.fromClass(FocusLinePlugin, {
  decorations: (plugin) => plugin.decorations,
});

/** 给块级部件（表格 / 公式块等，非 .cm-line）打上与所覆盖行一致的距离档位 */
export function tagBlockWidgets(view: EditorView): void {
  const { doc } = view.state;
  const distances = computeFocusDistances(doc, view.state.selection.main.head);
  for (const child of Array.from(view.contentDOM.children)) {
    if (!(child instanceof HTMLElement) || child.classList.contains('cm-line')) continue;
    let distance: number | null = null;
    try {
      const pos = view.posAtDOM(child);
      const block = view.lineBlockAt(pos);
      distance = focusDistanceForLines(
        distances,
        doc.lineAt(block.from).number,
        doc.lineAt(Math.min(block.to, doc.length)).number
      );
    } catch {
      distance = null;
    }
    const next = distance === null ? null : String(distance);
    if (child.dataset.focusDistance === next) continue;
    if (next === null) delete child.dataset.focusDistance;
    else child.dataset.focusDistance = next;
  }
}

const blockWidgetFocus = ViewPlugin.fromClass(
  class {
    constructor(private readonly view: EditorView) {
      this.schedule();
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.geometryChanged
      ) {
        this.schedule();
      }
    }

    private schedule() {
      this.view.requestMeasure({
        key: this,
        read: () => null,
        write: () => tagBlockWidgets(this.view),
      });
    }
  }
);

/** 打字机滚动：滚动到光标时上下预留大边距，使当前行停在视口中部 */
const typewriterScrollMargins = EditorView.scrollMargins.of((view) => {
  const height = view.scrollDOM.clientHeight;
  if (height <= 0) return null;
  const margin = Math.round(height * TYPEWRITER_MARGIN_RATIO);
  return { top: margin, bottom: margin };
});

const opacityRule = (opacity: number) => ({ opacity: String(opacity) });

const focusTheme = EditorView.theme({
  // 默认（最远一档）：所有行与块级部件都保持可读的低对比度
  '&.cm-focus-mode .cm-content > *': {
    ...opacityRule(FOCUS_OPACITY.far),
    transition: 'opacity 0.24s ease',
  },
  '&.cm-focus-mode .cm-line.cm-focus-d0, &.cm-focus-mode .cm-content > [data-focus-distance="0"]':
    opacityRule(FOCUS_OPACITY[0]),
  '&.cm-focus-mode .cm-line.cm-focus-d1, &.cm-focus-mode .cm-content > [data-focus-distance="1"]':
    opacityRule(FOCUS_OPACITY[1]),
  '&.cm-focus-mode .cm-line.cm-focus-d2, &.cm-focus-mode .cm-content > [data-focus-distance="2"]':
    opacityRule(FOCUS_OPACITY[2]),
  '&.cm-focus-mode .cm-line.cm-focus-d3, &.cm-focus-mode .cm-content > [data-focus-distance="3"]':
    opacityRule(FOCUS_OPACITY[3]),
});

/** 专注模式扩展：未开启时为空 */
export const focusLineDecorations = (enabled: boolean): Extension => {
  if (!enabled) return [];
  return [
    EditorView.editorAttributes.of({ class: 'cm-focus-mode' }),
    focusLinePlugin,
    blockWidgetFocus,
    typewriterScrollMargins,
    focusTheme,
  ];
};
