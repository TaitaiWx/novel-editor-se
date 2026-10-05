// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useSyncedRef } from '@/render/components/TextEditor/hooks/useSyncedRef';
import { useEditorRuntime } from '@/render/components/TextEditor/hooks/useEditorRuntime';
import { useViewportSnapshots } from '@/render/components/TextEditor/hooks/useViewportSnapshots';
import { AUTO_SAVE_DELAY, useEditorSave } from '@/render/components/TextEditor/hooks/useEditorSave';
import {
  APPLIED_MARKER_DURATION,
  TRANSIENT_HIGHLIGHT_DURATION,
  useEditorRequests,
} from '@/render/components/TextEditor/hooks/useEditorRequests';
import {
  appliedLineMarkerField,
  transientLineHighlightField,
} from '@/render/components/TextEditor/editor-extensions';
import { inlineDiffField } from '@/render/components/TextEditor/inline-diff';

const invoke = vi.fn();

beforeEach(() => {
  invoke.mockReset();
  Object.defineProperty(window, 'electron', {
    value: { ipcRenderer: { invoke } },
    configurable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'electron');
});

function createView(doc: string, extensions: Extension[] = []) {
  return new EditorView({
    state: EditorState.create({ doc, extensions }),
    parent: document.body,
  });
}

const makeRef = <T,>(value: T) => ({ current: value });

describe('useSyncedRef', () => {
  it('在 effect 中同步最新值', () => {
    const { result, rerender } = renderHook(({ value }) => useSyncedRef(value), {
      initialProps: { value: 1 },
    });
    expect(result.current.current).toBe(1);
    rerender({ value: 2 });
    expect(result.current.current).toBe(2);
  });
});

describe('useEditorRuntime', () => {
  it('加载运行时模块', async () => {
    const { result } = renderHook(() => useEditorRuntime());
    await waitFor(() => expect(result.current.editorRuntime).not.toBeNull());
    expect(result.current.editorInitError).toBeNull();
  });
});

describe('useViewportSnapshots', () => {
  it('保存当前文件的光标并回调；恢复时按文档长度截断', () => {
    const view = createView('hello world');
    const onChange = vi.fn();
    const viewRef = makeRef<EditorView | null>(view);
    const currentFilePathRef = makeRef<string | null>('/a.md');
    const { result } = renderHook(() =>
      useViewportSnapshots({
        viewRef,
        currentFilePathRef,
        onViewportSnapshotChange: onChange,
      })
    );

    act(() => {
      view.dispatch({ selection: { anchor: 5, head: 8 } });
      result.current.saveViewportSnapshot();
    });
    expect(onChange).toHaveBeenCalledWith('/a.md', expect.objectContaining({ anchor: 5, head: 8 }));

    act(() => {
      view.dispatch({ selection: { anchor: 0 } });
      result.current.restoreViewportSnapshot('/a.md', 6);
    });
    expect(view.state.selection.main.anchor).toBe(5);
    expect(view.state.selection.main.head).toBe(6);

    // 没有快照时回到文档开头
    act(() => result.current.restoreViewportSnapshot('/b.md', 11));
    expect(view.state.selection.main.head).toBe(0);
    view.destroy();
  });

  it('使用外部传入的快照恢复位置', () => {
    const view = createView('0123456789');
    const { result } = renderHook(() =>
      useViewportSnapshots({
        viewRef: makeRef<EditorView | null>(view),
        currentFilePathRef: makeRef<string | null>(null),
        viewportSnapshots: { '/x.md': { anchor: 3, head: 4, scrollTop: 0, scrollLeft: 0 } },
      })
    );
    act(() => result.current.restoreViewportSnapshot('/x.md', 10));
    expect(view.state.selection.main.anchor).toBe(3);
    // 无路径时不保存
    expect(() => result.current.saveViewportSnapshot()).not.toThrow();
    view.destroy();
  });
});

describe('useEditorSave', () => {
  function setup(
    overrides: {
      path?: string | null;
      content?: string;
      original?: string;
      readOnly?: boolean;
    } = {}
  ) {
    const toast = { success: vi.fn(), error: vi.fn() };
    const onSaveUntitled = vi.fn();
    const refs = {
      currentFilePathRef: makeRef<string | null>(overrides.path ?? '/a.md'),
      currentContentRef: makeRef(overrides.content ?? 'new'),
      currentOriginalContentRef: makeRef(overrides.original ?? 'old'),
      readOnlyRef: makeRef(overrides.readOnly ?? false),
      filePathRef: makeRef<string | null>(overrides.path ?? '/a.md'),
      onSaveUntitledRef: makeRef<typeof onSaveUntitled | undefined>(onSaveUntitled),
      autoSaveTimeoutRef: makeRef<NodeJS.Timeout | null>(null),
    };
    const hook = renderHook(() => useEditorSave({ ...refs, toast }));
    return { ...hook, refs, toast, onSaveUntitled };
  }

  it('防抖自动保存并更新保存状态', async () => {
    vi.useFakeTimers();
    invoke.mockResolvedValue(undefined);
    const { result, refs } = setup();
    act(() => result.current.setHasChanges(true));
    act(() => result.current.scheduleAutoSave());
    act(() => result.current.scheduleAutoSave());
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY);
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('write-file', '/a.md', 'new');
    expect(refs.currentOriginalContentRef.current).toBe('new');
    expect(result.current.hasChanges).toBe(false);
    expect(result.current.lastSaved).toBeInstanceOf(Date);
  });

  it('只读时不安排自动保存', async () => {
    vi.useFakeTimers();
    const { result } = setup({ readOnly: true });
    act(() => result.current.scheduleAutoSave());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY);
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('手动保存：内容未变提示最新，变化则写入并提示成功', async () => {
    invoke.mockResolvedValue(undefined);
    const unchanged = setup({ content: 'same', original: 'same' });
    await act(async () => {
      await unchanged.result.current.handleManualSave();
    });
    expect(unchanged.toast.success).toHaveBeenCalledWith('文件已是最新状态');
    expect(invoke).not.toHaveBeenCalled();

    const changed = setup();
    await act(async () => {
      await changed.result.current.handleManualSave();
    });
    expect(invoke).toHaveBeenCalledWith('write-file', '/a.md', 'new');
    expect(changed.toast.success).toHaveBeenCalledWith('保存成功');
    expect(changed.result.current.autoSaving).toBe(false);
  });

  it('手动保存失败提示错误', async () => {
    invoke.mockRejectedValue(new Error('disk full'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, toast } = setup();
    await act(async () => {
      await result.current.handleManualSave();
    });
    expect(toast.error).toHaveBeenCalledWith('保存失败');
    errorSpy.mockRestore();
  });

  it('未命名文件交给 onSaveUntitled，更新日志不保存', async () => {
    const untitled = setup({ path: '__untitled__:a.md' });
    await act(async () => {
      await untitled.result.current.handleManualSave();
    });
    expect(untitled.onSaveUntitled).toHaveBeenCalledWith('__untitled__:a.md', 'new');

    const changelog = setup({ path: '__changelog__:x' });
    await act(async () => {
      await changelog.result.current.handleManualSave();
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('handleManualSaveRef 指向最新的保存函数', () => {
    const { result } = setup();
    expect(result.current.handleManualSaveRef.current).toBe(result.current.handleManualSave);
  });
});

describe('useEditorRequests', () => {
  function setup(doc = 'line1\nline2\nline3') {
    const view = createView(doc, [
      transientLineHighlightField,
      appliedLineMarkerField,
      inlineDiffField,
    ]);
    const viewRef = makeRef<EditorView | null>(view);
    const timers = {
      transientHighlightTimerRef: makeRef<number | null>(null),
      appliedLineMarkerTimerRef: makeRef<number | null>(null),
    };
    return { view, viewRef, timers };
  }

  it('跳转到行，同 id 只处理一次', () => {
    const { view, viewRef, timers } = setup();
    const onScrollProcessed = vi.fn();
    const request = { line: 3, id: 'a' };
    const { rerender } = renderHook((props) => useEditorRequests(props), {
      initialProps: { viewRef, ...timers, scrollToLine: request, onScrollProcessed },
    });
    expect(view.state.selection.main.head).toBe(view.state.doc.line(3).from);
    rerender({ viewRef, ...timers, scrollToLine: { ...request }, onScrollProcessed });
    expect(onScrollProcessed).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  it('行尾追加文本，id 需递增', () => {
    const { view, viewRef, timers } = setup();
    const { rerender } = renderHook((props) => useEditorRequests(props), {
      initialProps: { viewRef, ...timers, replaceLineRequest: { line: 1, text: '标题', id: 1 } },
    });
    expect(view.state.doc.line(1).text).toBe('line1 标题');
    rerender({ viewRef, ...timers, replaceLineRequest: { line: 1, text: '重复', id: 1 } });
    expect(view.state.doc.line(1).text).toBe('line1 标题');
    view.destroy();
  });

  it('临时高亮后转为"已应用"标记，再自动清除', () => {
    vi.useFakeTimers();
    const { view, viewRef, timers } = setup();
    const onProcessed = vi.fn();
    renderHook(() =>
      useEditorRequests({
        viewRef,
        ...timers,
        transientHighlightLine: { line: 2, id: 'h1' },
        onTransientHighlightProcessed: onProcessed,
      })
    );
    expect(onProcessed).toHaveBeenCalledTimes(1);
    expect(view.state.field(transientLineHighlightField).size).toBe(1);

    act(() => {
      vi.advanceTimersByTime(TRANSIENT_HIGHLIGHT_DURATION);
    });
    expect(view.state.field(transientLineHighlightField).size).toBe(0);
    expect(view.state.field(appliedLineMarkerField).size).toBe(1);

    act(() => {
      vi.advanceTimersByTime(APPLIED_MARKER_DURATION);
    });
    expect(view.state.field(appliedLineMarkerField).size).toBe(0);
    expect(timers.appliedLineMarkerTimerRef.current).toBeNull();
    view.destroy();
  });

  it('内联 diff 设置与清除', () => {
    const { view, viewRef, timers } = setup();
    const diff = { from: 6, to: 11, oldText: 'line2', newText: '第二行' };
    const { rerender } = renderHook((props) => useEditorRequests(props), {
      initialProps: { viewRef, ...timers, inlineDiff: diff as typeof diff | null },
    });
    expect(view.state.field(inlineDiffField).size).toBeGreaterThan(0);
    expect(view.state.selection.main.head).toBe(6);
    rerender({ viewRef, ...timers, inlineDiff: null });
    expect(view.state.field(inlineDiffField).size).toBe(0);
    view.destroy();
  });
});
