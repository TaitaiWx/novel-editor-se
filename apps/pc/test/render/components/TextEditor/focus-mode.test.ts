// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, Text } from '@codemirror/state';
import { EditorView, type DecorationSet } from '@codemirror/view';
import {
  FOCUS_OPACITY,
  buildFocusDecorations,
  computeFocusDistances,
  focusDistanceForLines,
  focusLineDecorations,
  tagBlockWidgets,
} from '@/render/components/TextEditor/focus-mode';

const doc = (lines: string[]) => Text.of(lines);

/** 装饰集合 → 行号 → class */
function classesByLine(state: EditorState, set: DecorationSet): Map<number, string> {
  const result = new Map<number, string>();
  const iter = set.iter();
  while (iter.value) {
    const spec = iter.value.spec as { class?: string };
    result.set(state.doc.lineAt(iter.from).number, spec.class ?? '');
    iter.next();
  }
  return result;
}

const stateAt = (lines: string[], lineNumber: number, column = 0) => {
  const text = doc(lines);
  return EditorState.create({
    doc: text,
    selection: { anchor: text.line(lineNumber).from + column },
  });
};

const PARAGRAPHS = Array.from({ length: 12 }, (_, i) => `第${i + 1}段`);

describe('computeFocusDistances', () => {
  it('光标行为 0，上下各 3 个非空行依次为 1 / 2 / 3', () => {
    const text = doc(PARAGRAPHS);
    const distances = computeFocusDistances(text, text.line(6).from);
    expect([...distances.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [3, 3],
      [4, 2],
      [5, 1],
      [6, 0],
      [7, 1],
      [8, 2],
      [9, 3],
    ]);
  });

  it('段落之间的空行不计入距离', () => {
    const text = doc(['甲', '', '乙', '', '丙', '', '丁', '', '戊']);
    const distances = computeFocusDistances(text, text.line(1).from);
    expect(distances.get(1)).toBe(0);
    expect(distances.get(3)).toBe(1);
    expect(distances.get(5)).toBe(2);
    expect(distances.get(7)).toBe(3);
    expect(distances.has(2)).toBe(false);
    expect(distances.has(9)).toBe(false);
  });

  it('文档开头 / 结尾不越界', () => {
    const text = doc(['一', '二']);
    expect([...computeFocusDistances(text, 0).entries()]).toEqual([
      [1, 0],
      [2, 1],
    ]);
    expect(computeFocusDistances(text, text.length).get(2)).toBe(0);
  });
});

describe('buildFocusDecorations', () => {
  it('按距离分档装饰，最远一档不加装饰（由 CSS 默认值处理）', () => {
    const state = stateAt(PARAGRAPHS, 6);
    const classes = classesByLine(
      state,
      buildFocusDecorations(state, [{ from: 0, to: state.doc.length }])
    );
    expect(classes.get(6)).toBe('cm-focus-d0');
    expect(classes.get(5)).toBe('cm-focus-d1');
    expect(classes.get(7)).toBe('cm-focus-d1');
    expect(classes.get(4)).toBe('cm-focus-d2');
    expect(classes.get(9)).toBe('cm-focus-d3');
    expect(classes.has(2)).toBe(false);
    expect(classes.has(10)).toBe(false);
    expect(classes.size).toBe(7);
  });

  it('只装饰可见范围内的行', () => {
    const state = stateAt(PARAGRAPHS, 6);
    // 可见范围只覆盖第 6~7 行
    const visible = { from: state.doc.line(6).from, to: state.doc.line(7).to };
    const classes = classesByLine(state, buildFocusDecorations(state, [visible]));
    expect([...classes.keys()].sort((a, b) => a - b)).toEqual([6, 7]);
  });

  it('光标不在可见范围内时不产生装饰', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `段落${i}`);
    const state = stateAt(lines, 150);
    const visible = { from: 0, to: state.doc.line(20).to };
    expect(buildFocusDecorations(state, [visible]).size).toBe(0);
  });

  it('折行的长段落是一个整体：光标在段落中间时整段为当前档，相邻段落为 1 档', () => {
    const long = '很长的一段话'.repeat(200);
    const lines = ['上一段', long, '下一段', '再下一段'];
    const state = stateAt(lines, 2, Math.floor(long.length / 2));
    const classes = classesByLine(
      state,
      buildFocusDecorations(state, [{ from: 0, to: state.doc.length }])
    );
    expect(classes.get(2)).toBe('cm-focus-d0');
    expect(classes.get(1)).toBe('cm-focus-d1');
    expect(classes.get(3)).toBe('cm-focus-d1');
    expect(classes.get(4)).toBe('cm-focus-d2');
  });
});

describe('focusDistanceForLines', () => {
  it('取区间内最近的距离，区间不含附近行时返回 null', () => {
    const distances = new Map([
      [5, 0],
      [6, 1],
      [7, 2],
    ]);
    expect(focusDistanceForLines(distances, 6, 9)).toBe(1);
    expect(focusDistanceForLines(distances, 1, 10)).toBe(0);
    expect(focusDistanceForLines(distances, 8, 12)).toBeNull();
  });
});

describe('focusLineDecorations（挂载到 EditorView）', () => {
  let view: EditorView | null = null;
  afterEach(() => {
    view?.destroy();
    view = null;
    document.body.innerHTML = '';
  });

  it('未开启时不添加任何扩展', () => {
    expect(focusLineDecorations(false)).toEqual([]);
  });

  it('开启后编辑器带 cm-focus-mode，光标行与邻近行带分档 class，且没有模糊', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const text = PARAGRAPHS.join('\n');
    view = new EditorView({
      state: EditorState.create({
        doc: text,
        selection: { anchor: doc(PARAGRAPHS).line(3).from },
        extensions: [focusLineDecorations(true)],
      }),
      parent,
    });
    expect(view.dom.classList.contains('cm-focus-mode')).toBe(true);
    const lines = Array.from(view.contentDOM.querySelectorAll('.cm-line'));
    expect(lines[2].classList.contains('cm-focus-d0')).toBe(true);
    expect(lines[3].classList.contains('cm-focus-d1')).toBe(true);
    expect(lines[0].classList.contains('cm-focus-d2')).toBe(true);
    expect(lines[10].className).not.toMatch(/cm-focus-d/);
    expect(document.head.innerHTML).not.toMatch(/cm-focus[^{]*\{[^}]*blur/);

    // 移动光标后重新分档
    view.dispatch({ selection: { anchor: view.state.doc.line(11).from } });
    const after = Array.from(view.contentDOM.querySelectorAll('.cm-line'));
    expect(after[10].classList.contains('cm-focus-d0')).toBe(true);
    expect(after[2].className).not.toMatch(/cm-focus-d/);
  });

  it('块级部件（非 .cm-line）按覆盖的行打上 data-focus-distance', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    view = new EditorView({
      state: EditorState.create({
        doc: PARAGRAPHS.join('\n'),
        selection: { anchor: doc(PARAGRAPHS).line(2).from },
        extensions: [focusLineDecorations(true)],
      }),
      parent,
    });
    const widget = document.createElement('div');
    const far = document.createElement('div');
    view.contentDOM.appendChild(widget);
    view.contentDOM.appendChild(far);
    const current = view;
    const original = current.posAtDOM.bind(current);
    current.posAtDOM = (node: Node, offset?: number) =>
      node === widget
        ? current.state.doc.line(3).from
        : node === far
          ? current.state.doc.line(10).from
          : original(node, offset);
    tagBlockWidgets(current);
    expect(widget.dataset.focusDistance).toBe('1');
    expect(far.dataset.focusDistance).toBeUndefined();
  });

  it('分档透明度：邻近 ≥ 0.6，远处仍可读（0.25~0.4），整体单调递减', () => {
    expect(FOCUS_OPACITY[0]).toBe(1);
    expect(FOCUS_OPACITY[1]).toBeGreaterThanOrEqual(0.6);
    expect(FOCUS_OPACITY[2]).toBeGreaterThanOrEqual(0.6);
    expect(FOCUS_OPACITY.far).toBeGreaterThanOrEqual(0.25);
    expect(FOCUS_OPACITY.far).toBeLessThanOrEqual(0.4);
    const ordered = [
      FOCUS_OPACITY[0],
      FOCUS_OPACITY[1],
      FOCUS_OPACITY[2],
      FOCUS_OPACITY[3],
      FOCUS_OPACITY.far,
    ];
    expect([...ordered].sort((a, b) => b - a)).toEqual(ordered);
  });
});
