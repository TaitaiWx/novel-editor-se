/**
 * 实时预览用到的 CodeMirror widget。
 *
 * 约定：
 * - 每个 widget 都实现 eq()，内容相同则复用 DOM，避免滚动 / 输入时的 DOM 抖动
 * - 重型渲染（公式、表格）在 toDOM 内单独 try/catch：出错时显示原文 + 错误标记，
 *   绝不抛出到 CodeMirror（相当于每个 widget 自带错误边界）
 * - 公式 / 表格的点击事件交给编辑器处理（ignoreEvent 返回 false），点击即把光标移入源码并展开
 */
import { EditorView, WidgetType } from '@codemirror/view';
import {
  type RenderResult,
  hasCachedMath,
  hasCachedTable,
  hasRenderBudget,
  renderMath,
  renderTable,
  scheduleFrame,
  spendRenderBudget,
} from './render-cache';
import { loadImageUrl } from './image-loader';

const LINE_HEIGHT_ESTIMATE = 22;

/** 创建错误标记（细小的「!」徽标，悬停显示原因） */
export function createErrorMarker(kind: string, message: string): HTMLElement {
  const marker = document.createElement('span');
  marker.className = 'cm-lp-error-marker';
  marker.textContent = '!';
  marker.title = `${kind}：${message}`;
  marker.setAttribute('aria-label', `${kind}：${message}`);
  marker.setAttribute('role', 'img');
  return marker;
}

/** 把渲染结果写入容器：成功写 HTML，失败显示原文 + 错误标记 */
function fillRendered(
  container: HTMLElement,
  result: RenderResult,
  source: string,
  kind: string
): void {
  container.classList.remove('cm-lp-pending');
  if (result.ok) {
    container.innerHTML = result.html;
    container.classList.remove('cm-lp-render-error');
    return;
  }
  container.classList.add('cm-lp-render-error');
  container.textContent = '';
  const raw = document.createElement('span');
  raw.className = 'cm-lp-raw-source';
  raw.textContent = source;
  container.append(raw, createErrorMarker(kind, result.error));
}

/** 带预算的重型渲染：有缓存或预算充足时同步渲染，否则下一帧再渲染 */
function renderWithBudget(
  container: HTMLElement,
  view: EditorView | null,
  cached: boolean,
  render: () => RenderResult,
  source: string,
  kind: string
): void {
  const run = () => {
    let result: RenderResult;
    try {
      result = spendRenderBudget(render);
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    fillRendered(container, result, source, kind);
  };
  if (cached || hasRenderBudget()) {
    run();
    return;
  }
  container.classList.add('cm-lp-pending');
  container.textContent = source;
  scheduleFrame(() => {
    if (!container.isConnected && view) return;
    run();
    view?.requestMeasure();
  });
}

/** KaTeX 公式（行内或展示） */
export class MathWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly display: boolean
  ) {
    super();
  }

  eq(other: MathWidget): boolean {
    return other.source === this.source && other.display === this.display;
  }

  get estimatedHeight(): number {
    return this.display ? LINE_HEIGHT_ESTIMATE * 2 : -1;
  }

  toDOM(view?: EditorView): HTMLElement {
    const el = document.createElement(this.display ? 'div' : 'span');
    el.className = `cm-lp-math ${this.display ? 'cm-lp-math-display' : 'cm-lp-math-inline'}`;
    renderWithBudget(
      el,
      view ?? null,
      hasCachedMath(this.source, this.display),
      () => renderMath(this.source, this.display),
      this.display ? `$$${this.source}$$` : `$${this.source}$`,
      '公式错误'
    );
    return el;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** 公式块编辑时显示在源码下方的实时预览 */
export class MathPreviewWidget extends MathWidget {
  constructor(source: string) {
    super(source, true);
  }

  eq(other: MathWidget): boolean {
    return other instanceof MathPreviewWidget && other.source === this.source;
  }

  toDOM(view?: EditorView): HTMLElement {
    const el = super.toDOM(view);
    el.classList.add('cm-lp-math-preview');
    return el;
  }
}

/** GFM 表格 */
export class TableWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.source === this.source;
  }

  get estimatedHeight(): number {
    return (this.source.split('\n').length - 1) * (LINE_HEIGHT_ESTIMATE + 8);
  }

  toDOM(view?: EditorView): HTMLElement {
    const el = document.createElement('div');
    el.className = 'cm-lp-table';
    renderWithBudget(
      el,
      view ?? null,
      hasCachedTable(this.source),
      () => renderTable(this.source),
      this.source,
      '表格格式错误'
    );
    return el;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** 行内图片：进入视口（toDOM）时才读取文件 */
export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }

  toDOM(view?: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-lp-image cm-lp-pending';
    wrap.textContent = this.alt || '图片';
    loadImageUrl(this.src)
      .then((url) => {
        const img = document.createElement('img');
        img.alt = this.alt;
        img.src = url;
        img.loading = 'lazy';
        img.addEventListener('load', () => view?.requestMeasure(), { once: true });
        wrap.classList.remove('cm-lp-pending');
        wrap.textContent = '';
        wrap.append(img);
      })
      .catch(() => {
        wrap.classList.remove('cm-lp-pending');
        wrap.classList.add('cm-lp-render-error');
        wrap.textContent = this.alt || this.src;
        wrap.append(createErrorMarker('图片无法加载', this.src));
      });
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** 任务列表复选框：点击切换 `[ ]` / `[x]` */
export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked;
  }

  toDOM(view?: EditorView): HTMLElement {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-lp-checkbox';
    box.checked = this.checked;
    box.setAttribute('aria-label', this.checked ? '已完成任务' : '未完成任务');
    box.addEventListener('mousedown', (event) => {
      event.preventDefault();
      if (!view) return;
      toggleTaskAt(view, view.posAtDOM(box));
    });
    return box;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** 切换 pos 处的任务标记（`[ ]` ↔ `[x]`）；成功返回 true */
export function toggleTaskAt(view: EditorView, pos: number): boolean {
  if (view.state.readOnly || !view.state.facet(EditorView.editable)) return false;
  const text = view.state.doc.sliceString(pos, pos + 3);
  if (!/^\[[ xX]\]$/.test(text)) return false;
  const next = text[1] === ' ' ? 'x' : ' ';
  view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: next }, userEvent: 'input' });
  return true;
}

/** 无序列表圆点 */
export class BulletWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-lp-bullet';
    el.textContent = '•';
    return el;
  }
}

/** 分割线 */
export class HrWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-lp-hr';
    el.setAttribute('role', 'separator');
    return el;
  }
}

/** 代码块语言标签（替换开头的 ```lang） */
export class CodeLangWidget extends WidgetType {
  constructor(readonly lang: string) {
    super();
  }

  eq(other: CodeLangWidget): boolean {
    return other.lang === this.lang;
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-lp-code-lang';
    el.textContent = this.lang || '代码';
    return el;
  }
}

/** 源码中就地显示的错误标记（如未闭合的公式块、坏公式） */
export class ErrorMarkerWidget extends WidgetType {
  constructor(
    readonly kind: string,
    readonly message: string
  ) {
    super();
  }

  eq(other: ErrorMarkerWidget): boolean {
    return other.kind === this.kind && other.message === this.message;
  }

  toDOM(): HTMLElement {
    return createErrorMarker(this.kind, this.message);
  }
}
