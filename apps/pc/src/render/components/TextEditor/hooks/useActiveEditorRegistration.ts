import type React from 'react';
import { useEffect } from 'react';
import type { EditorView } from '@codemirror/view';
import { registerActiveEditor } from '../active-editor';

interface UseActiveEditorRegistrationOptions {
  editorContainerRef: React.RefObject<HTMLDivElement | null>;
  viewRef: React.MutableRefObject<EditorView | null>;
  currentFilePathRef: React.MutableRefObject<string | null>;
  currentContentRef: React.MutableRefObject<string>;
  readOnlyRef: React.MutableRefObject<boolean>;
  handleManualSaveRef: React.MutableRefObject<() => void>;
}

/**
 * 把编辑器登记为应用菜单（保存 / 另存为 / 查找）的目标：挂载时登记，获得焦点时置为当前，卸载时移除
 */
export function useActiveEditorRegistration({
  editorContainerRef,
  viewRef,
  currentFilePathRef,
  currentContentRef,
  readOnlyRef,
  handleManualSaveRef,
}: UseActiveEditorRegistrationOptions) {
  useEffect(() => {
    const registration = registerActiveEditor({
      save: () => handleManualSaveRef.current(),
      getSnapshot: () => ({
        filePath: currentFilePathRef.current,
        content: currentContentRef.current,
        readOnly: readOnlyRef.current,
      }),
      openSearch: () => {
        const view = viewRef.current;
        if (!view) return;
        view.focus();
        // 编辑器运行时已加载 @codemirror/search，这里命中模块缓存
        void import('@codemirror/search').then(({ openSearchPanel }) => {
          if (viewRef.current === view) openSearchPanel(view);
        });
      },
    });
    const container = editorContainerRef.current;
    container?.addEventListener('focusin', registration.activate);
    return () => {
      container?.removeEventListener('focusin', registration.activate);
      registration.dispose();
    };
  }, [
    currentContentRef,
    currentFilePathRef,
    editorContainerRef,
    handleManualSaveRef,
    readOnlyRef,
    viewRef,
  ]);
}
