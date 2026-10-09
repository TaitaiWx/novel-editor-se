// @vitest-environment happy-dom
import type { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let cache: typeof import('@/render/components/TextEditor/live-preview/render-cache');
let widgets: typeof import('@/render/components/TextEditor/live-preview/widgets');
let finish: () => void;
let started: number;
let failLoad: boolean;

// Hold only the dependency boundary; formulas still render through the real KaTeX implementation.
beforeEach(async () => {
  vi.resetModules();
  started = 0;
  failLoad = false;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  vi.doMock('katex', async (importOriginal) => {
    started += 1;
    await gate;
    if (failLoad) throw new Error('formula chunk unavailable');
    return importOriginal<typeof import('katex')>();
  });
  cache = await import('@/render/components/TextEditor/live-preview/render-cache');
  widgets = await import('@/render/components/TextEditor/live-preview/widgets');
});
afterEach(() => {
  finish();
  document.body.innerHTML = '';
});

function fakeView(composing = false) {
  const view = { composing, dom: document.createElement('div'), requestMeasure: vi.fn() };
  return view as typeof view & EditorView;
}

describe('formula dependency on demand', () => {
  it('does not load KaTeX for ordinary table cells or code containing dollar signs', () => {
    expect(cache.renderInlineCell('**正文**')).toBe('<strong>正文</strong>');
    expect(cache.renderTable('| 人物 |\n|---|\n| 林舟 |').ok).toBe(true);
    expect(cache.renderInlineCell('`$a^2$`')).toBe('<code>$a^2$</code>');
    expect(started).toBe(0);
  });

  it('renders source while loading, updates inline/display/table math and does not cache pending math', async () => {
    const inline = new widgets.MathWidget('a^2', false).toDOM();
    const display = new widgets.MathWidget('b^2', true).toDOM();
    const table = new widgets.TableWidget('| 能量 |\n|---|\n| $E=mc^2$ |').toDOM();
    document.body.append(inline, display, table);
    expect(inline.textContent).toBe('$a^2$');
    expect(inline.querySelector('.cm-lp-error-marker')).toBeNull();
    expect(table.textContent).toContain('$E=mc^2$');
    expect(cache.getRenderCacheStats().math.size).toBe(0);
    expect(cache.getRenderCacheStats().table.size).toBe(0);
    finish();
    await vi.waitFor(() => {
      expect(inline.querySelector('math')).not.toBeNull();
      expect(display.querySelector('math')).not.toBeNull();
      expect(table.querySelector('math')).not.toBeNull();
    });
    expect(started).toBe(1);
    expect(cache.getRenderCacheStats().math.size).toBe(3);
  });

  it('defers an asynchronous formula layout update until IME composition ends', async () => {
    const view = fakeView(true);
    const el = new widgets.MathWidget('x^2', true).toDOM(view);
    document.body.append(el);
    finish();
    await cache.loadMathRenderer();
    expect(el.querySelector('math')).toBeNull();
    expect(view.requestMeasure).not.toHaveBeenCalled();
    view.composing = false;
    view.dom.dispatchEvent(new Event('compositionend'));
    await vi.waitFor(() => expect(el.querySelector('math')).not.toBeNull());
    expect(view.requestMeasure).toHaveBeenCalledOnce();
  });

  it('does not mutate or measure a widget retired before the formula import completes', async () => {
    const view = fakeView();
    const widget = new widgets.MathWidget('x^2', false);
    const el = widget.toDOM(view);
    document.body.append(el);
    widget.destroy(el);
    finish();
    await cache.loadMathRenderer();
    expect(el.textContent).toBe('$x^2$');
    expect(el.querySelector('math')).toBeNull();
    expect(view.requestMeasure).not.toHaveBeenCalled();
  });

  it('updates the replacement widget for the current document after editing during load', async () => {
    const { EditorState } = await import('@codemirror/state');
    const { EditorView } = await import('@codemirror/view');
    const { markdown, markdownLanguage } = await import('@codemirror/lang-markdown');
    const { mathMarkdownSyntax } = await import(
      '@/render/components/TextEditor/live-preview/math-syntax'
    );
    const { markdownLivePreview } = await import('@/render/components/TextEditor/live-preview');
    const parent = document.createElement('div');
    document.body.append(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: '# 标题\n\n$a^2$\n\n正文',
        selection: { anchor: 0 },
        extensions: [
          markdown({ base: markdownLanguage, extensions: [mathMarkdownSyntax] }),
          markdownLivePreview({ filePath: '/书/章节.md' }),
        ],
      }),
      parent,
    });
    try {
      const old = view.contentDOM.querySelector('.cm-lp-math')!;
      expect(old.textContent).toBe('$a^2$');
      const from = view.state.doc.toString().indexOf('a^2');
      view.dispatch({ changes: { from, to: from + 3, insert: 'b^3' } });
      finish();
      await vi.waitFor(() =>
        expect(view.contentDOM.querySelector('math annotation')?.textContent).toBe('b^3')
      );
      expect(view.contentDOM.querySelectorAll('.cm-lp-math')).toHaveLength(1);
      expect(old.querySelector('math')).toBeNull();
      expect(view.state.doc.toString()).toBe('# 标题\n\n$b^3$\n\n正文');
    } finally {
      view.destroy();
    }
  });

  it('shows recoverable dependency errors and retries math in tables as well as standalone formulas', async () => {
    failLoad = true;
    const view = fakeView();
    const el = new widgets.MathWidget('x^2', false).toDOM(view);
    const table = new widgets.TableWidget('| 值 |\n|---|\n| $x^2$ |').toDOM(view);
    document.body.append(el, table);
    finish();
    await cache.loadMathRenderer();
    expect(el.querySelector('.cm-lp-error-marker')?.getAttribute('title')).toContain('加载失败');
    expect(el.querySelector('button')?.textContent).toBe('重试');
    expect(table.querySelector('button')?.textContent).toBe('重试');
    expect(cache.getRenderCacheStats().math.size).toBe(0);
    expect(cache.getRenderCacheStats().table.size).toBe(0);
    // Replace the unavailable network module with the now available real module.
    vi.doMock('katex', (importOriginal) => importOriginal<typeof import('katex')>());
    el.querySelector('button')!.click();
    await vi.waitFor(() => {
      expect(el.querySelector('math')).not.toBeNull();
      expect(table.querySelector('math')).not.toBeNull();
      expect(el.querySelector('.cm-lp-error-marker')).toBeNull();
    });
    expect(view.requestMeasure).toHaveBeenCalledTimes(4);
  });
});
