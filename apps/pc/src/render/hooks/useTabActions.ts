import { useCallback, useRef } from 'react';
import { getActiveEditor } from '@/render/components/TextEditor/active-editor';
import type { UiState } from './state/useUiState';
import { isUntitledTabPath } from '@/render/app/fileTreeUtils';
import type { TabsState } from './state/useTabsState';
import type { LayoutState } from './state/useLayoutState';

export type UseTabActionsContext = Pick<
  TabsState,
  | 'activeTabRef'
  | 'openTabsRef'
  | 'setActiveTab'
  | 'setOpenTabs'
  | 'setUntitledTabContents'
  | 'untitledCounterRef'
  | 'untitledTabContents'
> &
  Pick<
    LayoutState,
    | 'preFocusStateRef'
    | 'rightPanelCollapsedRef'
    | 'setFocusMode'
    | 'setRightPanelCollapsed'
    | 'setSidebarCollapsed'
    | 'sidebarCollapsedRef'
  > &
  Pick<UiState, 'dialog' | 'toast'>;

/**
 * 标签页操作：打开、关闭、新建未命名标签、专注模式切换等
 */
export function useTabActions(ctx: UseTabActionsContext) {
  const {
    activeTabRef,
    openTabsRef,
    preFocusStateRef,
    rightPanelCollapsedRef,
    setActiveTab,
    setFocusMode,
    setOpenTabs,
    setRightPanelCollapsed,
    setSidebarCollapsed,
    setUntitledTabContents,
    sidebarCollapsedRef,
    untitledCounterRef,
  } = ctx;

  const latest = useRef(ctx);
  latest.current = ctx;
  const closingRef = useRef(false);

  // 删除标签和草稿必须发生在用户确认、实际保存完成之后。
  const commitClose = useCallback(
    (paths: readonly string[], preferred?: string | null) => {
      const targets = new Set(paths);
      setOpenTabs((prev) => {
        const next = prev.filter((item) => !targets.has(item));
        if (preferred && next.includes(preferred)) setActiveTab(preferred);
        else if (activeTabRef.current && targets.has(activeTabRef.current)) {
          const index = prev.indexOf(activeTabRef.current);
          setActiveTab(
            preferred === null ? null : (next[Math.min(index, next.length - 1)] ?? null)
          );
        }
        return next;
      });
      setUntitledTabContents((prev) => {
        const entries = Object.entries(prev).filter(
          ([key, value]) =>
            !targets.has(key) && (value.length > 0 || openTabsRef.current.includes(key))
        );
        return entries.length === Object.keys(prev).length ? prev : Object.fromEntries(entries);
      });
    },
    [activeTabRef, openTabsRef, setActiveTab, setOpenTabs, setUntitledTabContents]
  );

  const requestClose = useCallback(
    (paths: readonly string[], preferred?: string | null, saveMounted = true) => {
      if (closingRef.current) return;
      const drafts = paths.filter(
        (item) =>
          isUntitledTabPath(item) && (latest.current.untitledTabContents[item]?.length ?? 0) > 0
      );
      const editor = getActiveEditor();
      const snapshot = editor?.getSnapshot();
      const needsSave =
        saveMounted &&
        snapshot?.filePath &&
        paths.includes(snapshot.filePath) &&
        !snapshot.readOnly &&
        !isUntitledTabPath(snapshot.filePath);
      if (!drafts.length && !needsSave) {
        commitClose(paths, preferred);
        return;
      }
      closingRef.current = true;
      const untitledPaths = paths.filter(isUntitledTabPath);
      const originalDrafts = untitledPaths.map((item) => latest.current.untitledTabContents[item]);
      const draftsChanged = () =>
        untitledPaths.some(
          (item, index) => latest.current.untitledTabContents[item] !== originalDrafts[index]
        );
      return (async () => {
        try {
          if (drafts.length) {
            const confirmed = await latest.current.dialog.confirm(
              '关闭未保存的草稿',
              `有 ${drafts.length} 篇草稿尚未保存。确定放弃这些内容并关闭？取消后可以先保存。`
            );
            if (!confirmed) return;
            if (draftsChanged()) {
              latest.current.toast.info('草稿内容已变化，请重新确认后关闭');
              return;
            }
          }
          if (needsSave && (await editor!.save()) !== true) return;
          if (draftsChanged()) {
            latest.current.toast.info('草稿内容已变化，请重新确认后关闭');
            return;
          }
          commitClose(paths, preferred);
        } catch {
          latest.current.toast.error('保存失败，已保留标签和草稿');
        } finally {
          closingRef.current = false;
        }
      })();
    },
    [commitClose]
  );

  // Tab helpers
  const openFileInTab = useCallback(
    (filePath: string) => {
      setOpenTabs((prev) => {
        if (prev.includes(filePath)) return prev;
        return [...prev, filePath];
      });
      setActiveTab(filePath);
    },
    [setActiveTab, setOpenTabs]
  );

  const closeTab = useCallback((filePath: string) => requestClose([filePath]), [requestClose]);

  // Create new untitled tab (Cmd+N, like VS Code)
  const handleNewTab = useCallback(() => {
    const num = ++untitledCounterRef.current;
    const untitledPath = `__untitled__:Untitled-${num}`;
    setOpenTabs((prev) => [...prev, untitledPath]);
    setUntitledTabContents((prev) => ({ ...prev, [untitledPath]: '' }));
    setActiveTab(untitledPath);
  }, [setActiveTab, setOpenTabs, setUntitledTabContents, untitledCounterRef]);

  // Focus mode toggle (uses refs for stable closure — no deps on panel state)
  const toggleFocusMode = useCallback(() => {
    setFocusMode((prev) => {
      if (!prev) {
        // 进入专注模式：如果没有打开的 tab，自动新建一个
        if (openTabsRef.current.length === 0) {
          const num = ++untitledCounterRef.current;
          const untitledPath = `__untitled__:Untitled-${num}`;
          setOpenTabs([untitledPath]);
          setUntitledTabContents((prev) => ({ ...prev, [untitledPath]: '' }));
          setActiveTab(untitledPath);
        }
        preFocusStateRef.current = {
          sidebarCollapsed: sidebarCollapsedRef.current,
          rightPanelCollapsed: rightPanelCollapsedRef.current,
        };
        setSidebarCollapsed(true);
        setRightPanelCollapsed(true);
      } else {
        setSidebarCollapsed(preFocusStateRef.current.sidebarCollapsed);
        setRightPanelCollapsed(preFocusStateRef.current.rightPanelCollapsed);
      }
      return !prev;
    });
  }, [
    openTabsRef,
    preFocusStateRef,
    rightPanelCollapsedRef,
    setActiveTab,
    setFocusMode,
    setOpenTabs,
    setRightPanelCollapsed,
    setSidebarCollapsed,
    setUntitledTabContents,
    sidebarCollapsedRef,
    untitledCounterRef,
  ]);

  // ─── Tab 右键菜单操作 ─────────────────────────────────────────────
  const handleCloseOtherTabs = useCallback(
    (filePath: string) =>
      requestClose(
        openTabsRef.current.filter((item) => item !== filePath),
        filePath
      ),
    [openTabsRef, requestClose]
  );

  const handleCloseAllTabs = useCallback(
    () => requestClose(openTabsRef.current),
    [openTabsRef, requestClose]
  );

  // 文件删除等操作已由各自入口确认；这里也保护任何未保存稿。
  const closeTabsByPredicate = useCallback(
    (predicate: (tab: string) => boolean) =>
      requestClose(openTabsRef.current.filter(predicate), null, false),
    [openTabsRef, requestClose]
  );

  const handleCloseAllAndSave = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    try {
      const editor = getActiveEditor();
      const snapshot = editor?.getSnapshot();
      if (snapshot?.filePath && !snapshot.readOnly && (await editor!.save()) !== true) return;
      const drafts = openTabsRef.current.filter(
        (item) =>
          isUntitledTabPath(item) && (latest.current.untitledTabContents[item]?.length ?? 0) > 0
      );
      if (drafts.length) {
        latest.current.toast.info('仍有未保存的草稿，请先逐篇保存，再关闭所有标签');
        return;
      }
      commitClose(openTabsRef.current);
    } catch {
      latest.current.toast.error('保存失败，已保留标签和草稿');
    } finally {
      closingRef.current = false;
    }
  }, [commitClose, openTabsRef]);

  return {
    openFileInTab,
    closeTab,
    handleNewTab,
    toggleFocusMode,
    handleCloseOtherTabs,
    handleCloseAllTabs,
    closeTabsByPredicate,
    handleCloseAllAndSave,
  };
}

export type TabActions = ReturnType<typeof useTabActions>;
