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
