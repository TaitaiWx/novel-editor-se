// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { focusLineDecorations } from '@/render/components/TextEditor/focus-mode';
import {
  HIDE_SCROLLBAR_CLASS,
  TYPEWRITER_CLICK_SETTLE_MS,
  TYPEWRITER_PAD_VAR,
  computeTypewriterPadding,
  planTypewriterScroll,
  typewriterTolerance,
} from '@/render/components/TextEditor/typewriter';

describe('computeTypewriterPadding', () => {
  it('上下留白 = (视口高度 - 行高) / 2，首行 / 末行也能到达中线', () => {
    expect(computeTypewriterPadding(800, 34)).toBe(383);
    expect(computeTypewriterPadding(601, 0)).toBe(301);
  });

  it('非法尺寸返回 0，行高异常按 0 处理', () => {
    expect(computeTypewriterPadding(0, 30)).toBe(0);
    expect(computeTypewriterPadding(Number.NaN, 30)).toBe(0);
    expect(computeTypewriterPadding(20, 60)).toBe(0);
    expect(computeTypewriterPadding(400, Number.NaN)).toBe(200);
  });
});

describe('typewriterTolerance', () => {
  it('约 1/3 行高，至少 4px', () => {
    expect(typewriterTolerance(33)).toBe(11);
    expect(typewriterTolerance(6)).toBe(4);
    expect(typewriterTolerance(Number.NaN)).toBe(4);
  });
});

describe('planTypewriterScroll', () => {
  const base = { viewportCenter: 400, viewportHeight: 800, tolerance: 10, smooth: true };

  it('容差内不滚动（同一视觉行持续键入零开销）', () => {
    expect(planTypewriterScroll({ ...base, cursorCenter: 409 })).toEqual({ kind: 'none' });
    expect(planTypewriterScroll({ ...base, cursorCenter: 390 })).toEqual({ kind: 'none' });
  });

  it('超出容差时平滑滚动到中线', () => {
    expect(planTypewriterScroll({ ...base, cursorCenter: 440 })).toEqual({
      kind: 'scroll',
      delta: 40,
      smooth: true,
    });
    expect(planTypewriterScroll({ ...base, cursorCenter: 100 })).toEqual({
      kind: 'scroll',
      delta: -300,
      smooth: true,
    });
  });

  it('减少动态效果 / 距离过远时直接跳转', () => {
    expect(planTypewriterScroll({ ...base, smooth: false, cursorCenter: 440 })).toMatchObject({
      smooth: false,
    });
    expect(planTypewriterScroll({ ...base, cursorCenter: 400 + 800 * 2 })).toMatchObject({
      smooth: false,
    });
  });

  it('光标不在已渲染范围时交给 scrollIntoView(center)', () => {
    expect(planTypewriterScroll({ ...base, cursorCenter: null })).toEqual({ kind: 'center' });
  });
});

describe('打字机模式（挂载到 EditorView）', () => {
  let view: EditorView | null = null;
  afterEach(() => {
    view?.destroy();
    view = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const LINES = Array.from({ length: 80 }, (_, i) => `第${i + 1}段`).join('\n');

  /** happy-dom 没有布局：给滚动容器和光标坐标打桩，cursorTop 控制光标位置 */
  function mount(focus: boolean) {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const created = new EditorView({
      state: EditorState.create({ doc: LINES, extensions: [focusLineDecorations(focus)] }),
      parent,
    });
    view = created;
    const geometry = { cursorTop: 300 as number | null };
    Object.defineProperty(created.scrollDOM, 'clientHeight', { configurable: true, value: 600 });
    Object.defineProperty(created.scrollDOM, 'clientWidth', { configurable: true, value: 800 });
    vi.spyOn(created.scrollDOM, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 600,
      left: 0,
      right: 800,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(created, 'coordsAtPos').mockImplementation(() =>
      geometry.cursorTop === null
        ? null
        : { top: geometry.cursorTop, bottom: geometry.cursorTop + 20, left: 0, right: 1 }
    );
    return { view: created, geometry };
  }

  /** 是否派发过 scrollIntoView 效果（CodeMirror 未导出效果类型，按 effects 非空且无选区 / 文档变化判断） */
  const centerDispatches = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.filter((call) => {
      const spec = call[0] as { effects?: unknown; selection?: unknown; changes?: unknown };
      return Boolean(spec?.effects) && !spec.selection && !spec.changes;
    }).length;

  it('专注模式隐藏滚动条并设置上下留白；关闭后移除', async () => {
    const { view: v } = mount(true);
    expect(v.dom.classList.contains(HIDE_SCROLLBAR_CLASS)).toBe(true);
    await vi.waitFor(() =>
      expect(v.dom.style.getPropertyValue(TYPEWRITER_PAD_VAR)).toBe(
        `${computeTypewriterPadding(600, v.defaultLineHeight)}px`
      )
    );
    view?.destroy();
    view = null;
    const plain = mount(false);
    expect(plain.view.dom.classList.contains(HIDE_SCROLLBAR_CLASS)).toBe(false);
  });

  it('进入专注模式时派发居中效果；选区变化后光标偏离中线则滚动，容差内不滚动', async () => {
    const dispatchSpy = vi.spyOn(EditorView.prototype, 'dispatch');
    const { view: v, geometry } = mount(true);
    await vi.waitFor(() => expect(centerDispatches(dispatchSpy)).toBeGreaterThanOrEqual(1));
    // 等留白写入
    await vi.waitFor(() => expect(v.dom.style.getPropertyValue(TYPEWRITER_PAD_VAR)).not.toBe(''));

    const scrollTo = vi.fn();
    Object.defineProperty(v.scrollDOM, 'scrollTo', { configurable: true, value: scrollTo });
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    // 先等初始测量结束
    await new Promise((resolve) => setTimeout(resolve, 80));
    scrollTo.mockClear();

    // 光标在中线附近：不滚动
    geometry.cursorTop = 292;
    v.dispatch({ selection: { anchor: v.state.doc.line(10).from } });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(scrollTo).not.toHaveBeenCalled();

    // 光标偏下：平滑滚动到中线
    geometry.cursorTop = 500;
    v.dispatch({ selection: { anchor: v.state.doc.line(20).from } });
    await vi.waitFor(() => expect(scrollTo).toHaveBeenCalled());
    const target = scrollTo.mock.calls[0][0] as ScrollToOptions;
    expect(target.behavior).toBe('smooth');
    expect(target.top).toBe(v.scrollDOM.scrollTop + (510 - 300));

    // 光标不在已渲染范围：交给 scrollIntoView(center)
    const before = centerDispatches(dispatchSpy);
    geometry.cursorTop = null;
    v.dispatch({ selection: { anchor: v.state.doc.line(70).from } });
    await vi.waitFor(() => expect(centerDispatches(dispatchSpy)).toBeGreaterThan(before));
  });

  it('prefers-reduced-motion 时直接跳转，不做平滑动画', async () => {
    const { view: v, geometry } = mount(true);
    await vi.waitFor(() => expect(v.dom.style.getPropertyValue(TYPEWRITER_PAD_VAR)).not.toBe(''));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const scrollTo = vi.fn();
    Object.defineProperty(v.scrollDOM, 'scrollTo', { configurable: true, value: scrollTo });
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    v.scrollDOM.scrollTop = 0;
    geometry.cursorTop = 400;
    v.dispatch({ selection: { anchor: v.state.doc.line(12).from } });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('拖选期间不居中，松开鼠标稍后才居中', async () => {
    const { view: v, geometry } = mount(true);
    await vi.waitFor(() => expect(v.dom.style.getPropertyValue(TYPEWRITER_PAD_VAR)).not.toBe(''));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const scrollTo = vi.fn();
    Object.defineProperty(v.scrollDOM, 'scrollTo', { configurable: true, value: scrollTo });
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);

    v.contentDOM.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    geometry.cursorTop = 520;
    v.dispatch({ selection: { anchor: v.state.doc.line(15).from } });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(scrollTo).not.toHaveBeenCalled();

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, TYPEWRITER_CLICK_SETTLE_MS / 2));
    expect(scrollTo).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(scrollTo).toHaveBeenCalled());
  });
});
