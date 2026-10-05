import { setInlineDiffEffect } from '@/render/components/TextEditor/inline-diff';
import { fnv1a32 } from '@/render/components/RightPanel/utils';
import {
  preciseReplaceWithReport,
  normalizedSearch as normalizedSearchInDoc,
} from '@/render/utils/preciseReplace';
import type { AppState } from './useAppState';

export type UseAssistantDialogHandlersContext = Pick<
  AppState,
  | 'activeTabRef'
  | 'dispatchFixCommand'
  | 'editorViewRef'
  | 'setEditorContent'
  | 'setEditorReloadToken'
  | 'setScrollToLine'
  | 'setTransientHighlightLine'
>;

/**
 * AI 助手对话框的修复应用与 diff 预览回调。
 * 注意：与原先内联在 JSX 中的写法保持一致，每次渲染都返回新的函数（不做 memo）。
 */
export function useAssistantDialogHandlers(ctx: UseAssistantDialogHandlersContext) {
  const {
    activeTabRef,
    dispatchFixCommand,
    editorViewRef,
    setEditorContent,
    setEditorReloadToken,
    setScrollToLine,
    setTransientHighlightLine,
  } = ctx;

  const handleAssistantApplyFix = async (
    original: string,
    modified: string,
    targetPath?: string,
    targetLine?: number
  ) => {
    dispatchFixCommand({ type: 'FIX_APPLY_STARTED' });
    const view = editorViewRef.current;
    const ipc = window.electron?.ipcRenderer;
    const isCurrentTab = !targetPath || targetPath === activeTabRef.current;

    if (isCurrentTab && view) {
      // ── 原子事务：文档变更 + diff 装饰在同一个 CM6 transaction ──
      const doc = view.state.doc.toString();
      const matchFrom = doc.indexOf(original);
      if (matchFrom >= 0) {
        const diffEffect = setInlineDiffEffect.of({
          from: matchFrom,
          to: matchFrom + modified.length,
          oldText: original,
          newText: modified,
        });
        view.dispatch({
          changes: { from: matchFrom, to: matchFrom + original.length, insert: modified },
          effects: diffEffect,
          selection: { anchor: matchFrom },
          scrollIntoView: true,
        });
      } else {
        const result = preciseReplaceWithReport(doc, original, modified);
        if (result.content) {
          const newFrom = result.content.indexOf(modified);
          const effects =
            newFrom >= 0
              ? setInlineDiffEffect.of({
                  from: newFrom,
                  to: newFrom + modified.length,
                  oldText: original,
                  newText: modified,
                })
              : undefined;
          view.dispatch({
            changes: { from: 0, to: doc.length, insert: result.content },
            effects: effects ? [effects] : undefined,
            selection: newFrom >= 0 ? { anchor: newFrom } : undefined,
            scrollIntoView: newFrom >= 0,
          });
        }
      }
      // 同步 state + 写盘
      const newDoc = view.state.doc.toString();
      setEditorContent(newDoc);
      if (ipc && targetPath) {
        ipc.invoke('write-file', targetPath, newDoc).catch(() => {});
      }

      // React state 同步（仅用于 SQLite 持久化）
      const postDoc = view.state.doc.toString();
      const newFrom = postDoc.indexOf(modified);
      if (newFrom >= 0) {
        dispatchFixCommand({
          type: 'FIX_PREVIEW_READY',
          inlineDiff: {
            from: newFrom,
            to: newFrom + modified.length,
            oldText: original,
            newText: modified,
          },
        });
      }
    } else {
      // 非当前 tab：读盘 → 替换 → 写盘 → reloadToken
      if (ipc && targetPath) {
        try {
          const diskContent = (await ipc.invoke('read-file', targetPath)) as string;
          const result = preciseReplaceWithReport(diskContent, original, modified);
          if (result.content) {
            await ipc.invoke('write-file', targetPath, result.content);
          }
        } catch {
          dispatchFixCommand({ type: 'FIX_APPLY_FAILED', error: '文件读写失败' });
          return;
        }
      }
      setEditorReloadToken((prev) => prev + 1);
    }
    dispatchFixCommand({ type: 'FIX_APPLY_SUCCEEDED', keepPreview: true });
    // Scroll + highlight
    if (targetLine && targetLine > 0) {
      setScrollToLine({
        line: targetLine,
        id: fnv1a32(`fix:${targetLine}:${original}`),
      });
      setTransientHighlightLine({
        line: targetLine,
        id: fnv1a32(`fix:${targetLine}:${original}`),
      });
    }
  };

  const handleAssistantPreviewDiff = (original: string, modified: string) => {
    // 在编辑器文档中定位 original 片段，设置内联 diff 装饰
    const view = editorViewRef.current;
    if (!view) return;
    const doc = view.state.doc.toString();
    let from = doc.indexOf(original);
    if (from < 0) {
      // 归一化回退查找
      const match = normalizedSearchInDoc(doc, original);
      if (!match) return;
      from = match.from;
    }
    const inlineDiffData = {
      from,
      to: from + original.length,
      oldText: original,
      newText: modified,
    };
    // ── 直接 dispatch 到 CM6，不经过 React state pipeline ──
    // 确保装饰立即生效，不受 BroadcastChannel / useEffect 时序干扰
    const line = view.state.doc.lineAt(Math.min(from, view.state.doc.length));
    view.dispatch({
      effects: setInlineDiffEffect.of(inlineDiffData),
      selection: { anchor: line.from },
      scrollIntoView: true,
    });
    // React state 同步（仅用于 SQLite 持久化）
    dispatchFixCommand({
      type: 'FIX_PREVIEW_READY',
      inlineDiff: inlineDiffData,
    });
  };

  return {
    handleAssistantApplyFix,
    handleAssistantPreviewDiff,
  };
}
