// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { EditorView } from '@codemirror/view';
import { useActiveEditorRegistration } from '@/render/components/TextEditor/hooks/useActiveEditorRegistration';
import {
  discardDeletedEditorFiles,
  getActiveEditor,
} from '@/render/components/TextEditor/active-editor';

vi.mock('@codemirror/search', () => ({ openSearchPanel: vi.fn() }));

function setup(filePath: string) {
  const container = document.createElement('div');
  const input = document.createElement('textarea');
  container.appendChild(input);
  document.body.appendChild(container);
  const view = { focus: vi.fn() } as unknown as EditorView;
  const save = vi.fn();
  const hook = renderHook(() =>
    useActiveEditorRegistration({
      editorContainerRef: { current: container },
      viewRef: { current: view },
      currentFilePathRef: { current: filePath },
      currentContentRef: { current: `${filePath} 内容` },
      currentOriginalContentRef: { current: 'original' },
      autoSaveTimeoutRef: { current: null },
      setHasChanges: vi.fn(),
      readOnlyRef: { current: false },
      handleManualSaveRef: { current: save },
    })
  );
  return { ...hook, input, view, save };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useActiveEditorRegistration', () => {
  it('文件删除后立即停止该编辑器保存资格，其他文档不受影响', () => {
    const a = setup('/w/a.md');
    const b = setup('/w/b.md');
    const bHandle = getActiveEditor()!;
    discardDeletedEditorFiles((path) => path === '/w/b.md');
    expect(bHandle.getSnapshot()).toEqual({ filePath: null, content: '', readOnly: false });
    expect(getActiveEditor()?.getSnapshot().filePath).toBe('/w/a.md');
    a.unmount();
    b.unmount();
  });

  it('挂载登记、聚焦切换目标、卸载移除', async () => {
    const a = setup('/w/a.md');
    const b = setup('/w/b.md');
    expect(getActiveEditor()?.getSnapshot().filePath).toBe('/w/b.md');

    a.input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    const active = getActiveEditor();
    expect(active?.getSnapshot()).toEqual({
      filePath: '/w/a.md',
      content: '/w/a.md 内容',
      readOnly: false,
    });
    active?.save();
    expect(a.save).toHaveBeenCalledOnce();

    active?.openSearch();
    expect(a.view.focus).toHaveBeenCalledOnce();
    const { openSearchPanel } = await import('@codemirror/search');
    await vi.waitFor(() => expect(openSearchPanel).toHaveBeenCalledWith(a.view));

    a.unmount();
    expect(getActiveEditor()?.getSnapshot().filePath).toBe('/w/b.md');
    b.unmount();
    expect(getActiveEditor()).toBeNull();
  });
});
