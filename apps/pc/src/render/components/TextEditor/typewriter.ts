/**
 * 专注模式的打字机滚动：光标所在行始终停在视口垂直中央，滚动条完全隐藏（滚轮 / 键盘仍可滚动）。
 *
 * - 上下留白：.cm-content 上下各留「视口高度 / 2 - 行高 / 2」，首行与末行也能滚到中央。
 *   数值经 measure 计算后写入编辑器根节点的 CSS 变量 --cm-typewriter-pad（未测量前回退 50vh）
 * - 触发时机：进入专注模式、选区 / 文档变化（键入、方向键、翻页、撤销）、点击（松开鼠标后）、窗口尺寸变化
 * - 进入专注模式、尺寸变化与光标不在已渲染范围时，用 CodeMirror 的 scrollIntoView(y: 'center') 效果居中；
 *   其余情况在 measure 中读取光标与视口中线的距离：在容差内不滚动（持续键入同一视觉行时零开销），
 *   超出则平滑滚动（prefers-reduced-motion 时直接跳转）
 * - 测量放在下一帧：CodeMirror 自己的滚动（如翻页的 scrollIntoView 效果）在同一帧的测量末尾才执行，
 *   推迟一帧读取的才是滚动后的真实位置，避免重复滚动
 * - 拖选期间不居中（文字在鼠标下移动会打断选择），松开后稍等再居中，不干扰双击选词
 */
import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

/** 编辑器根节点上的 CSS 变量：打字机上下留白（px） */
export const TYPEWRITER_PAD_VAR = '--cm-typewriter-pad';
/** 隐藏滚动条的 class（专注模式） */
export const HIDE_SCROLLBAR_CLASS = 'cm-hide-scrollbar';
/** 光标中线与视口中线的最小容差（px） */
export const TYPEWRITER_MIN_TOLERANCE = 4;
/** 超过视口高度的这个倍数时直接跳转，不做平滑动画 */
export const TYPEWRITER_SMOOTH_LIMIT = 1.5;
/** 松开鼠标后等待多久再居中（毫秒），给双击 / 三击留出时间 */
export const TYPEWRITER_CLICK_SETTLE_MS = 220;

/** 上下留白：保证首行 / 末行的中线也能到达视口中线 */
export function computeTypewriterPadding(viewportHeight: number, lineHeight: number): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0;
  const line = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 0;
  return Math.max(0, Math.round((viewportHeight - line) / 2));
}

/** 容差：约 1/3 行高，至少 4px（同一视觉行内键入不会触发滚动） */
export function typewriterTolerance(lineHeight: number): number {
  const line = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 0;
  return Math.max(TYPEWRITER_MIN_TOLERANCE, Math.round(line / 3));
}

export type TypewriterAction =
  | { kind: 'none' }
  /** 光标不在已渲染范围：交给 CodeMirror scrollIntoView(y: 'center') */
  | { kind: 'center' }
  | { kind: 'scroll'; delta: number; smooth: boolean };

export interface TypewriterMeasure {
  /** 光标垂直中线（视口坐标）；光标不在已渲染范围时为 null */
  cursorCenter: number | null;
  /** 滚动容器可视区域的垂直中线（视口坐标） */
  viewportCenter: number;
  viewportHeight: number;
  tolerance: number;
  /** 是否允许平滑滚动（prefers-reduced-motion / 尺寸变化时为 false） */
  smooth: boolean;
}

/** 根据测量结果决定如何滚动（纯函数） */
export function planTypewriterScroll(measure: TypewriterMeasure): TypewriterAction {
  if (measure.cursorCenter === null) return { kind: 'center' };
  const delta = measure.cursorCenter - measure.viewportCenter;
  if (Math.abs(delta) <= measure.tolerance) return { kind: 'none' };
  const far = Math.abs(delta) > measure.viewportHeight * TYPEWRITER_SMOOTH_LIMIT;
  return { kind: 'scroll', delta, smooth: measure.smooth && !far };
}

/** 居中当前光标的 CodeMirror 效果 */
export const centerCursorEffect = (view: EditorView) =>
  EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' });

const prefersReducedMotion = (view: EditorView): boolean => {
  const win = view.dom.ownerDocument.defaultView;
  return Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
};

interface MeasureResult {
  height: number;
  width: number;
  padding: number;
  plan: TypewriterMeasure;
}

class TypewriterView {
  private frame = 0;
  private clickTimer: ReturnType<typeof setTimeout> | null = null;
  private pointerDown = false;
  private destroyed = false;
  /** 下一次测量是否禁止平滑（进入 / 尺寸变化） */
  private instant = true;
  private size = { height: -1, width: -1 };
  private padding = -1;

  constructor(private readonly view: EditorView) {
    // 进入专注模式：直接居中（同步阶段不能 dispatch，放到微任务）
    queueMicrotask(() => this.center());
    this.queue(true);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet) {
      if (this.pointerDown) return;
      this.queue(false);
    } else if (update.geometryChanged) {
      // 尺寸是否变化在测量时判断；内容高度变化不会触发滚动（容差内）
      this.queue(false);
    }
  }

  /** 鼠标按下：拖选期间暂停居中 */
  onPointerDown() {
    this.pointerDown = true;
    this.cancelClickTimer();
    const doc = this.view.dom.ownerDocument;
    doc.addEventListener('mouseup', this.onPointerUp, { once: true });
  }

  private onPointerUp = () => {
    this.pointerDown = false;
    this.cancelClickTimer();
    this.clickTimer = setTimeout(() => {
      this.clickTimer = null;
      this.queue(false);
    }, TYPEWRITER_CLICK_SETTLE_MS);
  };

  private cancelClickTimer() {
    if (this.clickTimer) clearTimeout(this.clickTimer);
    this.clickTimer = null;
  }

  /** 居中当前光标（CodeMirror scrollIntoView 效果，自动处理未渲染的远处光标） */
  center() {
    if (this.destroyed) return;
    this.view.dispatch({ effects: centerCursorEffect(this.view) });
  }

  /** 推迟到下一帧测量（见文件头说明） */
  queue(instant: boolean) {
    if (this.destroyed) return;
    if (instant) this.instant = true;
    if (this.frame) return;
    const win = this.view.dom.ownerDocument.defaultView ?? window;
    this.frame = win.requestAnimationFrame(() => {
      this.frame = 0;
      if (this.destroyed) return;
      this.view.requestMeasure({
        key: this,
        read: (view) => this.read(view),
        write: (result, view) => this.write(result, view),
      });
    });
  }

  private read(view: EditorView): MeasureResult {
    const scroller = view.scrollDOM;
    const rect = scroller.getBoundingClientRect();
    const height = scroller.clientHeight;
    const lineHeight = view.defaultLineHeight;
    const head = view.state.selection.main.head;
    const coords = view.coordsAtPos(head, 1) ?? view.coordsAtPos(head, -1);
    const resized = height !== this.size.height || scroller.clientWidth !== this.size.width;
    return {
      height,
      width: scroller.clientWidth,
      padding: computeTypewriterPadding(height, lineHeight),
      plan: {
        cursorCenter: coords ? (coords.top + coords.bottom) / 2 : null,
        viewportCenter: rect.top + height / 2,
        viewportHeight: height,
        tolerance: typewriterTolerance(lineHeight),
        smooth: !this.instant && !resized && !prefersReducedMotion(view),
      },
    };
  }

  private write(result: MeasureResult, view: EditorView) {
    if (this.destroyed || result.height <= 0) return;
    const resized = result.height !== this.size.height || result.width !== this.size.width;
    this.size = { height: result.height, width: result.width };
    if (result.padding !== this.padding) {
      // 留白变化会移动全部内容：先写入，下一帧按新布局再测量
      this.padding = result.padding;
      view.dom.style.setProperty(TYPEWRITER_PAD_VAR, `${result.padding}px`);
      this.queue(true);
      return;
    }
    const wasInstant = this.instant;
    this.instant = false;
    const action = planTypewriterScroll(result.plan);
    if (action.kind === 'none') return;
    if (action.kind === 'center' || ((resized || wasInstant) && action.kind === 'scroll')) {
      queueMicrotask(() => this.center());
      return;
    }
    const scroller = view.scrollDOM;
    // 用绝对目标位置：平滑滚动进行中再次触发时不会叠加位移
    const top = scroller.scrollTop + action.delta;
    if (action.smooth && typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({ top, behavior: 'smooth' });
    } else {
      scroller.scrollTop = top;
    }
  }

  destroy() {
    this.destroyed = true;
    this.cancelClickTimer();
    if (this.frame)
      (this.view.dom.ownerDocument.defaultView ?? window).cancelAnimationFrame(this.frame);
    this.view.dom.ownerDocument.removeEventListener('mouseup', this.onPointerUp);
    this.view.dom.style.removeProperty(TYPEWRITER_PAD_VAR);
  }
}

export const typewriterPlugin = ViewPlugin.fromClass(TypewriterView, {
  eventHandlers: {
    mousedown(event) {
      if (event.button === 0) this.onPointerDown();
      return false;
    },
  },
});

const typewriterTheme = EditorView.theme({
  // 上下留白：首行 / 末行也能滚到视口中央
  [`&.${HIDE_SCROLLBAR_CLASS} .cm-content`]: {
    paddingTop: `var(${TYPEWRITER_PAD_VAR}, 50vh)`,
    paddingBottom: `var(${TYPEWRITER_PAD_VAR}, 50vh)`,
  },
  // 完全隐藏滚动条（标准属性优先于 ::-webkit-scrollbar，两者都写以防万一）
  [`&.${HIDE_SCROLLBAR_CLASS} .cm-scroller`]: {
    scrollbarWidth: 'none',
  },
  [`&.${HIDE_SCROLLBAR_CLASS} .cm-scroller::-webkit-scrollbar`]: {
    display: 'none',
    width: '0',
    height: '0',
  },
});

/** 打字机滚动 + 隐藏滚动条（专注模式使用） */
export const typewriterMode = (): Extension => [
  EditorView.editorAttributes.of({ class: HIDE_SCROLLBAR_CLASS }),
  typewriterPlugin,
  typewriterTheme,
];
