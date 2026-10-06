import React, { useCallback } from 'react';
import {
  CENTER_MIN,
  LEFT_COLLAPSED_WIDTH,
  LEFT_COLLAPSE_THRESHOLD,
  LEFT_MAX,
  PANE_CHROME,
  PANE_GAP,
  RIGHT_COLLAPSED_WIDTH,
  RIGHT_COLLAPSE_THRESHOLD,
  RIGHT_MAX,
} from '@/render/app/layoutConstants';
import type { LayoutState } from './state/useLayoutState';

export type UsePaneLayoutContext = Pick<
  LayoutState,
  | 'appMainRef'
  | 'leftPanelWidthRef'
  | 'rightPanelCollapsedRef'
  | 'rightPanelWidthRef'
  | 'setLeftPanelWidth'
  | 'setRightPanelCollapsed'
  | 'setRightPanelWidth'
  | 'setSidebarCollapsed'
  | 'sidebarCollapsedRef'
>;

/**
 * 三栏容器扣除左右外边距后，留给卡片与间距的宽度。
 * 容器未挂载时返回 0（调用方据此跳过空间分配，只做上限裁剪）。
 */
function getPaneInnerWidth(el: HTMLDivElement | null | undefined): number {
  const width = el?.offsetWidth ?? 0;
  return width > 0 ? Math.max(0, width - PANE_CHROME) : 0;
}

/**
 * 侧栏在水平方向上的占用：展开时 = 卡片宽度 + 与中间卡片之间的间距（拖拽把手）；
 * 折叠时 = 折叠条宽度（折叠条不是卡片，不额外留间距）。
 */
function sideFootprint(collapsed: boolean, width: number, collapsedWidth: number): number {
  return collapsed ? collapsedWidth : width + PANE_GAP;
}

/**
 * 三栏布局：折叠 / 展开、拖拽调整宽度、窗口尺寸变化时重新计算
 */
export function usePaneLayout(ctx: UsePaneLayoutContext) {
  const {
    appMainRef,
    leftPanelWidthRef,
    rightPanelCollapsedRef,
    rightPanelWidthRef,
    setLeftPanelWidth,
    setRightPanelCollapsed,
    setRightPanelWidth,
    setSidebarCollapsed,
    sidebarCollapsedRef,
  } = ctx;

  const resolvePaneLayout = useCallback(
    (options?: {
      nextSidebarCollapsed?: boolean;
      nextRightPanelCollapsed?: boolean;
      preferExpanding?: 'left' | 'right';
    }) => {
      const containerWidth = getPaneInnerWidth(appMainRef.current);

      let nextSidebarCollapsed = options?.nextSidebarCollapsed ?? sidebarCollapsedRef.current;
      let nextRightPanelCollapsed =
        options?.nextRightPanelCollapsed ?? rightPanelCollapsedRef.current;
      let nextLeftWidth = Math.min(LEFT_MAX, leftPanelWidthRef.current);
      let nextRightWidth = Math.min(RIGHT_MAX, rightPanelWidthRef.current);

      if (containerWidth > 0) {
        const availableForSides = Math.max(0, containerWidth - CENTER_MIN);
        // First pass: keep both sides visible whenever possible by shrinking widths.
        if (!nextSidebarCollapsed && !nextRightPanelCollapsed) {
          // 两侧卡片各自还要占用一段间距（拖拽把手）
          const cardBudget = Math.max(0, availableForSides - PANE_GAP * 2);
          const desiredTotal = nextLeftWidth + nextRightWidth;
          if (desiredTotal > cardBudget) {
            if (options?.preferExpanding === 'right') {
              nextLeftWidth = Math.max(0, cardBudget - nextRightWidth);
              if (nextLeftWidth + nextRightWidth > cardBudget) {
                nextRightWidth = Math.max(0, cardBudget - nextLeftWidth);
              }
            } else {
              nextRightWidth = Math.max(0, cardBudget - nextLeftWidth);
              if (nextLeftWidth + nextRightWidth > cardBudget) {
                nextLeftWidth = Math.max(0, cardBudget - nextRightWidth);
              }
            }
          }

          // Only collapse as a last resort when one side has effectively no drawable width.
          if (nextLeftWidth <= 0.5 && availableForSides > RIGHT_COLLAPSED_WIDTH) {
            nextSidebarCollapsed = true;
          }
          if (nextRightWidth <= 0.5 && availableForSides > LEFT_COLLAPSED_WIDTH) {
            nextRightPanelCollapsed = true;
          }
        }

        // Second pass: enforce center minimum with collapsed side widths if one side is hidden.
        if (!nextSidebarCollapsed && nextRightPanelCollapsed) {
          nextLeftWidth = Math.min(
            LEFT_MAX,
            Math.max(0, availableForSides - RIGHT_COLLAPSED_WIDTH - PANE_GAP)
          );
          if (nextLeftWidth <= 0.5) nextSidebarCollapsed = true;
        } else if (nextSidebarCollapsed && !nextRightPanelCollapsed) {
          nextRightWidth = Math.min(
            RIGHT_MAX,
            Math.max(0, availableForSides - LEFT_COLLAPSED_WIDTH - PANE_GAP)
          );
          if (nextRightWidth <= 0.5) nextRightPanelCollapsed = true;
        }
      }

      if (sidebarCollapsedRef.current !== nextSidebarCollapsed) {
        setSidebarCollapsed(nextSidebarCollapsed);
      }
      if (rightPanelCollapsedRef.current !== nextRightPanelCollapsed) {
        setRightPanelCollapsed(nextRightPanelCollapsed);
      }
      if (Math.abs(leftPanelWidthRef.current - nextLeftWidth) > 0.5) {
        setLeftPanelWidth(nextLeftWidth);
      }
      if (Math.abs(rightPanelWidthRef.current - nextRightWidth) > 0.5) {
        setRightPanelWidth(nextRightWidth);
      }
    },
    [
      appMainRef,
      leftPanelWidthRef,
      rightPanelCollapsedRef,
      rightPanelWidthRef,
      setLeftPanelWidth,
      setRightPanelCollapsed,
      setRightPanelWidth,
      setSidebarCollapsed,
      sidebarCollapsedRef,
    ]
  );

  const handleExpandSidebar = useCallback(() => {
    resolvePaneLayout({ nextSidebarCollapsed: false, preferExpanding: 'left' });
  }, [resolvePaneLayout]);

  const handleCollapseSidebar = useCallback(() => {
    setSidebarCollapsed(true);
  }, [setSidebarCollapsed]);

  const handleToggleSidebar = useCallback(() => {
    if (sidebarCollapsedRef.current) {
      handleExpandSidebar();
      return;
    }
    handleCollapseSidebar();
  }, [handleCollapseSidebar, handleExpandSidebar, sidebarCollapsedRef]);

  const handleLeftResizerMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = leftPanelWidthRef.current;
      const onMouseMove = (ev: MouseEvent) => {
        const next = startWidth + (ev.clientX - startX);
        // Auto-collapse when dragged below threshold (VSCode behavior)
        if (next < LEFT_COLLAPSE_THRESHOLD) {
          setSidebarCollapsed(true);
          return;
        }
        const containerWidth = getPaneInnerWidth(appMainRef.current);
        const rightWidth = sideFootprint(
          rightPanelCollapsedRef.current,
          rightPanelWidthRef.current,
          RIGHT_COLLAPSED_WIDTH
        );
        const maxAllowed = containerWidth - CENTER_MIN - rightWidth - PANE_GAP;

        // Expanding left panel can force right panel to auto-collapse to preserve center minimum width.
        if (next > maxAllowed && !rightPanelCollapsedRef.current) {
          setRightPanelCollapsed(true);
          const maxAfterCollapse = containerWidth - CENTER_MIN - RIGHT_COLLAPSED_WIDTH - PANE_GAP;
          setLeftPanelWidth(Math.min(LEFT_MAX, maxAfterCollapse, next));
          return;
        }

        setLeftPanelWidth(Math.min(LEFT_MAX, maxAllowed, next));
        if (sidebarCollapsedRef.current) setSidebarCollapsed(false);
      };
      const cleanup = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', cleanup);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', cleanup);
    },
    [
      appMainRef,
      leftPanelWidthRef,
      rightPanelCollapsedRef,
      rightPanelWidthRef,
      setLeftPanelWidth,
      setRightPanelCollapsed,
      setSidebarCollapsed,
      sidebarCollapsedRef,
    ]
  );

  const handleRightResizerMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = rightPanelWidthRef.current;
      const onMouseMove = (ev: MouseEvent) => {
        // Dragging the right resizer leftward enlarges the right panel
        const next = startWidth - (ev.clientX - startX);
        // Auto-collapse when dragged below threshold
        if (next < RIGHT_COLLAPSE_THRESHOLD) {
          setRightPanelCollapsed(true);
          return;
        }
        const containerWidth = getPaneInnerWidth(appMainRef.current);
        const leftWidth = sideFootprint(
          sidebarCollapsedRef.current,
          leftPanelWidthRef.current,
          LEFT_COLLAPSED_WIDTH
        );
        const maxAllowed = containerWidth - CENTER_MIN - leftWidth - PANE_GAP;

        // Expanding right panel can force left panel to auto-collapse to preserve center minimum width.
        if (next > maxAllowed && !sidebarCollapsedRef.current) {
          setSidebarCollapsed(true);
          const maxAfterCollapse = containerWidth - CENTER_MIN - LEFT_COLLAPSED_WIDTH - PANE_GAP;
          setRightPanelWidth(Math.min(RIGHT_MAX, maxAfterCollapse, next));
          return;
        }

        setRightPanelWidth(Math.min(RIGHT_MAX, maxAllowed, next));
        if (rightPanelCollapsedRef.current) setRightPanelCollapsed(false);
      };
      const cleanup = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', cleanup);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', cleanup);
    },
    [
      appMainRef,
      leftPanelWidthRef,
      rightPanelCollapsedRef,
      rightPanelWidthRef,
      setRightPanelCollapsed,
      setRightPanelWidth,
      setSidebarCollapsed,
      sidebarCollapsedRef,
    ]
  );

  React.useEffect(() => {
    const onResize = () => resolvePaneLayout();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [resolvePaneLayout]);

  const handleToggleRightPanel = useCallback(() => {
    if (rightPanelCollapsedRef.current) {
      resolvePaneLayout({ nextRightPanelCollapsed: false, preferExpanding: 'right' });
      return;
    }
    setRightPanelCollapsed(true);
  }, [resolvePaneLayout, rightPanelCollapsedRef, setRightPanelCollapsed]);

  return {
    resolvePaneLayout,
    handleExpandSidebar,
    handleCollapseSidebar,
    handleToggleSidebar,
    handleLeftResizerMouseDown,
    handleRightResizerMouseDown,
    handleToggleRightPanel,
  };
}

export type PaneLayoutApi = ReturnType<typeof usePaneLayout>;
