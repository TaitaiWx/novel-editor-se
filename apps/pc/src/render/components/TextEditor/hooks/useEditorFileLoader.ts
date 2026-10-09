import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Compartment } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  LARGE_FILE_THRESHOLD,
  isChangelogPath,
  isPersistablePath,
  isUntitledPath,
} from '../editor-paths';
import { createWordWrapExtension } from '../editor-extensions';
import type { CursorPosition } from '../types';

interface UseEditorFileLoaderOptions {
  editorReady: boolean;
  editorInitError: string | null;
  filePath: string | null;
  encoding: string;
  reloadToken?: number;
  virtualContent?: string | null;
  readOnly: boolean;
  wordWrap: boolean;
  focusMode: boolean;
  viewRef: React.MutableRefObject<EditorView | null>;
  currentFilePathRef: React.MutableRefObject<string | null>;
  currentContentRef: React.MutableRefObject<string>;
  currentOriginalContentRef: React.MutableRefObject<string>;
  readOnlyRef: React.MutableRefObject<boolean>;
  pendingSaveCountRef?: React.MutableRefObject<number>;
  readOnlyCompartment: React.MutableRefObject<Compartment>;
  wordWrapCompartment: React.MutableRefObject<Compartment>;
  setHasChanges: React.Dispatch<React.SetStateAction<boolean>>;
  setLastSaved: React.Dispatch<React.SetStateAction<Date | null>>;
  emitCursorPosition: (view: EditorView | null) => void;
  restoreViewportSnapshot: (targetPath: string, contentLength: number) => void;
  saveViewportSnapshot: (targetPath?: string | null) => void;
  onContentChange?: (content: string) => void;
  onLoadBlocked?: (previousPath: string) => void;
  onCursorChange?: (pos: CursorPosition) => void;
}

/**
 * 根据 filePath / virtualContent / reloadToken 加载文档内容到 EditorView：
 * 切换前先保存上一个文件的未保存修改与视口位置，再按普通文件 / 虚拟内容 /
 * 未命名文件 / 更新日志分别处理。
 */
export function useEditorFileLoader({
  editorReady,
  editorInitError,
  filePath,
  encoding,
  reloadToken,
  virtualContent,
  readOnly,
  wordWrap,
  focusMode,
  viewRef,
  currentFilePathRef,
  currentContentRef,
  currentOriginalContentRef,
  readOnlyRef,
  pendingSaveCountRef,
  readOnlyCompartment,
  wordWrapCompartment,
  setHasChanges,
  setLastSaved,
  emitCursorPosition,
  restoreViewportSnapshot,
  saveViewportSnapshot,
  onContentChange,
  onLoadBlocked,
  onCursorChange,
}: UseEditorFileLoaderOptions) {
  const [retryToken, setRetryToken] = useState(0);
  const requestedPathRef = useRef(filePath);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isLargeFile, setIsLargeFile] = useState(false);
  // 专注模式只影响加载时的换行配置，切换专注模式不应重新读取文件（由 useCodeMirrorView 负责重配），
  // 因此通过最新值 ref 读取，而不放入加载 effect 的依赖
  const focusModeRef = useRef(focusMode);
  focusModeRef.current = focusMode;

  // 加载阶段需要的展示配置与回调统一走「最新值 ref」：只读 / 换行变化由 useCodeMirrorView
  // 的 reconfigure effect 负责，回调身份变化也不应触发重新读盘（否则会覆盖未保存的输入）
  const loaderDepsRef = useRef({
    readOnly,
    wordWrap,
    emitCursorPosition,
    restoreViewportSnapshot,
    saveViewportSnapshot,
    onContentChange,
    onLoadBlocked,
    onCursorChange,
  });
  loaderDepsRef.current = {
    readOnly,
    wordWrap,
    emitCursorPosition,
    restoreViewportSnapshot,
    saveViewportSnapshot,
    onContentChange,
    onLoadBlocked,
    onCursorChange,
  };

  // Load file content：仅在文件 / 编码 / 重载信号 / 虚拟内容变化时重新加载
  useEffect(() => {
    if (!editorReady) return;
    let cancelled = false;
    const previousRequestedPath = requestedPathRef.current;
    requestedPathRef.current = filePath;
    const {
      readOnly,
      wordWrap,
      emitCursorPosition,
      restoreViewportSnapshot,
      saveViewportSnapshot,
      onContentChange,
      onCursorChange,
    } = loaderDepsRef.current;

    const loadContent = async () => {
      const view = viewRef.current;

      // 切换尚未完成（或保存失败）时回到原文件，直接恢复仍在编辑器中的草稿。
      if (previousRequestedPath !== filePath && currentFilePathRef.current === filePath) {
        setLoading(false);
        setError(null);
        onContentChange?.(currentContentRef.current);
        return;
      }

      setLoading(true);
      setError(null);
      let flushPendingSave = (pendingSaveCountRef?.current ?? 0) > 0;
      // readOnlyRef 属于已加载的文档，不能使用新目标文件的只读属性。
      while (
        isPersistablePath(currentFilePathRef.current) &&
        filePath !== currentFilePathRef.current &&
        (currentContentRef.current !== currentOriginalContentRef.current || flushPendingSave) &&
        !readOnlyRef.current
      ) {
        flushPendingSave = false;
        const previousPath = currentFilePathRef.current!;
        const previousContent = currentContentRef.current;
        if (pendingSaveCountRef) pendingSaveCountRef.current += 1;
        try {
          await window.electron.ipcRenderer.invoke('write-file', previousPath, previousContent);
          if (cancelled || currentFilePathRef.current !== previousPath) return;
          currentOriginalContentRef.current = previousContent;
          setHasChanges(currentContentRef.current !== previousContent);
        } catch (err) {
          if (cancelled || currentFilePathRef.current !== previousPath) return;
          console.error('Failed to save previous file:', err);
          setError('保存失败，未保存的内容已保留。请重试或返回原文件继续编辑。');
          setLoading(false);
          loaderDepsRef.current.onLoadBlocked?.(previousPath);
          return;
        } finally {
          if (pendingSaveCountRef) pendingSaveCountRef.current -= 1;
        }
      }

      if (currentFilePathRef.current && filePath !== currentFilePathRef.current) {
        saveViewportSnapshot(currentFilePathRef.current);
      }

      if (!filePath) {
        readOnlyRef.current = readOnly;
        setLoading(false);
        currentFilePathRef.current = null;
        currentContentRef.current = '';
        currentOriginalContentRef.current = '';
        setError(null);
        setIsLargeFile(false);
        setHasChanges(false);
        if (view) {
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: '' },
          });
        }
        onContentChange?.('');
        onCursorChange?.({ line: 1, column: 1 });
        return;
      }

      if (virtualContent !== undefined) {
        const nextContent = virtualContent ?? '';
        readOnlyRef.current = readOnly || isChangelogPath(filePath);
        currentFilePathRef.current = filePath;
        currentContentRef.current = nextContent;
        currentOriginalContentRef.current = nextContent;
        setError(null);
        setLoading(false);
        setLastSaved(null);
        setIsLargeFile(nextContent.length > LARGE_FILE_THRESHOLD);
        setHasChanges(false);
        if (view) {
          if (view.state.doc.toString() !== nextContent) {
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: nextContent },
              effects: [
                readOnlyCompartment.current.reconfigure(EditorView.editable.of(!readOnly)),
                wordWrapCompartment.current.reconfigure(
                  createWordWrapExtension(wordWrap, focusModeRef.current)
                ),
              ],
            });
          }
          restoreViewportSnapshot(filePath, nextContent.length);
          emitCursorPosition(view);
        }
        onContentChange?.(nextContent);
        return;
      }

      if (isUntitledPath(filePath)) {
        readOnlyRef.current = readOnly || isChangelogPath(filePath);
        currentFilePathRef.current = filePath;
        currentContentRef.current = '';
        currentOriginalContentRef.current = '';
        setError(null);
        setLoading(false);
        setLastSaved(null);
        setIsLargeFile(false);
        setHasChanges(false);
        if (view) {
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: '' },
          });
          restoreViewportSnapshot(filePath, 0);
          emitCursorPosition(view);
        }
        onContentChange?.('');
        return;
      }

      if (isChangelogPath(filePath)) {
        setLoading(true);
        try {
          const content = await window.electron.ipcRenderer.invoke('get-changelog');
          if (cancelled) return;
          readOnlyRef.current = readOnly || isChangelogPath(filePath);
          currentFilePathRef.current = filePath;
          currentContentRef.current = content;
          currentOriginalContentRef.current = content;
          setError(null);
          setIsLargeFile(false);
          setHasChanges(false);
          if (view) {
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: content },
              effects: [
                readOnlyCompartment.current.reconfigure(EditorView.editable.of(false)),
                wordWrapCompartment.current.reconfigure(EditorView.lineWrapping),
              ],
            });
            restoreViewportSnapshot(filePath, content.length);
            emitCursorPosition(view);
          }
        } catch (err) {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : '加载更新日志失败');
        } finally {
          if (!cancelled) setLoading(false);
        }
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const fileContent = await window.electron.ipcRenderer.invoke(
          'read-file',
          filePath,
          encoding
        );
        if (cancelled) return;

        readOnlyRef.current = readOnly || isChangelogPath(filePath);
        currentFilePathRef.current = filePath;
        currentContentRef.current = fileContent;
        currentOriginalContentRef.current = fileContent;

        if (view) {
          // Replace document content and reconfigure compartments
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: fileContent },
            effects: [
              readOnlyCompartment.current.reconfigure(EditorView.editable.of(!readOnly)),
              // 专注模式下强制换行，与 wordWrap 重配 effect 保持一致
              wordWrapCompartment.current.reconfigure(
                createWordWrapExtension(wordWrap, focusModeRef.current)
              ),
            ],
          });
          restoreViewportSnapshot(filePath, fileContent.length);
          emitCursorPosition(view);
        }

        setIsLargeFile(fileContent.length > LARGE_FILE_THRESHOLD);
        setLastSaved(null);
        setHasChanges(false);
        setLoading(false);

        onContentChange?.(fileContent);
      } catch (err) {
        if (cancelled) return;
        console.error('Error reading file:', err);
        setError(`无法读取文件: ${filePath}`);
        setLoading(false);
      }
    };

    void loadContent();
    return () => {
      cancelled = true;
    };
  }, [
    editorReady,
    filePath,
    encoding,
    reloadToken,
    retryToken,
    virtualContent,
    // 以下均为稳定引用（ref / Compartment ref / useState setter），不会引起额外加载
    viewRef,
    currentFilePathRef,
    currentContentRef,
    currentOriginalContentRef,
    readOnlyRef,
    pendingSaveCountRef,
    readOnlyCompartment,
    wordWrapCompartment,
    setHasChanges,
    setLastSaved,
  ]);

  /** 错误态"重试"：运行时初始化失败则刷新页面，否则重新读取当前文件 */
  const handleRetry = useCallback(() => {
    if (editorInitError) {
      window.location.reload();
      return;
    }
    setRetryToken((token) => token + 1);
  }, [editorInitError]);

  return { loading, error, isLargeFile, handleRetry };
}
