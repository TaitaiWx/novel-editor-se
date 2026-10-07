import { useCallback, useEffect, useRef } from 'react';
import {
  REVEAL_IN_FILE_PANEL_EVENT,
  type RevealInFilePanelDetail,
} from '@/render/utils/workspaceFiles';
import type { ContextMenuEvent } from '@/render/components/FileTree';
import type { CursorPosition } from '@/render/app/types';
import { EditorSelection } from '@codemirror/state';
import type { FixDiffState } from '@/render/state/fixSessionState';
import type { ObjectContextMenuEvent } from '@/render/components/FilePanel';
import { fnv1a32 } from '@/render/components/RightPanel/utils';
import { formatChapterContent } from '@/render/utils/chapterFormatter';
import { isUntitledTabPath } from '@/render/app/fileTreeUtils';
import type { TabsState } from './state/useTabsState';
import type { LayoutState } from './state/useLayoutState';
import type { EditorState } from './state/useEditorState';
import type { AiSessionState } from './state/useAiSessionState';
import type { UiState } from './state/useUiState';
import type { PaneLayoutApi } from './usePaneLayout';
import type { TabActions } from './useTabActions';
import type { ProjectLoaderApi } from './useProjectLoader';
import type { WorkScopeApi } from './useWorkScope';

export type UseEditorInteractionsContext = Pick<
  TabsState,
  'activeTabRef' | 'setUntitledTabContents'
> &
  Pick<LayoutState, 'focusMode' | 'setFocusMode' | 'sidebarCollapsedRef'> &
  Pick<
    EditorState,
    | 'editorViewRef'
    | 'setCursorPosition'
    | 'setEditorContent'
    | 'setEditorReloadToken'
    | 'setReplaceLineRequest'
    | 'setScrollToLine'
    | 'setTransientHighlightLine'
  > &
  Pick<AiSessionState, 'dispatchFixCommand' | 'pendingApplyQueue'> &
  Pick<
    UiState,
    'filePanelRevealCounterRef' | 'setContextMenu' | 'setFilePanelRevealRequest' | 'toast'
  > &
  Pick<PaneLayoutApi, 'handleExpandSidebar'> &
  Pick<TabActions, 'openFileInTab'> &
  Pick<ProjectLoaderApi, 'refreshCurrentFolder'> &
  Partial<Pick<WorkScopeApi, 'selectWorkForPath'>>;

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
    selectWorkForPath,
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
  }, [activeTabRef, editorViewRef, toast]);

  const handleFileContextMenu = useCallback(
    (event: ContextMenuEvent) => {
      setContextMenu({ x: event.x, y: event.y, target: { kind: 'file', node: event.node } });
    },
    [setContextMenu]
  );

  const handleObjectContextMenu = useCallback(
    (event: ObjectContextMenuEvent) => {
      setContextMenu({ x: event.x, y: event.y, target: { kind: 'object', target: event.target } });
    },
    [setContextMenu]
  );

  const handleBackgroundContextMenu = useCallback(
    (pos: { x: number; y: number }) => {
      setContextMenu({ x: pos.x, y: pos.y, target: { kind: 'background' } });
    },
    [setContextMenu]
  );

  const handleContentChange = useCallback(
    (content: string) => {
      setEditorContent(content);
      const tab = activeTabRef.current;
      if (tab && isUntitledTabPath(tab)) {
        setUntitledTabContents((prev) => {
          if (prev[tab] === content) return prev;
          return { ...prev, [tab]: content };
        });
      }
    },
    [activeTabRef, setEditorContent, setUntitledTabContents]
  );

  const handleCursorChange = useCallback(
    (pos: CursorPosition) => {
      setCursorPosition(pos);
    },
    [setCursorPosition]
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, [setContextMenu]);

  const handleScrollProcessed = useCallback(() => {
    setScrollToLine(null);
  }, [setScrollToLine]);

  const handleTransientHighlightProcessed = useCallback(() => {
    setTransientHighlightLine(null);
  }, [setTransientHighlightLine]);

  const handleScrollToLine = useCallback(
    (line: number, contentKey?: string) => {
      setScrollToLine({ line, id: fnv1a32(contentKey ?? `line:${line}`) });
    },
    [setScrollToLine]
  );

  const handleTransientHighlightLine = useCallback(
    (line: number) => {
      setTransientHighlightLine({ line, id: fnv1a32(`line:${line}`) });
    },
    [setTransientHighlightLine]
  );

  // 其他视图请求「在资料中定位」（例如场景视频的成片、参考窗格）：退出专注模式、展开侧边栏，
  // 文件属于其他作品时先切换作品，再由文件面板展开祖先目录、滚动到该行并高亮
  useEffect(() => {
    const onReveal = (event: Event) => {
      const path = (event as CustomEvent<RevealInFilePanelDetail>).detail?.path;
      if (!path) return;
      selectWorkForPath?.(path);
      if (focusMode) setFocusMode(false);
      if (sidebarCollapsedRef.current) handleExpandSidebar();
      setFilePanelRevealRequest({ path, id: `reveal-${++filePanelRevealCounterRef.current}` });
    };
    window.addEventListener(REVEAL_IN_FILE_PANEL_EVENT, onReveal);
    return () => window.removeEventListener(REVEAL_IN_FILE_PANEL_EVENT, onReveal);
  }, [
    filePanelRevealCounterRef,
    focusMode,
    handleExpandSidebar,
    selectWorkForPath,
    setFilePanelRevealRequest,
    setFocusMode,
    sidebarCollapsedRef,
  ]);

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
      handleScrollToLine,
      handleTransientHighlightLine,
      focusMode,
      sidebarCollapsedRef,
      setFilePanelRevealRequest,
      filePanelRevealCounterRef,
      openFileInTab,
      setFocusMode,
      handleExpandSidebar,
    ]
  );

  const replaceIdRef = useRef(0);
  const handleReplaceLineText = useCallback(
    (line: number, text: string) => {
      setReplaceLineRequest({ line, text, id: ++replaceIdRef.current });
    },
    [setReplaceLineRequest]
  );

  const handleDiffRequest = useCallback(
    (original: string, modified: string, originalLabel: string, modifiedLabel: string) => {
      const nextDiff: FixDiffState = { original, modified, originalLabel, modifiedLabel };
      dispatchFixCommand({ type: 'FIX_DIFF_VIEW_OPEN', diffState: nextDiff });
    },
    [dispatchFixCommand]
  );

  const handleCloseDiff = useCallback(() => {
    dispatchFixCommand({ type: 'FIX_CLEAR' });
  }, [dispatchFixCommand]);

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
  }, [
    pendingApplyQueue,
    dispatchFixCommand,
    openFileInTab,
    setEditorContent,
    setEditorReloadToken,
    handleScrollToLine,
    handleTransientHighlightLine,
  ]);

  const handleVersionRestore = useCallback(
    async (restoredFilePath: string) => {
      await refreshCurrentFolder();
      if (activeTabRef.current === restoredFilePath) {
        setEditorReloadToken((prev) => prev + 1);
      }
    },
    [activeTabRef, refreshCurrentFolder, setEditorReloadToken]
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
