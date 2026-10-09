// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState, StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { markdownLivePreview } from '@/render/components/TextEditor/live-preview';
import { mathMarkdownSyntax } from '@/render/components/TextEditor/live-preview/math-syntax';
import {
  buildBlockDecorations,
  collectTopLevelBlocks,
} from '@/render/components/TextEditor/live-preview/build-decorations';
import {
  clearRenderCaches,
  loadMathRenderer,
  renderMath,
} from '@/render/components/TextEditor/live-preview/render-cache';
import { MathWidget, toggleTaskAt } from '@/render/components/TextEditor/live-preview/widgets';

// These tests exercise synchronous rendering after the formula dependency is available.
beforeAll(() => loadMathRenderer());

const markdownLang = markdown({ base: markdownLanguage, extensions: [mathMarkdownSyntax] });

const SAMPLE = [
  '# 排版示例',
  '',
  '**加粗** 与 [链接](https://example.com)',
  '',
  '| 角色 | 等级 |',
  '|---|---|',
  '| 林舟 | 3 |',
  '',
  '行内公式 $a^2+b^2=c^2$',
  '',
  '$$',
  '\\sum_{i=1}^n i',
  '$$',
  '',
  '坏公式 $\\frac{1}{$ 结束',
  '',
  '- [ ] 待办',
].join('\n');

const invoke = vi.fn();
let view: EditorView | null = null;

function mount(doc: string, cursor = doc.length) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [markdownLang, markdownLivePreview({ filePath: '/书/a.md' })],
    }),
    parent,
  });
  return view;
}

const lineText = (v: EditorView, lineNumber: number) => {
  const pos = v.state.doc.line(lineNumber).from;
  const { node } = v.domAtPos(pos);
  const el = node instanceof Element ? node : node.parentElement;
  return el?.closest('.cm-line')?.textContent ?? '';
};

beforeEach(() => {
  clearRenderCaches();
  invoke.mockReset().mockResolvedValue({ success: true });
  Object.defineProperty(window, 'electron', {
    value: { ipcRenderer: { invoke } },
    configurable: true,
  });
});

afterEach(() => {
  view?.destroy();
  view = null;
  Reflect.deleteProperty(window, 'electron');
  document.body.innerHTML = '';
});

describe('实时预览（真实 EditorView）', () => {
  it('渲染公式、表格；坏公式显示原文与错误标记，其它照常', () => {
    const v = mount(SAMPLE);
    const content = v.contentDOM;
    expect(content.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2);
    expect(content.querySelector('.cm-lp-table table')).not.toBeNull();
    const marker = content.querySelector('.cm-lp-error-marker');
    expect(marker?.getAttribute('title')).toContain('公式错误');
    expect(marker?.parentElement?.textContent).toContain('\\frac{1}{');
    // 标题的 # 已隐藏
    expect(lineText(v, 1)).toBe('排版示例');
  });

  it('示例作品集的 排版示例.md 与 E2E 的预期一致', () => {
    const doc = readFileSync(
      path.resolve(__dirname, '../../../../sample-data/排版示例.md'),
      'utf-8'
    );
    const v = mount(doc);
    const content = v.contentDOM;
    expect(content.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(3);
    expect(content.querySelector('.cm-lp-table th')?.textContent).toBe('角色');
    const markers = content.querySelectorAll('.cm-lp-error-marker');
    expect(markers).toHaveLength(1);
    expect(markers[0].getAttribute('title')).toContain('公式错误');
    expect(markers[0].parentElement?.textContent).toContain('\\frac{1}{2');
    expect(lineText(v, 1)).toBe('排版示例');
  });

  it('光标移入标题时显示 #，移出后再次隐藏', async () => {
    const v = mount(SAMPLE);
    v.dispatch({ selection: { anchor: 3 } });
    expect(lineText(v, 1)).toBe('# 排版示例');
    v.dispatch({ selection: { anchor: v.state.doc.length } });
    expect(lineText(v, 1)).toBe('排版示例');
  });

  it('任务复选框切换文本', () => {
    const v = mount(SAMPLE, 0);
    const pos = SAMPLE.indexOf('[ ]');
    expect(toggleTaskAt(v, pos)).toBe(true);
    expect(v.state.doc.sliceString(pos, pos + 3)).toBe('[x]');
    expect(toggleTaskAt(v, 0)).toBe(false);
    const box = v.contentDOM.querySelector('.cm-lp-checkbox');
    expect(box).not.toBeNull();
    box?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(v.state.doc.sliceString(pos, pos + 3)).toBe('[ ]');
    // 只读时不允许切换
    v.dispatch({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) });
    expect(toggleTaskAt(v, pos)).toBe(false);
  });

  it('⌘/Ctrl + 点击链接交给主进程打开，普通点击不打开', () => {
    const v = mount(SAMPLE);
    const link = v.contentDOM.querySelector('[data-lp-href]') as HTMLElement;
    expect(link.getAttribute('data-lp-href')).toBe('https://example.com');
    link.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    expect(invoke).not.toHaveBeenCalled();
    link.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, metaKey: true }));
    expect(invoke).toHaveBeenCalledWith('open-external-url', 'https://example.com');
  });

  it('视口同步：插件把构建范围校正到可见区域附近', async () => {
    const doc = Array.from({ length: 3000 }, (_, i) => `## 小节 ${i}\n\n正文`).join('\n\n');
    const v = mount(doc, 0);
    await Promise.resolve();
    await Promise.resolve();
    expect(v.contentDOM.querySelector('.cm-lp-h2')).not.toBeNull();
  });
});

/** 生成约 5MB / 10 万行的 Markdown（含标题、强调、列表、表格、公式） */
function generateLargeMarkdown(targetLines: number): string {
  const section = (i: number) => [
    `## 第 ${i} 节 设定与推演`,
    '',
    `林舟在第 ${i} 天整理笔记，**重要线索**与*次要线索*都记了下来，还有 \`代码 ${i}\` 与 ~~旧设定~~。`,
    `能量守恒 $E_${i}=mc^2$，衰减系数 $\\lambda_{${i}}=\\frac{1}{${(i % 9) + 1}}$，继续推演下去。`,
    '这一段是普通的叙述文字，用来模拟长篇小说中占比最大的正文段落。'.repeat(6),
    '',
    `- 线索 ${i}-A：[资料](https://example.com/${i})`,
    `- [x] 已核对 ${i}`,
    `- [ ] 待补充 ${i}`,
    '',
    '| 属性 | 数值 | 备注 |',
    '|---|---:|---|',
    `| 力量 | ${i % 100} | **成长** |`,
    `| 敏捷 | ${(i * 7) % 100} | $x^${i % 5}$ |`,
    '',
    '$$',
    `\\sum_{k=1}^{${i}} k = \\frac{${i}(${i}+1)}{2}`,
    '$$',
    '',
    '> 引用：设定不能崩。',
    '',
  ];
  const lines: string[] = [];
  for (let i = 0; lines.length < targetLines; i += 1) lines.push(...section(i));
  return lines.slice(0, targetLines).join('\n');
}

describe('性能：大文档只构建视口', () => {
  it('10 万行 / 约 5MB 文档，每个视口的装饰构建远低于一帧', () => {
    const doc = generateLargeMarkdown(100_000);
    expect(doc.split('\n').length).toBe(100_000);
    // 中文按 UTF-8 计约 5MB
    expect(new TextEncoder().encode(doc).length).toBeGreaterThan(5_000_000);
    const state = EditorState.create({ doc, extensions: [markdownLang] });
    // 解析整篇文档（准备工作，不计入构建时间）
    const tree = ensureSyntaxTree(state, state.doc.length, 120_000);
    expect(tree?.length).toBe(doc.length);
    if (!tree) return;

    const VIEWPORT_LINES = 80;
    const measure = (startLine: number) => {
      const from = state.doc.line(startLine).from;
      const to = state.doc.line(Math.min(state.doc.lines, startLine + VIEWPORT_LINES)).to;
      const begin = performance.now();
      const blocks = collectTopLevelBlocks(tree, from, to);
      const ranges = buildBlockDecorations(state, tree, blocks, from, to, { filePath: null });
      const elapsed = performance.now() - begin;
      expect(ranges.length).toBeGreaterThan(20);
      return elapsed;
    };

    const positions = [1, 25_000, 50_000, 75_000, 99_900];
    // 冷启动（首次构建，含 JIT 预热）
    const cold = positions.map(measure);
    // 热路径：多次采样取中位数
    const warm: number[] = [];
    for (let round = 0; round < 5; round += 1) warm.push(...positions.map(measure));
    warm.sort((a, b) => a - b);
    const median = warm[Math.floor(warm.length / 2)];
    const worst = warm[warm.length - 1];
    console.info(
      `[live-preview perf] doc=${(doc.length / 1e6).toFixed(2)}M chars, ` +
        `bytes=${(new TextEncoder().encode(doc).length / 1e6).toFixed(2)}MB, cold=${cold.map((t) => t.toFixed(2)).join('/')}ms, ` +
        `warm median=${median.toFixed(2)}ms, worst=${worst.toFixed(2)}ms`
    );
    // 目标 < 16ms；CI 机器较慢，断言放宽
    expect(median).toBeLessThan(16);
    expect(worst).toBeLessThan(50);
  }, 180_000);

  it('公式密集文档：视口构建不渲染公式，首次渲染一屏公式的耗时有上限', () => {
    const lines: string[] = [];
    for (let i = 0; lines.length < 20_000; i += 1) {
      lines.push(
        `设 $x_{${i}}=\\sqrt{${i}}$，$y_{${i}}=\\frac{${i}}{${i + 1}}$，且 $\\alpha^${i % 7}$ 成立。`,
        '',
        '$$',
        `\\int_0^{${i}} t^2\\,dt = \\frac{${i}^3}{3}`,
        '$$',
        ''
      );
    }
    const doc = lines.join('\n');
    const state = EditorState.create({ doc, extensions: [markdownLang] });
    const tree = ensureSyntaxTree(state, state.doc.length, 120_000);
    if (!tree) throw new Error('解析超时');
    const from = state.doc.line(10_000).from;
    const to = state.doc.line(10_080).to;

    const begin = performance.now();
    const ranges = buildBlockDecorations(
      state,
      tree,
      collectTopLevelBlocks(tree, from, to),
      from,
      to,
      { filePath: null }
    );
    const buildMs = performance.now() - begin;

    const maths = ranges
      .map((range) => (range.value.spec as { widget?: unknown }).widget)
      .filter((widget): widget is MathWidget => widget instanceof MathWidget);
    expect(maths.length).toBeGreaterThan(40);
    const renderBegin = performance.now();
    for (const widget of maths) expect(renderMath(widget.source, widget.display).ok).toBe(true);
    const coldRenderMs = performance.now() - renderBegin;
    const warmBegin = performance.now();
    for (const widget of maths) renderMath(widget.source, widget.display);
    const warmRenderMs = performance.now() - warmBegin;
    console.info(
      `[live-preview perf] math-heavy: ${maths.length} formulas/viewport, ` +
        `build=${buildMs.toFixed(2)}ms, katex cold=${coldRenderMs.toFixed(2)}ms, ` +
        `cached=${warmRenderMs.toFixed(2)}ms`
    );
    expect(buildMs).toBeLessThan(16);
    expect(warmRenderMs).toBeLessThan(5);
    expect(coldRenderMs).toBeLessThan(1_000);
  }, 120_000);
});

describe('实时渲染主题：宽公式 / 宽表格不撑宽正文', () => {
  it('展示公式与表格带 contain: inline-size（不可断行的 MathML 不参与 .cm-content 最小宽度）', async () => {
    const { livePreviewTheme } = await import('@/render/components/TextEditor/live-preview/theme');
    const view = new EditorView({
      state: EditorState.create({ extensions: [livePreviewTheme] }),
      parent: document.body,
    });
    const css = [
      ...Array.from(document.querySelectorAll('style')).map((s) => s.textContent ?? ''),
      ...(document.adoptedStyleSheets ?? []).flatMap((sheet) =>
        Array.from(sheet.cssRules).map((rule) => rule.cssText)
      ),
    ].join('\n');
    view.destroy();
    for (const cls of ['cm-lp-math-display', 'cm-lp-table']) {
      const rule = new RegExp(`\\.${cls}\\s*\\{[^}]*\\}`).exec(css)?.[0] ?? '';
      expect(rule, cls).toMatch(/contain:\s*inline-size/);
      expect(rule, cls).toMatch(/overflow-x:\s*auto/);
    }
  });
});
