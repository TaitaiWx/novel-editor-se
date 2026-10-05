import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
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
  readOnlyCompartment: React.MutableRefObject<Compartment>;
  wordWrapCompartment: React.MutableRefObject<Compartment>;
  setHasChanges: React.Dispatch<React.SetStateAction<boolean>>;
  setLastSaved: React.Dispatch<React.SetStateAction<Date | null>>;
  emitCursorPosition: (view: EditorView | null) => void;
  restoreViewportSnapshot: (targetPath: string, contentLength: number) => void;
  saveViewportSnapshot: (targetPath?: string | null) => void;
  onContentChange?: (content: string) => void;
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
  readOnlyCompartment,
  wordWrapCompartment,
  setHasChanges,
  setLastSaved,
  emitCursorPosition,
  restoreViewportSnapshot,
  saveViewportSnapshot,
  onContentChange,
  onCursorChange,
}: UseEditorFileLoaderOptions) {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isLargeFile, setIsLargeFile] = useState(false);

  // Load file content
  useEffect(() => {
    if (!editorReady) return;

    const loadContent = async () => {
      const view = viewRef.current;

      // Save previous file before switching
      if (
        isPersistablePath(currentFilePathRef.current) &&
        filePath !== currentFilePathRef.current &&
        currentContentRef.current !== currentOriginalContentRef.current &&
        !readOnlyRef.current
      ) {
        try {
          await window.electron.ipcRenderer.invoke(
            'write-file',
            currentFilePathRef.current,
            currentContentRef.current
          );
        } catch (err) {
          console.error('Failed to save previous file:', err);
        }
      }

      if (currentFilePathRef.current && filePath !== currentFilePathRef.current) {
        saveViewportSnapshot(currentFilePathRef.current);
      }

      if (!filePath) {
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
                  createWordWrapExtension(wordWrap, focusMode)
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
          setError(err instanceof Error ? err.message : '加载更新日志失败');
        } finally {
          setLoading(false);
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
              wordWrapCompartment.current.reconfigure(createWordWrapExtension(wordWrap, focusMode)),
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
        console.error('Error reading file:', err);
        setError(`无法读取文件: ${filePath}`);
        currentContentRef.current = '';
        currentOriginalContentRef.current = '';
        setLoading(false);
      }
    };

    loadContent();
  }, [
    editorReady,
    filePath,
    encoding,
    reloadToken,
    virtualContent,
    readOnly,
    wordWrap,
    emitCursorPosition,
    restoreViewportSnapshot,
    saveViewportSnapshot,
    onContentChange,
    onCursorChange,
  ]);

  /** 错误态"重试"：运行时初始化失败则刷新页面，否则重新读取当前文件 */
  const handleRetry = useCallback(() => {
    if (editorInitError) {
      window.location.reload();
      return;
    }
    setError(null);
    setLoading(false);
    if (filePath) {
      const retryLoad = async () => {
        setLoading(true);
        try {
          const fileContent = await window.electron.ipcRenderer.invoke('read-file', filePath);
          const view = viewRef.current;
          if (view) {
            view.dispatch({
              changes: {
                from: 0,
                to: view.state.doc.length,
                insert: fileContent,
              },
            });
          }
          currentContentRef.current = fileContent;
          currentOriginalContentRef.current = fileContent;
          setHasChanges(false);
        } catch (err) {
          console.error('Error reading file:', err);
          setError(`无法读取文件: ${filePath}`);
        } finally {
          setLoading(false);
        }
      };
      retryLoad();
    }
  }, [editorInitError, filePath]);

  return { loading, error, isLargeFile, handleRetry };
}
