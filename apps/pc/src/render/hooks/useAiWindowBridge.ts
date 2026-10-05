import React from 'react';
import { fnv1a32 } from '@/render/components/RightPanel/utils';
import {
  formatPreciseReplaceReport,
  preciseReplaceWithReport,
} from '@/render/utils/preciseReplace';
import { setInlineDiffEffect } from '@/render/components/TextEditor/inline-diff';
import type { AppState } from './useAppState';
import type { TabActions } from './useTabActions';

export type UseAiWindowBridgeContext = Pick<
  AppState,
  | 'dispatchFixCommand'
  | 'editorViewRef'
  | 'setEditorContent'
  | 'setEditorReloadToken'
  | 'setScrollToLine'
  | 'setSettingsCenterTab'
  | 'setShowSettingsCenter'
  | 'setTransientHighlightLine'
  | 'toast'
> &
  Pick<TabActions, 'openFileInTab'>;

/**
 * 监听 AI 独立窗口发来的事件（打开文件、打开设置、应用修复）
 */
export function useAiWindowBridge(ctx: UseAiWindowBridgeContext) {
  const {
    dispatchFixCommand,
    editorViewRef,
    openFileInTab,
    setEditorContent,
    setEditorReloadToken,
    setScrollToLine,
    setSettingsCenterTab,
    setShowSettingsCenter,
    setTransientHighlightLine,
    toast,
  } = ctx;

  // 监听 AI 独立窗口发来的事件
  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;

    // AI 窗口请求打开文件
    const disposeOpenFile = ipc.on('open-file-from-ai', (_event: unknown, filePath: string) => {
      openFileInTab(filePath);
    });

    // AI 窗口请求打开设置
    const disposeOpenSettings = ipc.on('open-settings-from-ai', () => {
      setSettingsCenterTab('ai');
      setShowSettingsCenter(true);
    });

    // AI 窗口提交修复 → 精确局部替换 + 写盘
    const disposeApplyFix = ipc.on(
      'ai-apply-fix-request',
      async (
        _event: unknown,
        payload: {
          filePath: string;
          original: string;
          modified: string;
          explanation?: string;
          proposedFullContent?: string;
          targetLine?: number;
        }
      ) => {
        const {
          filePath: fp,
          original,
          modified,
          targetLine: delegatedTargetLine,
          proposedFullContent,
        } = payload;

        // 1. 打开目标 tab
        openFileInTab(fp);

        // 2. 等待 EditorView 就绪（tab 切换可能是异步的）
        const waitForView = (): Promise<void> =>
          new Promise((resolve) => {
            if (editorViewRef.current) {
              resolve();
            } else {
              const timer = setTimeout(resolve, 200);
              const check = setInterval(() => {
                if (editorViewRef.current) {
                  clearInterval(check);
                  clearTimeout(timer);
                  resolve();
                }
              }, 20);
            }
          });
        await waitForView();

        const view = editorViewRef.current;
        let fullContent = proposedFullContent || '';
        let matchFrom = -1;
        let sourceForLine = '';
        if (view) {
          const doc = view.state.doc.toString();
          sourceForLine = doc;
          matchFrom = doc.indexOf(original);
          if (!fullContent) {
            const result = preciseReplaceWithReport(doc, original, modified);
            if (!result.content) {
              toast.error('AI 修复未命中，已生成诊断报告');
              console.warn(formatPreciseReplaceReport(result.report));
              return;
            }
            fullContent = result.content;
          }
        } else {
          try {
            const diskContent = (await ipc.invoke('read-file', fp)) as string;
            sourceForLine = diskContent;
            matchFrom = diskContent.indexOf(original);
            if (!fullContent) {
              const result = preciseReplaceWithReport(diskContent, original, modified);
              if (!result.content) {
                toast.error('AI 修复未命中');
                return;
              }
              fullContent = result.content;
            }
          } catch {
            toast.error('文件读写失败');
            return;
          }
        }

        const targetLine =
          delegatedTargetLine ||
          (matchFrom >= 0 ? sourceForLine.slice(0, matchFrom).split('\n').length : 1);

        // AI 侧已确认应用，这里直接落盘，不再触发编辑器二次确认
        dispatchFixCommand({ type: 'FIX_APPLY_STARTED' });
        try {
          await ipc.invoke('write-file', fp, fullContent);
          if (view) {
            // ── 原子事务：文档变更 + diff 装饰在同一个 CM6 transaction 中 ──
            // 这样 StateField 先处理 effect（创建装饰），再遇到 docChanged 时已经 return，
            // 装饰不会被 Decoration.none 清除
            const newFrom = fullContent.indexOf(modified);
            if (newFrom >= 0) {
              const diffEffect = setInlineDiffEffect.of({
                from: newFrom,
                to: newFrom + modified.length,
                oldText: original,
                newText: modified,
              });
              view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: fullContent },
                effects: diffEffect,
                selection: { anchor: newFrom },
                scrollIntoView: true,
              });
            } else {
              view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: fullContent },
              });
            }
            setEditorContent(view.state.doc.toString());
          } else {
            setEditorContent(fullContent);
            setEditorReloadToken((prev) => prev + 1);
          }
        } catch {
          dispatchFixCommand({ type: 'FIX_APPLY_FAILED', error: '文件写入失败' });
          toast.error('文件写入失败');
          return;
        }
        dispatchFixCommand({ type: 'FIX_APPLY_SUCCEEDED' });

        // React state 同步（仅用于 SQLite 持久化，CM6 装饰已在上方原子事务中设置）
        if (matchFrom >= 0) {
          const newFrom = fullContent.indexOf(modified);
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
        }

        if (targetLine > 0) {
          setScrollToLine({
            line: targetLine,
            id: fnv1a32(`apply:${targetLine}:${original}`),
          });
          setTransientHighlightLine({
            line: targetLine,
            id: fnv1a32(`apply:${targetLine}:${original}`),
          });
        }
      }
    );

    return () => {
      disposeOpenFile?.();
      disposeOpenSettings?.();
      disposeApplyFix?.();
    };
  }, [openFileInTab, toast]);
}
