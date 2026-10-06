// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { insertTextAtCursor, useInspirationDialog } from '@/render/hooks/useInspirationDialog';
import { requestOpenInspiration } from '@/render/components/InspirationDialog/inspiration';

function createView(doc: string, cursor: number) {
  return new EditorView({
    state: EditorState.create({ doc, selection: { anchor: cursor } }),
    parent: document.body,
  });
}

describe('insertTextAtCursor', () => {
  it('在光标处插入并返回 true；没有编辑器或只读时返回 false', () => {
    const view = createView('甲乙', 1);
    expect(insertTextAtCursor(view, '【灵感】')).toBe(true);
    expect(view.state.doc.toString()).toBe('甲【灵感】乙');
    expect(insertTextAtCursor(null, 'x')).toBe(false);
    const readOnly = new EditorView({
      state: EditorState.create({ doc: 'a', extensions: EditorState.readOnly.of(true) }),
      parent: document.body,
    });
    expect(insertTextAtCursor(readOnly, 'x')).toBe(false);
    view.destroy();
    readOnly.destroy();
  });
});

describe('useInspirationDialog', () => {
  it('响应打开请求（可带三签卡 id），关闭后隐藏；插入作用于主编辑器', () => {
    const view = createView('', 0);
    const { result } = renderHook(() => useInspirationDialog({ editorViewRef: { current: view } }));
    expect(result.current.inspirationVisible).toBe(false);
    act(() => requestOpenInspiration({ cardId: 5 }));
    expect(result.current.inspirationVisible).toBe(true);
    expect(result.current.inspirationCardId).toBe(5);
    act(() => result.current.closeInspiration());
    expect(result.current.inspirationVisible).toBe(false);
    act(() => requestOpenInspiration());
    expect(result.current.inspirationCardId).toBeNull();
    expect(result.current.handleInsertInspiration('灵感')).toBe(true);
    expect(view.state.doc.toString()).toBe('灵感');
    view.destroy();
    vi.restoreAllMocks();
  });
});
