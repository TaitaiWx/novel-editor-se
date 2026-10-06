// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, WidgetType } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { parser as baseParser, GFM } from '@lezer/markdown';
import { mathMarkdownSyntax } from '@/render/components/TextEditor/live-preview/math-syntax';
import {
  buildLivePreviewDecorations,
  collectTopLevelBlocks,
} from '@/render/components/TextEditor/live-preview/build-decorations';
import {
  createLivePreviewField,
  refreshLivePreview,
  setLivePreviewRange,
} from '@/render/components/TextEditor/live-preview/field';
import {
  clearRenderCaches,
  getRenderCacheStats,
  parseTable,
  renderInlineCell,
  renderMath,
  renderTable,
  resetRenderBudgetForTests,
  splitTableRow,
} from '@/render/components/TextEditor/live-preview/render-cache';
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
} from '@/render/components/TextEditor/live-preview/widgets';
import { resolveImageSource } from '@/render/components/TextEditor/live-preview/image-loader';
import { LruCache } from '@/render/components/TextEditor/live-preview/lru';
import { syntaxTree } from '@codemirror/language';

const markdownLang = markdown({ base: markdownLanguage, extensions: [mathMarkdownSyntax] });
const OPTIONS = { filePath: '/书/资料/示例.md' };

function makeState(doc: string, cursor = doc.length, extra: Extension = []) {
  return EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdownLang, extra],
  });
}

interface DecoInfo {
  from: number;
  to: number;
  cls: string;
  widget: WidgetType | null;
  block: boolean;
}

function listDecos(set: DecorationSet): DecoInfo[] {
  const out: DecoInfo[] = [];
  for (const iter = set.iter(); iter.value; iter.next()) {
    const spec = iter.value.spec as {
      class?: string;
      widget?: WidgetType;
      block?: boolean;
      attributes?: Record<string, string>;
    };
    out.push({
      from: iter.from,
      to: iter.to,
      cls: spec.class ?? '',
      widget: spec.widget ?? null,
      block: Boolean(spec.block),
    });
  }
  return out;
}

const build = (state: EditorState, from = 0, to = state.doc.length) =>
  listDecos(buildLivePreviewDecorations(state, from, to, OPTIONS));

const isHide = (d: DecoInfo) => !d.widget && !d.cls && d.to > d.from;
const widgetsOf = <T extends WidgetType>(decos: DecoInfo[], type: new (...args: never[]) => T) =>
  decos.filter((d) => d.widget instanceof type) as (DecoInfo & { widget: T })[];

/**
 * 立即渲染 widget：先清空渲染预算，避免覆盖率插桩下 KaTeX 冷启动耗尽预算、
 * 后续 widget 被推迟到下一帧（只渲染占位）导致断言不稳定
 */
function renderNow(widget: WidgetType | undefined): HTMLElement {
  resetRenderBudgetForTests();
  return widget?.toDOM() as HTMLElement;
}

beforeEach(() => {
  clearRenderCaches();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('数学公式语法', () => {
  const parser = baseParser.configure([GFM, mathMarkdownSyntax]);
  const names = (doc: string) => {
    const result: string[] = [];
    parser.parse(doc).iterate({ enter: (node) => void result.push(node.name) });
    return result;
  };

  it('识别行内与块级公式，普通美元金额不误判', () => {
    expect(names('质能 $E=mc^2$ 方程')).toContain('InlineMath');
    expect(names('价格 $5 和 $10')).not.toContain('InlineMath');
    expect(names('转义 \\$x$')).not.toContain('InlineMath');
    expect(names('行内 $$x$$ 也行')).toContain('InlineMath');
    expect(names('$$\na+b\n$$')).toContain('BlockMath');
    expect(names('$$ a+b $$')).toContain('BlockMath');
  });

  it('未闭合的公式块在空行处结束，不吞掉后面的内容', () => {
    const doc = '$$\n\\frac{a}{\n\n# 后面的标题';
    const tree = parser.parse(doc);
    const top: string[] = [];
    const cursor = tree.cursor();
    cursor.firstChild();
    do top.push(cursor.name);
    while (cursor.nextSibling());
    expect(top).toEqual(['BlockMath', 'ATXHeading1']);
  });
});

describe('标题与行内语法：光标外渲染、光标处显示源码', () => {
  const doc = '# 标题\n\n**粗体** *斜体* ~~删除~~ `代码`\n\n末尾';

  it('光标不在行内时隐藏 # 与强调标记，并加上样式', () => {
    const decos = build(makeState(doc));
    expect(decos.some((d) => d.cls.includes('cm-lp-h1') && d.from === 0)).toBe(true);
    expect(decos.some((d) => isHide(d) && d.from === 0 && d.to === 2)).toBe(true);
    const line2 = doc.indexOf('**');
    expect(decos.some((d) => isHide(d) && d.from === line2 && d.to === line2 + 2)).toBe(true);
    for (const cls of ['cm-lp-strong', 'cm-lp-em', 'cm-lp-strike', 'cm-lp-code']) {
      expect(decos.some((d) => d.cls === cls)).toBe(true);
    }
  });

  it('光标移到标题行时显示 #（淡色），不再隐藏', () => {
    const decos = build(makeState(doc, 3));
    expect(decos.some((d) => isHide(d) && d.from === 0)).toBe(false);
    expect(decos.some((d) => d.cls === 'cm-lp-syntax' && d.from === 0)).toBe(true);
    // 标题样式保留
    expect(decos.some((d) => d.cls.includes('cm-lp-h1'))).toBe(true);
  });

  it('链接只显示文字并带上地址；图片渲染为 widget 并按文件目录解析相对路径', () => {
    const md = '[官网](https://example.com) ![封面](../素材/cover.png)\n\n末尾';
    const decos = build(makeState(md));
    const link = listDecos(buildLivePreviewDecorations(makeState(md), 0, md.length, OPTIONS));
    expect(link.some((d) => d.cls === 'cm-lp-link')).toBe(true);
    const images = widgetsOf(decos, ImageWidget);
    expect(images).toHaveLength(1);
    expect(images[0].widget.src).toBe('/书/素材/cover.png');
    expect(images[0].widget.alt).toBe('封面');
  });

  it('列表圆点、任务复选框、引用与分割线', () => {
    const md = '- 项目\n- [x] 完成\n- [ ] 待办\n\n> 引用\n\n---\n\n末尾';
    const decos = build(makeState(md));
    expect(widgetsOf(decos, BulletWidget)).toHaveLength(1);
    const boxes = widgetsOf(decos, CheckboxWidget);
    expect(boxes.map((d) => d.widget.checked)).toEqual([true, false]);
    expect(decos.some((d) => d.cls === 'cm-lp-task-done')).toBe(true);
    expect(decos.some((d) => d.cls === 'cm-lp-quote')).toBe(true);
    expect(widgetsOf(decos, HrWidget)).toHaveLength(1);
  });

  it('代码块：语言标签替换开头的 ```，光标进入后显示源码', () => {
    const md = '```ts\nconst a = 1;\n```\n\n末尾';
    const decos = build(makeState(md));
    expect(widgetsOf(decos, CodeLangWidget)[0].widget.lang).toBe('ts');
    expect(decos.filter((d) => d.cls.includes('cm-lp-codeblock'))).toHaveLength(3);
    expect(widgetsOf(build(makeState(md, 8)), CodeLangWidget)).toHaveLength(0);
  });
});

describe('公式与表格：渲染、展开与错误隔离', () => {
  const doc = [
    '行内 $E=mc^2$ 公式',
    '',
    '$$',
    '\\int_0^1 x\\,dx',
    '$$',
    '',
    '坏公式 $\\frac{a}{$ 在这',
    '',
    '| 名称 | 数量 |',
    '|---|---:|',
    '| 苹果 | 3 |',
    '',
    '末尾',
  ].join('\n');

  it('公式块渲染为块级 widget，行内公式渲染为行内 widget', () => {
    const maths = widgetsOf(build(makeState(doc)), MathWidget);
    expect(maths.map((d) => d.widget.source)).toEqual(['E=mc^2', '\\int_0^1 x\\,dx', '\\frac{a}{']);
    const display = maths.find((d) => d.widget.display);
    expect(display?.block).toBe(true);
    const dom = renderNow(display?.widget);
    expect(dom?.querySelector('.katex')).not.toBeNull();
  });

  it('坏公式只影响自身：显示原文 + 错误标记，其它公式照常渲染', () => {
    const maths = widgetsOf(build(makeState(doc)), MathWidget);
    const broken = maths.find((d) => d.widget.source === '\\frac{a}{');
    const brokenDom = renderNow(broken?.widget);
    expect(brokenDom.classList.contains('cm-lp-render-error')).toBe(true);
    expect(brokenDom.querySelector('.cm-lp-error-marker')?.getAttribute('title')).toContain(
      '公式错误'
    );
    expect(brokenDom.textContent).toContain('\\frac{a}{');
    const good = maths.find((d) => d.widget.source === 'E=mc^2');
    expect(renderNow(good?.widget).querySelector('.katex')).not.toBeNull();
  });

  it('表格渲染为 widget；光标进入表格时显示源码', () => {
    const tables = widgetsOf(build(makeState(doc)), TableWidget);
    expect(tables).toHaveLength(1);
    const dom = renderNow(tables[0].widget);
    expect(dom.querySelector('table th')?.textContent).toBe('名称');
    expect(dom.querySelector('td[style*="right"]')?.textContent).toBe('3');

    const inside = doc.indexOf('苹果');
    const decos = build(makeState(doc, inside));
    expect(widgetsOf(decos, TableWidget)).toHaveLength(0);
    expect(decos.filter((d) => d.cls === 'cm-lp-table-src')).toHaveLength(3);
  });

  it('列数多于表头的坏表格显示原文与错误标记', () => {
    const bad = '| a | b |\n|---|---|\n| 1 | 2 | 3 |\n\n末尾';
    const tables = widgetsOf(build(makeState(bad)), TableWidget);
    const dom = renderNow(tables[0].widget);
    expect(dom.classList.contains('cm-lp-render-error')).toBe(true);
    expect(dom.querySelector('.cm-lp-error-marker')?.getAttribute('title')).toContain('3 列');
    expect(dom.textContent).toContain('| 1 | 2 | 3 |');
  });

  it('光标在公式块内：显示源码并在下方附实时预览；未闭合的公式块标记错误', () => {
    const inside = doc.indexOf('\\int');
    const decos = build(makeState(doc, inside));
    expect(decos.some((d) => d.cls === 'cm-lp-math-src')).toBe(true);
    expect(widgetsOf(decos, MathPreviewWidget)).toHaveLength(1);

    const unclosed = '$$\n\\frac{1}{2}\n\n后文 $x$ 照常\n\n末尾';
    const unclosedDecos = build(makeState(unclosed));
    expect(widgetsOf(unclosedDecos, ErrorMarkerWidget)[0].widget.kind).toBe('公式块未闭合');
    expect(widgetsOf(unclosedDecos, MathWidget).map((d) => d.widget.source)).toEqual(['x']);
  });

  it('单个块构建抛错时只退回该块的原文', () => {
    const original = Decoration.replace;
    vi.spyOn(Decoration, 'replace').mockImplementation((spec) => {
      if (spec.widget instanceof TableWidget) throw new Error('boom');
      return original.call(Decoration, spec);
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const decos = build(makeState(doc));
    expect(widgetsOf(decos, TableWidget)).toHaveLength(0);
    expect(widgetsOf(decos, MathWidget).length).toBeGreaterThan(0);
  });
});

describe('只构建可见范围', () => {
  it('范围外的块不生成装饰', () => {
    const doc = Array.from({ length: 500 }, (_, i) => `# 标题 ${i}\n\n正文 $x_${i}$`).join('\n\n');
    const state = makeState(doc, 0);
    const to = doc.indexOf('# 标题 10');
    const decos = build(state, 0, to);
    expect(decos.every((d) => d.from <= to + 20)).toBe(true);
    expect(collectTopLevelBlocks(syntaxTree(state), 0, to).length).toBeLessThan(25);
  });
});

describe('渲染缓存与 widget 比较', () => {
  it('相同源码命中缓存', () => {
    renderMath('a^2', false);
    renderMath('a^2', false);
    renderTable('| a |\n|---|\n| 1 |');
    renderTable('| a |\n|---|\n| 1 |');
    const stats = getRenderCacheStats();
    expect(stats.math.hits).toBeGreaterThanOrEqual(1);
    expect(stats.table.hits).toBe(1);
    expect(renderMath('', true)).toEqual({ ok: false, error: '公式为空' });
  });

  it('LRU 超出容量淘汰最旧项', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    cache.delete('a');
    expect(cache.size).toBe(1);
  });

  it('widget eq：内容相同复用 DOM，不同则重建', () => {
    expect(new MathWidget('x', false).eq(new MathWidget('x', false))).toBe(true);
    expect(new MathWidget('x', false).eq(new MathWidget('x', true))).toBe(false);
    expect(new MathPreviewWidget('x').eq(new MathWidget('x', true))).toBe(false);
    expect(new TableWidget('a').eq(new TableWidget('a'))).toBe(true);
    expect(new TableWidget('a').eq(new TableWidget('b'))).toBe(false);
    expect(new ImageWidget('/a.png', 'a').eq(new ImageWidget('/a.png', 'a'))).toBe(true);
    expect(new CheckboxWidget(true).eq(new CheckboxWidget(false))).toBe(false);
    expect(new CodeLangWidget('ts').eq(new CodeLangWidget('ts'))).toBe(true);
    expect(new ErrorMarkerWidget('a', 'b').eq(new ErrorMarkerWidget('a', 'c'))).toBe(false);
    expect(new BulletWidget().eq()).toBe(true);
    expect(new HrWidget().toDOM().getAttribute('role')).toBe('separator');
  });

  it('表格解析：转义竖线、代码中的竖线、对齐与补齐', () => {
    expect(splitTableRow('| a \\| b | `x|y` | c |')).toEqual(['a | b', '`x|y`', 'c']);
    const table = parseTable('| a | b | c |\n|:--|:-:|--:|\n| 1 |');
    expect(table.align).toEqual(['left', 'center', 'right']);
    expect(table.rows[0]).toEqual(['1', '', '']);
    expect(() => parseTable('| a |\n| b |')).toThrow('分隔行');
    expect(renderInlineCell('**粗** `c` ~~d~~ *e* <b>')).toBe(
      '<strong>粗</strong> <code>c</code> <del>d</del> <em>e</em> &lt;b&gt;'
    );
    expect(renderInlineCell('$\\frac{a}{$')).toContain('cm-lp-render-error');
  });

  it('图片路径解析', () => {
    expect(resolveImageSource('https://a.com/x.png', '/a/b.md')).toBe('https://a.com/x.png');
    expect(resolveImageSource('img/x.png', '/a/b.md')).toBe('/a/img/x.png');
    expect(resolveImageSource('./%E5%9B%BE.png', '/a/b.md')).toBe('/a/图.png');
    expect(resolveImageSource('/abs/x.png', '/a/b.md')).toBe('/abs/x.png');
    expect(resolveImageSource('file:///abs/x.png', null)).toBe('/abs/x.png');
    expect(resolveImageSource('..\\x.png', 'C:\\书\\章\\a.md')).toBe('C:\\书\\x.png');
  });
});

describe('状态字段：增量更新', () => {
  const doc = '# 标题\n\n段落 $a$ 文本\n\n$$\nb^2\n$$\n\n末尾';

  function fieldState(cursor: number) {
    const field = createLivePreviewField(OPTIONS);
    const state = makeState(doc, cursor, field);
    return { field, state };
  }

  const widgetOf = (set: DecorationSet, source: string) =>
    listDecos(set).find((d) => d.widget instanceof MathWidget && d.widget.source === source)
      ?.widget;

  it('移动光标只重建相关块，其它块的 widget 原样保留', () => {
    const { field, state } = fieldState(doc.length);
    const before = state.field(field).decorations;
    const next = state.update({ selection: { anchor: 2 } }).state;
    const after = next.field(field).decorations;
    expect(listDecos(after).some((d) => isHide(d) && d.from === 0)).toBe(false);
    expect(widgetOf(after, 'b^2')).toBe(widgetOf(before, 'b^2'));
    expect(widgetOf(after, 'a')).toBe(widgetOf(before, 'a'));
  });

  it('编辑文本时未受影响的块沿用映射后的装饰', () => {
    const { field, state } = fieldState(doc.length);
    const before = state.field(field).decorations;
    const tr = state.update({ changes: { from: doc.length, insert: '追加' } });
    const after = tr.state.field(field).decorations;
    expect(widgetOf(after, 'b^2')).toBe(widgetOf(before, 'b^2'));
    // 在公式块前插入文字后，公式块位置正确映射
    const shifted = state.update({ changes: { from: 0, insert: '前言\n\n' } }).state;
    const display = listDecos(shifted.field(field).decorations).find(
      (d) => d.widget instanceof MathWidget && d.widget.display
    );
    expect(shifted.doc.sliceString(display?.from ?? 0, display?.to ?? 0)).toBe('$$\nb^2\n$$');
  });

  it('IME 组字期间只映射不重建，刷新 effect 后重建', () => {
    const { field, state } = fieldState(doc.length);
    const composing = state.update({
      changes: { from: 0, insert: '前' },
      userEvent: 'input.type.compose',
    }).state;
    const mapped = composing.field(field);
    expect(mapped.decorations).not.toBe(state.field(field).decorations);
    const refreshed = composing.update({ effects: refreshLivePreview.of(null) }).state;
    expect(refreshed.field(field).decorations).not.toBe(mapped.decorations);
  });

  it('范围 effect 只构建指定范围', () => {
    const { field, state } = fieldState(doc.length);
    const narrowed = state.update({ effects: setLivePreviewRange.of({ from: 0, to: 4 }) }).state;
    const value = narrowed.field(field);
    expect(value.range).toEqual({ from: 0, to: 4 });
    expect(listDecos(value.decorations).every((d) => d.to <= 6)).toBe(true);
  });
});
