// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { markdownLivePreview } from '@/render/components/TextEditor/live-preview';
import { mathMarkdownSyntax } from '@/render/components/TextEditor/live-preview/math-syntax';
import {
  clearRenderCaches,
  loadMathRenderer,
  renderMath,
  setRenderBudgetUnlimitedForTests,
} from '@/render/components/TextEditor/live-preview/render-cache';

// These tests exercise synchronous rendering after the formula dependency is available.
beforeAll(() => loadMathRenderer());

/** 示例作品集根目录的复杂公式演示（项目说明文档） */
const DEMO = readFileSync(path.resolve(__dirname, '../../../../sample-data/公式示例.md'), 'utf-8');
/** 唯一一条故意写错的公式 */
const BROKEN_SOURCE = '\\sqrt{x^2 + y^2';

const markdownLang = markdown({ base: markdownLanguage, extensions: [mathMarkdownSyntax] });

interface Formula {
  source: string;
  display: boolean;
}

/** 用编辑器同一套语法（GFM + math-syntax）找出全部公式，取源码的方式与实时预览一致 */
function collectFormulas(doc: string): Formula[] {
  const state = EditorState.create({ doc, extensions: [markdownLang] });
  const tree = ensureSyntaxTree(state, doc.length, 5_000);
  if (!tree) throw new Error('语法树解析超时');
  const formulas: Formula[] = [];
  tree.iterate({
    enter: (node) => {
      if (node.name !== 'InlineMath' && node.name !== 'BlockMath') return;
      const display = node.name === 'BlockMath';
      const marks = node.node.getChildren(display ? 'BlockMathMark' : 'InlineMathMark');
      if (marks.length < 2) throw new Error(`公式未闭合：${doc.slice(node.from, node.to)}`);
      const raw = state.doc.sliceString(marks[0].to, marks[marks.length - 1].from);
      formulas.push({ source: display ? raw.trim() : raw, display });
      return false;
    },
  });
  return formulas;
}

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
  document.body.innerHTML = '';
  setRenderBudgetUnlimitedForTests(false);
});

describe('公式示例.md（复杂 LaTeX 演示）', () => {
  it('覆盖对齐、矩阵、分段、求和积分极限、中文 \\text、嵌套上下标、\\mathbb / \\mathcal、化学式', () => {
    for (const snippet of [
      '\\begin{aligned}',
      '\\begin{pmatrix}',
      '\\begin{bmatrix}',
      '\\begin{vmatrix}',
      '\\begin{cases}',
      '\\frac',
      '\\sum',
      '\\int',
      '\\lim',
      '\\text{攻击力}',
      'x_{i_{j_k}}^{2^{n}}',
      '\\mathbb{R}',
      '\\mathcal{L}',
      '\\xrightarrow',
    ]) {
      expect(DEMO, snippet).toContain(snippet);
    }
  });

  it('除故意写错的那一条外，每条公式都能被 KaTeX 渲染', () => {
    clearRenderCaches();
    const formulas = collectFormulas(DEMO);
    expect(formulas.filter((f) => f.display).length).toBeGreaterThanOrEqual(10);
    expect(formulas.filter((f) => !f.display).length).toBeGreaterThanOrEqual(5);

    const failures = formulas
      .map((formula) => ({ formula, result: renderMath(formula.source, formula.display) }))
      .filter(({ result }) => !result.ok);
    expect(failures.map(({ formula }) => formula.source)).toEqual([BROKEN_SOURCE]);
    // 正常公式输出 MathML（实时预览不依赖 KaTeX 全局 CSS / 字体）
    const ok = renderMath(formulas[0].source, formulas[0].display);
    expect(ok.ok && ok.html.includes('<math')).toBe(true);
  });

  it('在编辑器中就地渲染，只有一个错误标记', () => {
    clearRenderCaches();
    // 机器繁忙（全量测试 + 覆盖率）时一条 KaTeX 渲染就会超过 8ms 帧预算，后续公式被推迟到下一帧；
    // 这里断言的是「同步构建后的结果」，因此关闭预算让结果与耗时无关
    setRenderBudgetUnlimitedForTests(true);
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    view = new EditorView({
      state: EditorState.create({
        doc: DEMO,
        // 光标放在标题行：其余公式都处于渲染状态
        selection: { anchor: 0 },
        extensions: [markdownLang, markdownLivePreview({ filePath: '/书/公式示例.md' })],
      }),
      parent,
    });
    const content = view.contentDOM;
    const rendered = content.querySelectorAll(
      '.cm-lp-math-display .katex, .cm-lp-math-display math'
    );
    expect(rendered.length).toBeGreaterThan(0);
    const markers = content.querySelectorAll('.cm-lp-error-marker');
    // happy-dom 只渲染首屏附近；坏公式在文末，未渲染时为 0，渲染时必须恰好 1 个
    expect(markers.length).toBeLessThanOrEqual(1);
  });
});
