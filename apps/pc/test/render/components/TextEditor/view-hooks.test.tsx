// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useCodeMirrorView } from '@/render/components/TextEditor/hooks/useCodeMirrorView';
import { useEditorFileLoader } from '@/render/components/TextEditor/hooks/useEditorFileLoader';
import {
  loadEditorRuntime,
  type EditorRuntimeModules,
} from '@/render/components/TextEditor/editor-runtime';
import { LARGE_FILE_THRESHOLD } from '@/render/components/TextEditor/editor-paths';

const invoke = vi.fn();
let runtime: EditorRuntimeModules;

beforeAll(async () => {
  runtime = await loadEditorRuntime();
});

beforeEach(() => {
  invoke.mockReset();
  Object.defineProperty(window, 'electron', {
    value: { ipcRenderer: { invoke } },
    configurable: true,
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'electron');
  document.body.innerHTML = '';
});

const makeRef = <T,>(value: T) => ({ current: value });

describe('useCodeMirrorView', () => {
  function setup(overrides: { readOnly?: boolean } = {}) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const deps = {
      editorContainerRef: makeRef<HTMLDivElement | null>(host),
      viewRef: makeRef<EditorView | null>(null),
      editorViewRef: makeRef<EditorView | null>(null),
      currentContentRef: makeRef(''),
      currentOriginalContentRef: makeRef(''),
      onContentChangeRef: makeRef<((c: string) => void) | undefined>(vi.fn()),
      onCursorChangeRef: makeRef<((p: { line: number; column: number }) => void) | undefined>(
        vi.fn()
      ),
      handleManualSaveRef: makeRef(vi.fn()),
      setHasChanges: vi.fn(),
      scheduleAutoSave: vi.fn(),
      saveViewportSnapshot: vi.fn(),
    };
    const baseProps = {
      ...deps,
      editorRuntime: runtime as EditorRuntimeModules | null,
      filePath: '/a.md' as string | null,
      isUntitled: false,
      readOnly: overrides.readOnly ?? false,
      wordWrap: true,
      focusMode: false,
      showLineNumbers: false,
      showThousandCharMarkers: true,
      thousandCharMarkerStep: 1000,
      characterHighlights: [],
    };
    const hook = renderHook((props) => useCodeMirrorView(props), { initialProps: baseProps });
    return { ...hook, deps, baseProps, host };
  }

  it('运行时未就绪时不创建编辑器', () => {
    const host = document.createElement('div');
    const viewRef = makeRef<EditorView | null>(null);
    const { result } = renderHook(() =>
      useCodeMirrorView({
        editorContainerRef: makeRef<HTMLDivElement | null>(host),
        viewRef,
        editorRuntime: null,
        currentContentRef: makeRef(''),
        currentOriginalContentRef: makeRef(''),
        onContentChangeRef: makeRef(undefined),
        onCursorChangeRef: makeRef(undefined),
        handleManualSaveRef: makeRef(() => {}),
        setHasChanges: vi.fn(),
        scheduleAutoSave: vi.fn(),
        saveViewportSnapshot: vi.fn(),
        filePath: null,
        isUntitled: false,
        readOnly: false,
        wordWrap: true,
        focusMode: false,
        showLineNumbers: false,
        showThousandCharMarkers: false,
        thousandCharMarkerStep: 1000,
        characterHighlights: [],
      })
    );
    expect(result.current.editorReady).toBe(false);
    expect(viewRef.current).toBeNull();
  });

  it('创建 EditorView 并同步外部 ref；编辑触发内容回调与自动保存', () => {
    const { result, deps, host } = setup();
    expect(result.current.editorReady).toBe(true);
    const view = deps.viewRef.current as EditorView;
    expect(view).toBeInstanceOf(EditorView);
    expect(deps.editorViewRef.current).toBe(view);
    expect(host.querySelector('.cm-editor')).not.toBeNull();

    act(() => {
      view.dispatch({ changes: { from: 0, insert: '第一行' }, selection: { anchor: 3 } });
    });
    expect(deps.currentContentRef.current).toBe('第一行');
    expect(deps.setHasChanges).toHaveBeenCalledWith(true);
    expect(deps.onContentChangeRef.current).toHaveBeenCalledWith('第一行');
    expect(deps.scheduleAutoSave).toHaveBeenCalled();
    expect(deps.onCursorChangeRef.current).toHaveBeenCalledWith({ line: 1, column: 4 });
    expect(deps.saveViewportSnapshot).toHaveBeenCalled();
  });

  it('只读配置通过 compartment 动态切换', () => {
    const { deps, rerender, baseProps } = setup();
    const view = deps.viewRef.current as EditorView;
    expect(view.state.facet(EditorView.editable)).toBe(true);
    rerender({ ...baseProps, readOnly: true });
    expect(view.state.facet(EditorView.editable)).toBe(false);
  });

  it('Markdown 实时渲染：markdown 文件始终懒加载渲染，非 markdown 文件保持纯文本', async () => {
    const { deps, rerender, baseProps } = setup();
    const view = deps.viewRef.current as EditorView;
    act(() => {
      view.dispatch({ changes: { from: 0, insert: '正文\n\n# 标题' } });
    });
    await waitFor(() => expect(view.contentDOM.querySelector('.cm-lp-h1')).not.toBeNull());
    // .txt 等其他格式不渲染
    rerender({ ...baseProps, filePath: '/a.txt' });
    await waitFor(() => expect(view.contentDOM.querySelector('.cm-lp-h1')).toBeNull());
    // 切回 markdown 文件重新启用
    rerender({ ...baseProps, filePath: '/b.markdown' });
    await waitFor(() => expect(view.contentDOM.querySelector('.cm-lp-h1')).not.toBeNull());
  });

  it('卸载时保存视口并销毁编辑器', () => {
    const { deps, unmount } = setup();
    unmount();
    expect(deps.saveViewportSnapshot).toHaveBeenCalled();
    expect(deps.viewRef.current).toBeNull();
    expect(deps.editorViewRef.current).toBeNull();
  });
});

describe('useEditorFileLoader', () => {
  function setup(initial: Partial<Parameters<typeof useEditorFileLoader>[0]> = {}) {
    const readOnlyCompartment = makeRef(new Compartment());
    const wordWrapCompartment = makeRef(new Compartment());
    const view = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions: [
          readOnlyCompartment.current.of(EditorView.editable.of(true)),
          wordWrapCompartment.current.of([]),
        ],
      }),
      parent: document.body,
    });
    const props: Parameters<typeof useEditorFileLoader>[0] = {
      editorReady: true,
      editorInitError: null,
      filePath: '/a.md',
      encoding: 'UTF-8',
      readOnly: false,
      wordWrap: true,
      focusMode: false,
      viewRef: makeRef<EditorView | null>(view),
      currentFilePathRef: makeRef<string | null>(null),
      currentContentRef: makeRef(''),
      currentOriginalContentRef: makeRef(''),
      readOnlyRef: makeRef(false),
      readOnlyCompartment,
      wordWrapCompartment,
      setHasChanges: vi.fn(),
      setLastSaved: vi.fn(),
      emitCursorPosition: vi.fn(),
      restoreViewportSnapshot: vi.fn(),
      saveViewportSnapshot: vi.fn(),
      onContentChange: vi.fn(),
      onCursorChange: vi.fn(),
      ...initial,
    };
    const hook = renderHook((p) => useEditorFileLoader(p), { initialProps: props });
    return { ...hook, props, view };
  }

  it('读取普通文件写入编辑器', async () => {
    invoke.mockResolvedValue('正文内容');
    const { result, props, view } = setup();
    await waitFor(() => expect(props.onContentChange).toHaveBeenCalledWith('正文内容'));
    expect(invoke).toHaveBeenCalledWith('read-file', '/a.md', 'UTF-8');
    expect(view.state.doc.toString()).toBe('正文内容');
    expect(props.currentFilePathRef.current).toBe('/a.md');
    expect(props.restoreViewportSnapshot).toHaveBeenCalledWith('/a.md', 4);
    expect(result.current.loading).toBe(false);
    expect(result.current.isLargeFile).toBe(false);
  });

  it.each(['success', 'failure'] as const)(
    '忽略旧文件晚返回的 %s，不覆盖当前文件',
    async (outcome) => {
      let resolveA!: (value: string) => void;
      let rejectA!: (reason: Error) => void;
      invoke.mockImplementationOnce(
        () =>
          new Promise<string>((resolve, reject) => {
            resolveA = resolve;
            rejectA = reject;
          })
      );
      const { props, view, result, rerender } = setup();
      invoke.mockResolvedValueOnce('B');
      rerender({ ...props, filePath: '/b.md' });
      await waitFor(() => expect(view.state.doc.toString()).toBe('B'));
      await act(async () => {
        if (outcome === 'success') resolveA('A');
        else rejectA(new Error('late read failure'));
      });
      expect(view.state.doc.toString()).toBe('B');
      expect(props.currentContentRef.current).toBe('B');
      expect(props.currentFilePathRef.current).toBe('/b.md');
      expect(result.current.error).toBeNull();
    }
  );

  it('切换前写入失败保留旧草稿，重试先保存草稿再加载目标', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    invoke.mockResolvedValueOnce('A');
    const { props, view, result, rerender } = setup();
    await waitFor(() => expect(view.state.doc.toString()).toBe('A'));
    act(() => view.dispatch({ changes: { from: 0, to: 1, insert: 'A draft' } }));
    props.currentContentRef.current = 'A draft';
    invoke.mockRejectedValueOnce(new Error('disk full'));
    rerender({ ...props, filePath: '/b.md' });
    await waitFor(() => expect(result.current.error).toContain('保存失败'));
    expect(props.currentFilePathRef.current).toBe('/a.md');
    expect(props.currentContentRef.current).toBe('A draft');
    expect(view.state.doc.toString()).toBe('A draft');
    expect(invoke).not.toHaveBeenCalledWith('read-file', '/b.md', 'UTF-8');
    invoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce('B');
    act(() => result.current.handleRetry());
    await waitFor(() => expect(view.state.doc.toString()).toBe('B'));
    expect(invoke).toHaveBeenNthCalledWith(3, 'write-file', '/a.md', 'A draft');
    expect(props.currentFilePathRef.current).toBe('/b.md');
    errorSpy.mockRestore();
  });

  it('保存失败恢复原文件选中状态时不重新读取并覆盖草稿', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    invoke.mockResolvedValueOnce('A');
    const onLoadBlocked = vi.fn();
    const { props, view, result, rerender } = setup({ onLoadBlocked });
    await waitFor(() => expect(view.state.doc.toString()).toBe('A'));
    act(() => view.dispatch({ changes: { from: 0, to: 1, insert: 'A draft' } }));
    props.currentContentRef.current = 'A draft';
    invoke.mockRejectedValueOnce(new Error('disk full'));
    rerender({ ...props, filePath: '/b.md' });
    await waitFor(() => expect(onLoadBlocked).toHaveBeenCalledWith('/a.md'));
    rerender(props);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(view.state.doc.toString()).toBe('A draft');
    expect(props.currentContentRef.current).toBe('A draft');
    expect(props.currentOriginalContentRef.current).toBe('A');
    expect(invoke).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });

  it('切换到只读文件仍先保存可写旧文档，成功后再更新保存只读状态', async () => {
    invoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce('B');
    const { props, view } = setup({
      filePath: '/b.md',
      readOnly: true,
      currentFilePathRef: makeRef<string | null>('/a.md'),
      currentContentRef: makeRef('A draft'),
      currentOriginalContentRef: makeRef('A'),
      readOnlyRef: makeRef(false),
    });
    await waitFor(() => expect(view.state.doc.toString()).toBe('B'));
    expect(invoke).toHaveBeenNthCalledWith(1, 'write-file', '/a.md', 'A draft');
    expect(props.readOnlyRef.current).toBe(true);
  });

  it('切换保存尚未完成时返回原文件，保留草稿而不读取尚未更新的磁盘', async () => {
    invoke.mockResolvedValueOnce('A');
    const { props, view, result, rerender } = setup();
    await waitFor(() => expect(view.state.doc.toString()).toBe('A'));
    act(() => view.dispatch({ changes: { from: 0, to: 1, insert: 'A draft' } }));
    props.currentContentRef.current = 'A draft';
    let resolveWrite!: () => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        })
    );
    rerender({ ...props, filePath: '/b.md' });
    invoke.mockResolvedValueOnce('A');
    rerender(props);
    await act(async () => {});
    expect(view.state.doc.toString()).toBe('A draft');
    expect(props.currentContentRef.current).toBe('A draft');
    expect(result.current.loading).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(2);
    await act(async () => resolveWrite());
    expect(view.state.doc.toString()).toBe('A draft');
  });

  it('离开正在等待保存的目标后不再读取该目标', async () => {
    let resolveWrite!: () => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        })
    );
    const { props, view, rerender } = setup({
      filePath: '/b.md',
      currentFilePathRef: makeRef<string | null>('/a.md'),
      currentContentRef: makeRef('A draft'),
      currentOriginalContentRef: makeRef('A'),
    });
    invoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce('C');
    rerender({ ...props, filePath: '/c.md' });
    await waitFor(() => expect(view.state.doc.toString()).toBe('C'));
    await act(async () => resolveWrite());
    expect(invoke).not.toHaveBeenCalledWith('read-file', '/b.md', 'UTF-8');
    expect(props.currentFilePathRef.current).toBe('/c.md');
    expect(view.state.doc.toString()).toBe('C');
  });

  it('重试也采用编码和完整文件状态，旧重试结果不会覆盖新选中文档', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    invoke.mockRejectedValueOnce(new Error('ENOENT'));
    const { result, props, view, rerender } = setup({ encoding: 'GBK' });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    let resolveRetry!: (value: string) => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveRetry = resolve;
        })
    );
    act(() => result.current.handleRetry());
    expect(invoke).toHaveBeenLastCalledWith('read-file', '/a.md', 'GBK');
    invoke.mockResolvedValueOnce('B');
    rerender({ ...props, filePath: '/b.md' });
    await waitFor(() => expect(view.state.doc.toString()).toBe('B'));
    await act(async () => resolveRetry('A'));
    expect(props.currentFilePathRef.current).toBe('/b.md');
    expect(view.state.doc.toString()).toBe('B');
    expect(result.current.error).toBeNull();
    errorSpy.mockRestore();
  });

  it('大文件标记', async () => {
    invoke.mockResolvedValue('a'.repeat(LARGE_FILE_THRESHOLD + 1));
    const { result } = setup();
    await waitFor(() => expect(result.current.isLargeFile).toBe(true));
  });

  it('读取失败显示错误，重试成功后清除', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    invoke.mockRejectedValueOnce(new Error('ENOENT'));
    const { result, view } = setup();
    await waitFor(() => expect(result.current.error).toBe('无法读取文件: /a.md'));

    invoke.mockResolvedValueOnce('恢复');
    act(() => result.current.handleRetry());
    await waitFor(() => expect(view.state.doc.toString()).toBe('恢复'));
    expect(result.current.error).toBeNull();
    errorSpy.mockRestore();
  });

  it('虚拟内容直接写入，不读取磁盘', async () => {
    const { props, view } = setup({ virtualContent: '虚拟' });
    await waitFor(() => expect(props.onContentChange).toHaveBeenCalledWith('虚拟'));
    expect(invoke).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe('虚拟');
  });

  it('未命名文件清空内容；更新日志只读加载', async () => {
    const untitled = setup({ filePath: '__untitled__:新.md' });
    await waitFor(() => expect(untitled.props.onContentChange).toHaveBeenCalledWith(''));
    expect(invoke).not.toHaveBeenCalled();

    invoke.mockResolvedValue('# 更新日志');
    const changelog = setup({ filePath: '__changelog__:CHANGELOG' });
    await waitFor(() => expect(changelog.view.state.doc.toString()).toBe('# 更新日志'));
    expect(invoke).toHaveBeenCalledWith('get-changelog');
    expect(changelog.view.state.facet(EditorView.editable)).toBe(false);
  });

  it('切换文件前保存上一个文件的未保存修改与视口', async () => {
    invoke.mockResolvedValue('B');
    const { props } = setup({
      filePath: '/b.md',
      currentFilePathRef: makeRef<string | null>('/a.md'),
      currentContentRef: makeRef('A 修改'),
      currentOriginalContentRef: makeRef('A'),
    });
    await waitFor(() => expect(props.onContentChange).toHaveBeenCalledWith('B'));
    expect(invoke).toHaveBeenNthCalledWith(1, 'write-file', '/a.md', 'A 修改');
    expect(props.saveViewportSnapshot).toHaveBeenCalledWith('/a.md');
  });

  it('切换时内容虽撤销回旧基线，仍排队保存以覆盖尚未完成的旧写入', async () => {
    invoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce('B');
    const { props, view } = setup({
      filePath: '/b.md',
      currentFilePathRef: makeRef<string | null>('/a.md'),
      currentContentRef: makeRef('original'),
      currentOriginalContentRef: makeRef('original'),
      pendingSaveCountRef: makeRef(1),
    });
    await waitFor(() => expect(view.state.doc.toString()).toBe('B'));
    expect(invoke).toHaveBeenNthCalledWith(1, 'write-file', '/a.md', 'original');
    expect(props.currentFilePathRef.current).toBe('/b.md');
  });

  it('切到特殊面板的空目标时保存失败也保留正文并请求恢复标签', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onLoadBlocked = vi.fn();
    invoke.mockRejectedValueOnce(new Error('disk full'));
    const { props, result } = setup({
      filePath: null,
      currentFilePathRef: makeRef<string | null>('/a.md'),
      currentContentRef: makeRef('A draft'),
      currentOriginalContentRef: makeRef('A'),
      onLoadBlocked,
    });
    await waitFor(() => expect(result.current.error).toContain('保存失败'));
    expect(onLoadBlocked).toHaveBeenCalledWith('/a.md');
    expect(props.currentFilePathRef.current).toBe('/a.md');
    expect(props.currentContentRef.current).toBe('A draft');
    errorSpy.mockRestore();
  });

  it('文件路径为空时重置编辑器', async () => {
    const { props, view } = setup({
      filePath: null,
      currentFilePathRef: makeRef<string | null>('/a.md'),
    });
    await waitFor(() => expect(props.onCursorChange).toHaveBeenCalledWith({ line: 1, column: 1 }));
    expect(props.currentFilePathRef.current).toBeNull();
    expect(view.state.doc.length).toBe(0);
  });

  it('编辑器未就绪时不加载', () => {
    setup({ editorReady: false });
    expect(invoke).not.toHaveBeenCalled();
  });
});
