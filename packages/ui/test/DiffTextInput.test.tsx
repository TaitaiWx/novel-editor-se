// @vitest-environment happy-dom
import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { undo, redo } from '@codemirror/commands';
import DiffTextInput from '@novel-editor/ui/DiffTextInput';
import { editorText, editorView, replaceEditorText } from './support/codeMirror';

function Controlled(props: Partial<React.ComponentProps<typeof DiffTextInput>>) {
  const [value, setValue] = useState(props.value ?? '旧称呼');
  return <DiffTextInput aria-label="人物字段" {...props} value={value} onChange={setValue} />;
}

describe('DiffTextInput real editor', () => {
  it('renders deletions visually while edits, selected text and undo contain only the current value', () => {
    const { container } = render(<Controlled baseline="旧称呼" />);
    const input = screen.getByRole('textbox');
    replaceEditorText(input, '新称呼');
    expect(container.querySelector('del')?.textContent).toBe('旧');
    expect(container.querySelector('.diff-text-added')?.textContent).toBe('新');
    expect(editorText(input)).toBe('新称呼');
    const view = editorView(input);
    act(() => view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }));
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      '新称呼'
    );
    act(() => {
      undo(view);
    });
    expect(editorText(input)).toBe('旧称呼');
    act(() => {
      redo(view);
    });
    expect(editorText(input)).toBe('新称呼');
  });

  it('external refreshes update value and diff without echoing onChange or retaining old decorations', () => {
    const onChange = vi.fn();
    const { rerender, container } = render(
      <DiffTextInput aria-label="字段" value="新" baseline="旧" onChange={onChange} />
    );
    rerender(<DiffTextInput aria-label="字段" value="远端值" onChange={onChange} />);
    expect(editorText(screen.getByRole('textbox'))).toBe('远端值');
    expect(container.querySelector('del')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rejects multiline paste for single-line fields and still lets over-limit existing values shrink', () => {
    render(<Controlled singleLine maxLength={4} value="已有六个字符" />);
    const input = screen.getByRole('textbox');
    replaceEditorText(input, '已有六个字符加长');
    expect(editorText(input)).toBe('已有六个字符');
    replaceEditorText(input, '一\n二');
    expect(editorText(input)).toBe('已有六个字符');
    replaceEditorText(input, '缩短');
    expect(editorText(input)).toBe('缩短');
    replaceEditorText(input, '重新超过四字符');
    expect(editorText(input)).toBe('缩短');
  });

  it('updates disabled accessibility, suppresses key callbacks and forwards blur to the latest owner', () => {
    const oldBlur = vi.fn();
    const newBlur = vi.fn();
    const key = vi.fn();
    const { rerender } = render(
      <DiffTextInput aria-label="字段" value="值" onChange={() => {}} onBlur={oldBlur} />
    );
    rerender(
      <DiffTextInput
        aria-label="新字段"
        value="值"
        disabled
        onChange={() => {}}
        onKeyDown={key}
        onBlur={newBlur}
      />
    );
    const input = screen.getByRole('textbox', { name: '新字段' });
    expect(input.getAttribute('contenteditable')).toBe('false');
    expect(input.getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(key).not.toHaveBeenCalled();
    expect(newBlur).toHaveBeenCalledOnce();
    expect(oldBlur).not.toHaveBeenCalled();
  });
});
