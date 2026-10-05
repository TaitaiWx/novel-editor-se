import { useCallback, useRef } from 'react';
import type { ContextMenuEvent } from '@/render/components/FileTree';
import type { CursorPosition } from '@/render/app/types';
import { EditorSelection } from '@codemirror/state';
import type { FixDiffState } from '@/render/state/fixSessionState';
import type { ObjectContextMenuEvent } from '@/render/components/FilePanel';
import { fnv1a32 } from '@/render/components/RightPanel/utils';
import { formatChapterContent } from '@/render/utils/chapterFormatter';
import { isUntitledTabPath } from '@/render/app/fileTreeUtils';
import type { AppState } from './useAppState';
import type { PaneLayoutApi } from './usePaneLayout';
import type { TabActions } from './useTabActions';
import type { ProjectLoaderApi } from './useProjectLoader';

export type UseEditorInteractionsContext = Pick<
  AppState,
  | 'activeTabRef'
  | 'dispatchFixCommand'
  | 'editorViewRef'
  | 'filePanelRevealCounterRef'
  | 'focusMode'
  | 'pendingApplyQueue'
  | 'setContextMenu'
  | 'setCursorPosition'
  | 'setEditorContent'
  | 'setEditorReloadToken'
  | 'setFilePanelRevealRequest'
  | 'setFocusMode'
  | 'setReplaceLineRequest'
  | 'setScrollToLine'
  | 'setTransientHighlightLine'
  | 'setUntitledTabContents'
  | 'sidebarCollapsedRef'
  | 'toast'
> &
  Pick<PaneLayoutApi, 'handleExpandSidebar'> &
  Pick<TabActions, 'openFileInTab'> &
  Pick<ProjectLoaderApi, 'refreshCurrentFolder'>;

/**
 * 编辑器交互：内容 / 光标变更、滚动定位、高亮、diff 与修复应用、右键菜单入口
 */
export function useEditorInteractions(ctx: UseEditorInteractionsContext) {
  const {
    activeTabRef,
    dispatchFixCommand,
    editorViewRef,
    filePanelRevealCounterRef,
    focusMode,
    handleExpandSidebar,
    openFileInTab,
    pendingApplyQueue,
    refreshCurrentFolder,
    setContextMenu,
    setCursorPosition,
    setEditorContent,
    setEditorReloadToken,
    setFilePanelRevealRequest,
    setFocusMode,
    setReplaceLineRequest,
    setScrollToLine,
    setTransientHighlightLine,
    setUntitledTabContents,
    sidebarCollapsedRef,
    toast,
  } = ctx;

  const handleFormatCurrentChapter = useCallback(() => {
    const view = editorViewRef.current;
    if (!view || !activeTabRef.current) {
      toast.warning('当前没有可格式化的章节');
      return;
    }

    const currentContent = view.state.doc.toString();
    const result = formatChapterContent(currentContent);
    if (!result.changed) {
      toast.info('当前章节已是规范格式');
      return;
    }

    const previousSelection = view.state.selection.main;
    const previousScrollTop = view.scrollDOM.scrollTop;
    const previousScrollLeft = view.scrollDOM.scrollLeft;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: result.content },
      selection: EditorSelection.range(
        Math.min(previousSelection.anchor, result.content.length),
        Math.min(previousSelection.head, result.content.length)
      ),
    });

    window.requestAnimationFrame(() => {
      const activeView = editorViewRef.current;
      if (!activeView) return;
      activeView.scrollDOM.scrollTop = previousScrollTop;
      activeView.scrollDOM.scrollLeft = previousScrollLeft;
    });

    view.focus();
    toast.success(
      `已格式化当前章节：整理 ${result.paragraphCount} 段，合并 ${result.mergedLineCount} 处换行`
    );
  }, [toast]);

  const handleFileContextMenu = useCallback((event: ContextMenuEvent) => {
    setContextMenu({ x: event.x, y: event.y, target: { kind: 'file', node: event.node } });
  }, []);

  const handleObjectContextMenu = useCallback((event: ObjectContextMenuEvent) => {
    setContextMenu({ x: event.x, y: event.y, target: { kind: 'object', target: event.target } });
  }, []);

  const handleBackgroundContextMenu = useCallback((pos: { x: number; y: number }) => {
    setContextMenu({ x: pos.x, y: pos.y, target: { kind: 'background' } });
  }, []);

  const handleContentChange = useCallback((content: string) => {
    setEditorContent(content);
    const tab = activeTabRef.current;
    if (tab && isUntitledTabPath(tab)) {
      setUntitledTabContents((prev) => {
        if (prev[tab] === content) return prev;
        return { ...prev, [tab]: content };
      });
    }
  }, []);

  const handleCursorChange = useCallback((pos: CursorPosition) => {
    setCursorPosition(pos);
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleScrollProcessed = useCallback(() => {
    setScrollToLine(null);
  }, []);

  const handleTransientHighlightProcessed = useCallback(() => {
    setTransientHighlightLine(null);
  }, []);

  const handleScrollToLine = useCallback((line: number, contentKey?: string) => {
    setScrollToLine({ line, id: fnv1a32(contentKey ?? `line:${line}`) });
  }, []);

  const handleTransientHighlightLine = useCallback((line: number) => {
    setTransientHighlightLine({ line, id: fnv1a32(`line:${line}`) });
  }, []);

  const handleOpenSourceLocation = useCallback(
    (filePath: string, line: number, contentKey?: string) => {
      if (!filePath || line <= 0) return;
      if (!filePath.startsWith('__')) {
        if (focusMode) {
          setFocusMode(false);
        }
        if (sidebarCollapsedRef.current) {
          handleExpandSidebar();
        }
        setFilePanelRevealRequest({
          path: filePath,
          id: `reveal-${++filePanelRevealCounterRef.current}`,
        });
        openFileInTab(filePath);
      }
      handleScrollToLine(line, contentKey ?? `${filePath}:${line}`);
      handleTransientHighlightLine(line);
    },
    [
      focusMode,
      handleExpandSidebar,
      openFileInTab,
      handleScrollToLine,
      handleTransientHighlightLine,
    ]
  );

  const replaceIdRef = useRef(0);
  const handleReplaceLineText = useCallback((line: number, text: string) => {
    setReplaceLineRequest({ line, text, id: ++replaceIdRef.current });
  }, []);

  const handleDiffRequest = useCallback(
    (original: string, modified: string, originalLabel: string, modifiedLabel: string) => {
      const nextDiff: FixDiffState = { original, modified, originalLabel, modifiedLabel };
      dispatchFixCommand({ type: 'FIX_DIFF_VIEW_OPEN', diffState: nextDiff });
    },
    []
  );

  const handleCloseDiff = useCallback(() => {
    dispatchFixCommand({ type: 'FIX_CLEAR' });
  }, []);

  // 接受 AI 修复：写入文件并刷新编辑器
  const handleAcceptFix = useCallback(async () => {
    const fix = pendingApplyQueue[0] || null;
    if (!fix) return;
    dispatchFixCommand({ type: 'FIX_APPLY_STARTED' });
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    try {
      await ipc.invoke('write-file', fix.filePath, fix.content);

      // 强制同步：接受修改后总是打开并聚焦目标 tab，再更新编辑器与定位
      openFileInTab(fix.filePath);
      setEditorContent(fix.content);
      if (typeof fix.targetLine === 'number' && fix.targetLine > 0) {
        handleScrollToLine(fix.targetLine);
        handleTransientHighlightLine(fix.targetLine);
      }
      setEditorReloadToken((prev) => prev + 1);
    } catch {
      dispatchFixCommand({ type: 'FIX_APPLY_FAILED', error: '文件写入失败' });
      return;
    }
    dispatchFixCommand({ type: 'FIX_APPLY_SUCCEEDED' });
  }, [openFileInTab, handleScrollToLine, handleTransientHighlightLine, pendingApplyQueue]);

  const handleVersionRestore = useCallback(
    async (restoredFilePath: string) => {
      await refreshCurrentFolder();
      if (activeTabRef.current === restoredFilePath) {
        setEditorReloadToken((prev) => prev + 1);
      }
    },
    [refreshCurrentFolder]
  );

  return {
    handleFormatCurrentChapter,
    handleFileContextMenu,
    handleObjectContextMenu,
    handleBackgroundContextMenu,
    handleContentChange,
    handleCursorChange,
    handleCloseContextMenu,
    handleScrollProcessed,
    handleTransientHighlightProcessed,
    handleScrollToLine,
    handleTransientHighlightLine,
    handleOpenSourceLocation,
    handleReplaceLineText,
    handleDiffRequest,
    handleCloseDiff,
    handleAcceptFix,
    handleVersionRestore,
  };
}

export type EditorInteractions = ReturnType<typeof useEditorInteractions>;
