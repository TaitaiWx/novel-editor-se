// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  appliedLineMarkerField,
  buildThousandCharDecorationSet,
  createActiveLineExtensions,
  createLineNumberExtension,
  createThousandCharMarkerExtension,
  createWordWrapExtension,
  focusLineDecorations,
  setAppliedLineMarkerEffect,
  setTransientLineHighlightEffect,
  ThousandCharMarkerWidget,
  transientLineHighlightField,
} from '@/render/components/TextEditor/editor-extensions';

const countRanges = (set: { iter: () => { value: unknown; next: () => void } }) => {
  let count = 0;
  for (const cursor = set.iter(); cursor.value; cursor.next()) count += 1;
  return count;
};

describe('TextEditor editor-extensions', () => {
  it('行号扩展：专注模式或关闭时为空，开启时包含行号与"已应用"列', () => {
    expect(createLineNumberExtension(true, true)).toEqual([]);
    expect(createLineNumberExtension(false, false)).toEqual([]);
    expect(createLineNumberExtension(false, true)).toHaveLength(2);
  });

  it('当前行扩展：显示行号时额外高亮行号槽', () => {
    expect(createActiveLineExtensions(false)).toHaveLength(1);
    expect(createActiveLineExtensions(true)).toHaveLength(2);
  });

  it('换行扩展：wordWrap 或专注模式任一开启即换行', () => {
    expect(createWordWrapExtension(true, false)).toBe(EditorView.lineWrapping);
    expect(createWordWrapExtension(false, true)).toBe(EditorView.lineWrapping);
    expect(createWordWrapExtension(false, false)).toEqual([]);
  });

  it('专注模式关闭时不注入插件', () => {
    expect(focusLineDecorations(false)).toEqual([]);
    expect(focusLineDecorations(true)).toBeTruthy();
  });

  it('千字标记：关闭或专注模式时为空，开启时按字数生成装饰', () => {
    expect(createThousandCharMarkerExtension(false, false, 1000)).toEqual([]);
    expect(createThousandCharMarkerExtension(true, true, 1000)).toEqual([]);

    const doc = `${'字'.repeat(600)}\n${'字'.repeat(600)}\n${'字'.repeat(900)}`;
    const state = EditorState.create({ doc });
    expect(countRanges(buildThousandCharDecorationSet(state, 1000))).toBeGreaterThan(0);
    expect(
      countRanges(buildThousandCharDecorationSet(EditorState.create({ doc: '短' }), 1000))
    ).toBe(0);

    const withField = EditorState.create({
      doc,
      extensions: createThousandCharMarkerExtension(true, false, 1000),
    });
    expect(withField.doc.length).toBe(doc.length);
  });

  it('千字标记 widget 渲染与比较', () => {
    const widget = new ThousandCharMarkerWidget(2000);
    expect(widget.eq(new ThousandCharMarkerWidget(2000))).toBe(true);
    expect(widget.eq(new ThousandCharMarkerWidget(1000))).toBe(false);
    const dom = widget.toDOM();
    expect(dom.textContent).toBe('2000字');
    expect(dom.className).toBe('cm-thousand-char-marker-inline');
    expect(widget.ignoreEvent()).toBe(true);
  });

  it('临时高亮字段响应 effect，并可清除', () => {
    let state = EditorState.create({ doc: 'a\nb\nc', extensions: transientLineHighlightField });
    state = state.update({ effects: setTransientLineHighlightEffect.of(2) }).state;
    expect(countRanges(state.field(transientLineHighlightField))).toBe(1);
    state = state.update({ effects: setTransientLineHighlightEffect.of(null) }).state;
    expect(countRanges(state.field(transientLineHighlightField))).toBe(0);
  });

  it('"已应用"行标记字段响应 effect，并随文档变更映射位置', () => {
    let state = EditorState.create({ doc: 'a\nb', extensions: appliedLineMarkerField });
    state = state.update({ effects: setAppliedLineMarkerEffect.of(2) }).state;
    const first = state.field(appliedLineMarkerField).iter();
    expect(first.from).toBe(2);
    state = state.update({ changes: { from: 0, insert: 'xx' } }).state;
    expect(state.field(appliedLineMarkerField).iter().from).toBe(4);
    state = state.update({ effects: setAppliedLineMarkerEffect.of(null) }).state;
    expect(state.field(appliedLineMarkerField).size).toBe(0);
  });
});
