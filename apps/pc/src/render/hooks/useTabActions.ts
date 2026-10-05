import { useCallback } from 'react';
import { isUntitledTabPath } from '@/render/app/fileTreeUtils';
import type { AppState } from './useAppState';

export type UseTabActionsContext = Pick<
  AppState,
  | 'activeTabRef'
  | 'openTabsRef'
  | 'preFocusStateRef'
  | 'rightPanelCollapsedRef'
  | 'setActiveTab'
  | 'setFocusMode'
  | 'setOpenTabs'
  | 'setRightPanelCollapsed'
  | 'setSidebarCollapsed'
  | 'setUntitledTabContents'
  | 'sidebarCollapsedRef'
  | 'untitledCounterRef'
>;

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

  // Tab helpers
  const openFileInTab = useCallback((filePath: string) => {
    setOpenTabs((prev) => {
      if (prev.includes(filePath)) return prev;
      return [...prev, filePath];
    });
    setActiveTab(filePath);
  }, []);

  const closeTab = useCallback((filePath: string) => {
    setOpenTabs((prev) => {
      const newTabs = prev.filter((t) => t !== filePath);
      // If we're closing the active tab, activate adjacent tab
      if (activeTabRef.current === filePath) {
        const closedIndex = prev.indexOf(filePath);
        const nextTab = newTabs[Math.min(closedIndex, newTabs.length - 1)] || null;
        setActiveTab(nextTab);
      }
      return newTabs;
    });
    if (isUntitledTabPath(filePath)) {
      setUntitledTabContents((prev) => {
        if (!(filePath in prev)) return prev;
        const { [filePath]: _removed, ...rest } = prev;
        return rest;
      });
    }
  }, []);

  // Create new untitled tab (Cmd+N, like VS Code)
  const handleNewTab = useCallback(() => {
    const num = ++untitledCounterRef.current;
    const untitledPath = `__untitled__:Untitled-${num}`;
    setOpenTabs((prev) => [...prev, untitledPath]);
    setUntitledTabContents((prev) => ({ ...prev, [untitledPath]: '' }));
    setActiveTab(untitledPath);
  }, []);

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
  }, []);

  // ─── Tab 右键菜单操作 ─────────────────────────────────────────────
  const handleCloseOtherTabs = useCallback((filePath: string) => {
    setOpenTabs([filePath]);
    setActiveTab(filePath);
  }, []);

  const handleCloseAllTabs = useCallback(() => {
    setOpenTabs([]);
    setUntitledTabContents({});
    setActiveTab(null);
  }, []);

  const closeTabsByPredicate = useCallback((predicate: (tab: string) => boolean) => {
    setOpenTabs((prev) => prev.filter((tab) => !predicate(tab)));
    if (activeTabRef.current && predicate(activeTabRef.current)) {
      setActiveTab(null);
    }
  }, []);

  const handleCloseAllAndSave = useCallback(() => {
    // 先触发保存当前文件
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true })
    );
    // 短延迟后关闭所有标签，确保保存完成
    setTimeout(() => {
      setOpenTabs([]);
      setActiveTab(null);
    }, 200);
  }, []);

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
