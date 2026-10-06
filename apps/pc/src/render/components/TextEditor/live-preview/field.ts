/**
 * 实时预览的状态字段与视口同步。
 *
 * 为什么用 StateField 而不是 ViewPlugin：表格 / 公式块的替换装饰会跨越换行、改变行高，
 * CodeMirror 只允许直接提供（非函数形式）的装饰影响纵向布局，所以必须放在 StateField 中。
 * 字段本身不知道视口，由下方 ViewPlugin 在可见范围移出已构建范围时派发 effect 告知。
 *
 * 增量策略：
 * - 只构建「可见范围 + 余量」内的块
 * - 文档 / 选区变化时，比较变化前后的顶层块：未被修改、且与新旧选区都无关的块
 *   直接沿用映射后的装饰，只重建受影响的块
 * - IME 组字期间只映射位置，不重建（避免打断输入法），组字结束后再刷新
 */
import {
  type EditorState,
  type EditorSelection,
  StateEffect,
  StateField,
  type Transaction,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import {
  type BlockInfo,
  type LivePreviewBuildOptions,
  buildBlockDecorations,
  collectTopLevelBlocks,
} from './build-decorations';

/** 首次创建时预先构建的范围（字符数），视口确定后由插件校正 */
export const INITIAL_RANGE_CHARS = 20_000;
/** 可见范围之外额外构建的余量（字符数） */
export const VIEWPORT_MARGIN_CHARS = 3_000;

export interface PreviewRange {
  from: number;
  to: number;
}

export interface LivePreviewValue {
  range: PreviewRange;
  decorations: DecorationSet;
}

/** 告知字段新的构建范围（触发该范围的完整构建） */
export const setLivePreviewRange = StateEffect.define<PreviewRange>();
/** 强制完整重建当前范围（例如 IME 组字结束） */
export const refreshLivePreview = StateEffect.define<null>();

const clampRange = (range: PreviewRange, length: number): PreviewRange => ({
  from: Math.max(0, Math.min(range.from, length)),
  to: Math.max(0, Math.min(range.to, length)),
});

/** 块（扩展到整行）是否与选区相交：行内语法按行展开，所以要按整行判断 */
function blockTouchesSelection(
  state: EditorState,
  selection: EditorSelection,
  block: BlockInfo
): boolean {
  const from = state.doc.lineAt(block.from).from;
  const to = state.doc.lineAt(Math.min(block.to, state.doc.length)).to;
  return selection.ranges.some((range) => range.from <= to && range.to >= from);
}

const blockKey = (name: string, from: number, to: number) => `${name}:${from}:${to}`;

/** 判断装饰 [from, to] 是否完整落在某个保留块内（kept 按 from 升序） */
function insideKeptBlock(kept: readonly BlockInfo[], from: number, to: number): boolean {
  let lo = 0;
  let hi = kept.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (kept[mid].from <= from) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found >= 0 && to <= kept[found].to;
}

/** 完整构建 range 内的装饰 */
export function buildFull(
  state: EditorState,
  range: PreviewRange,
  options: LivePreviewBuildOptions
): DecorationSet {
  const tree = syntaxTree(state);
  const blocks = collectTopLevelBlocks(tree, range.from, range.to);
  return Decoration.set(
    buildBlockDecorations(state, tree, blocks, range.from, range.to, options),
    true
  );
}

/** 增量构建：只重建受修改或选区影响的顶层块 */
export function buildIncremental(
  value: LivePreviewValue,
  tr: Transaction,
  range: PreviewRange,
  options: LivePreviewBuildOptions
): DecorationSet {
  const oldBlocks = collectTopLevelBlocks(
    syntaxTree(tr.startState),
    value.range.from,
    value.range.to
  );
  const clean = new Set<string>();
  for (const block of oldBlocks) {
    if (tr.docChanged && tr.changes.touchesRange(block.from, block.to)) continue;
    if (blockTouchesSelection(tr.startState, tr.startState.selection, block)) continue;
    clean.add(
      blockKey(block.name, tr.changes.mapPos(block.from, 1), tr.changes.mapPos(block.to, -1))
    );
  }

  const tree = syntaxTree(tr.state);
  const kept: BlockInfo[] = [];
  const dirty: BlockInfo[] = [];
  for (const block of collectTopLevelBlocks(tree, range.from, range.to)) {
    const unchanged = clean.has(blockKey(block.name, block.from, block.to));
    if (unchanged && !blockTouchesSelection(tr.state, tr.state.selection, block)) kept.push(block);
    else dirty.push(block);
  }
  if (dirty.length === 0 && !tr.docChanged) return value.decorations;

  const mapped = tr.docChanged ? value.decorations.map(tr.changes) : value.decorations;
  return mapped.update({
    filter: (from, to) => insideKeptBlock(kept, from, to),
    add: buildBlockDecorations(tr.state, tree, dirty, range.from, range.to, options),
    sort: true,
  });
}

/** 字段的 update 逻辑（导出供单测直接驱动） */
export function updateLivePreview(
  value: LivePreviewValue,
  tr: Transaction,
  options: LivePreviewBuildOptions
): LivePreviewValue {
  let range = value.range;
  if (tr.docChanged) {
    range = { from: tr.changes.mapPos(range.from, -1), to: tr.changes.mapPos(range.to, 1) };
  }
  let full = false;
  for (const effect of tr.effects) {
    if (effect.is(setLivePreviewRange)) {
      range = clampRange(effect.value, tr.state.doc.length);
      full = true;
    } else if (effect.is(refreshLivePreview)) {
      full = true;
    }
  }
  const treeChanged = syntaxTree(tr.state) !== syntaxTree(tr.startState);
  const selectionChanged = !tr.startState.selection.eq(tr.state.selection);
  if (!tr.docChanged && !selectionChanged && !full && !treeChanged) return value;

  // IME 组字期间只映射，不重建正在组字的行
  if (!full && tr.isUserEvent('input.type.compose')) {
    return { range, decorations: value.decorations.map(tr.changes) };
  }
  // 解析器在后台推进（树变化但文档未变）时整体重建：范围很小，开销可忽略
  if (full || (treeChanged && !tr.docChanged)) {
    return { range, decorations: buildFull(tr.state, range, options) };
  }
  return { range, decorations: buildIncremental(value, tr, range, options) };
}

/** 创建实时预览字段 */
export function createLivePreviewField(options: LivePreviewBuildOptions) {
  return StateField.define<LivePreviewValue>({
    create(state) {
      const range = { from: 0, to: Math.min(state.doc.length, INITIAL_RANGE_CHARS) };
      return { range, decorations: buildFull(state, range, options) };
    },
    update: (value, tr) => updateLivePreview(value, tr, options),
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
  });
}

/** 可见范围的并集 */
export function visibleSpan(view: EditorView): PreviewRange {
  const ranges = view.visibleRanges;
  if (ranges.length === 0) return { from: view.viewport.from, to: view.viewport.to };
  return { from: ranges[0].from, to: ranges[ranges.length - 1].to };
}

/** 视口同步：可见范围移出已构建范围时，派发新的构建范围 */
class ViewportSync {
  private pending = false;
  private destroyed = false;

  constructor(
    private readonly view: EditorView,
    private readonly field: StateField<LivePreviewValue>
  ) {
    this.schedule();
  }

  update(update: ViewUpdate): void {
    if (update.viewportChanged || update.docChanged || update.geometryChanged) this.schedule();
  }

  private schedule(): void {
    if (this.pending) return;
    this.pending = true;
    // 不能在 update 过程中派发事务，放到微任务里合并处理
    queueMicrotask(() => {
      this.pending = false;
      if (!this.destroyed) this.sync();
    });
  }

  private sync(): void {
    const value = this.view.state.field(this.field, false);
    if (!value) return;
    const visible = visibleSpan(this.view);
    if (visible.from >= value.range.from && visible.to <= value.range.to) return;
    const length = this.view.state.doc.length;
    this.view.dispatch({
      effects: setLivePreviewRange.of({
        from: Math.max(0, visible.from - VIEWPORT_MARGIN_CHARS),
        to: Math.min(length, visible.to + VIEWPORT_MARGIN_CHARS),
      }),
    });
  }

  destroy(): void {
    this.destroyed = true;
  }
}

export function createViewportSync(field: StateField<LivePreviewValue>) {
  return ViewPlugin.define((view) => new ViewportSync(view, field));
}
