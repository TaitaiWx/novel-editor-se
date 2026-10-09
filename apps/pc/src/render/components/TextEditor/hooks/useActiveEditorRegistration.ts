import type React from 'react';
import { useEffect } from 'react';
import type { EditorView } from '@codemirror/view';
import { planBlockInsert, registerActiveEditor } from '../active-editor';

interface UseActiveEditorRegistrationOptions {
  editorContainerRef: React.RefObject<HTMLDivElement | null>;
  viewRef: React.MutableRefObject<EditorView | null>;
  currentFilePathRef: React.MutableRefObject<string | null>;
  currentContentRef: React.MutableRefObject<string>;
  currentOriginalContentRef: React.MutableRefObject<string>;
  autoSaveTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
  setHasChanges: React.Dispatch<React.SetStateAction<boolean>>;
  readOnlyRef: React.MutableRefObject<boolean>;
  handleManualSaveRef: React.MutableRefObject<() => boolean | void | Promise<boolean | void>>;
}

/**
 * 把编辑器登记为应用菜单（保存 / 另存为 / 查找）的目标：挂载时登记，获得焦点时置为当前，卸载时移除
 */
export function useActiveEditorRegistration({
  editorContainerRef,
  viewRef,
  currentFilePathRef,
  currentContentRef,
  currentOriginalContentRef,
  autoSaveTimeoutRef,
  setHasChanges,
  readOnlyRef,
  handleManualSaveRef,
}: UseActiveEditorRegistrationOptions) {
  useEffect(() => {
    const registration = registerActiveEditor({
      save: () => handleManualSaveRef.current(),
      discard: () => {
        if (autoSaveTimeoutRef.current) {
          clearTimeout(autoSaveTimeoutRef.current);
          autoSaveTimeoutRef.current = null;
        }
        // 保留 DOM 到下一次正常加载，但取消其路径身份，任何卸载/切换保存都不会重建文件。
        currentFilePathRef.current = null;
        currentContentRef.current = '';
        currentOriginalContentRef.current = '';
        setHasChanges(false);
      },
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
      insertBlock: (text) => {
        const view = viewRef.current;
        if (!view || readOnlyRef.current) return false;
        const line = view.state.doc.lineAt(view.state.selection.main.head);
        const plan = planBlockInsert(line, text);
        view.dispatch({
          changes: { from: plan.from, insert: plan.insert },
          selection: { anchor: plan.from + plan.insert.length },
          scrollIntoView: true,
        });
        view.focus();
        return true;
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
    currentOriginalContentRef,
    autoSaveTimeoutRef,
    setHasChanges,
    currentFilePathRef,
    editorContainerRef,
    handleManualSaveRef,
    readOnlyRef,
    viewRef,
  ]);
}
