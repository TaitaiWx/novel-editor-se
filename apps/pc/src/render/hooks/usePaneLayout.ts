import React, { useCallback } from 'react';
import {
  CENTER_MIN,
  LEFT_COLLAPSED_WIDTH,
  LEFT_COLLAPSE_THRESHOLD,
  LEFT_MAX,
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
      const containerWidth = appMainRef.current?.offsetWidth ?? 0;

      let nextSidebarCollapsed = options?.nextSidebarCollapsed ?? sidebarCollapsedRef.current;
      let nextRightPanelCollapsed =
        options?.nextRightPanelCollapsed ?? rightPanelCollapsedRef.current;
      let nextLeftWidth = Math.min(LEFT_MAX, leftPanelWidthRef.current);
      let nextRightWidth = Math.min(RIGHT_MAX, rightPanelWidthRef.current);

      if (containerWidth > 0) {
        const availableForSides = Math.max(0, containerWidth - CENTER_MIN);
        // First pass: keep both sides visible whenever possible by shrinking widths.
        if (!nextSidebarCollapsed && !nextRightPanelCollapsed) {
          const desiredTotal = nextLeftWidth + nextRightWidth;
          if (desiredTotal > availableForSides) {
            if (options?.preferExpanding === 'right') {
              nextLeftWidth = Math.max(0, availableForSides - nextRightWidth);
              if (nextLeftWidth + nextRightWidth > availableForSides) {
                nextRightWidth = Math.max(0, availableForSides - nextLeftWidth);
              }
            } else {
              nextRightWidth = Math.max(0, availableForSides - nextLeftWidth);
              if (nextLeftWidth + nextRightWidth > availableForSides) {
                nextLeftWidth = Math.max(0, availableForSides - nextRightWidth);
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
            Math.max(0, availableForSides - RIGHT_COLLAPSED_WIDTH)
          );
          if (nextLeftWidth <= 0.5) nextSidebarCollapsed = true;
        } else if (nextSidebarCollapsed && !nextRightPanelCollapsed) {
          nextRightWidth = Math.min(
            RIGHT_MAX,
            Math.max(0, availableForSides - LEFT_COLLAPSED_WIDTH)
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
    [CENTER_MIN, LEFT_COLLAPSED_WIDTH, LEFT_MAX, RIGHT_COLLAPSED_WIDTH, RIGHT_MAX]
  );

  const handleExpandSidebar = useCallback(() => {
    resolvePaneLayout({ nextSidebarCollapsed: false, preferExpanding: 'left' });
  }, [resolvePaneLayout]);

  const handleCollapseSidebar = useCallback(() => {
    setSidebarCollapsed(true);
  }, []);

  const handleToggleSidebar = useCallback(() => {
    if (sidebarCollapsedRef.current) {
      handleExpandSidebar();
      return;
    }
    handleCollapseSidebar();
  }, [handleCollapseSidebar, handleExpandSidebar]);

  const handleLeftResizerMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
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
      const containerWidth = appMainRef.current?.offsetWidth ?? 0;
      const rightWidth = rightPanelCollapsedRef.current
        ? RIGHT_COLLAPSED_WIDTH
        : rightPanelWidthRef.current;
      const maxAllowed = containerWidth - CENTER_MIN - rightWidth;

      // Expanding left panel can force right panel to auto-collapse to preserve center minimum width.
      if (next > maxAllowed && !rightPanelCollapsedRef.current) {
        setRightPanelCollapsed(true);
        const maxAfterCollapse = containerWidth - CENTER_MIN - RIGHT_COLLAPSED_WIDTH;
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
  }, []);

  const handleRightResizerMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
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
      const containerWidth = appMainRef.current?.offsetWidth ?? 0;
      const leftWidth = sidebarCollapsedRef.current
        ? LEFT_COLLAPSED_WIDTH
        : leftPanelWidthRef.current;
      const maxAllowed = containerWidth - CENTER_MIN - leftWidth;

      // Expanding right panel can force left panel to auto-collapse to preserve center minimum width.
      if (next > maxAllowed && !sidebarCollapsedRef.current) {
        setSidebarCollapsed(true);
        const maxAfterCollapse = containerWidth - CENTER_MIN - LEFT_COLLAPSED_WIDTH;
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
  }, []);

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
  }, [resolvePaneLayout]);

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
