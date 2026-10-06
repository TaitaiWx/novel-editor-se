// @vitest-environment happy-dom
import type React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePaneLayout, type UsePaneLayoutContext } from '@/render/hooks/usePaneLayout';
import {
  CENTER_MIN,
  LEFT_COLLAPSED_WIDTH,
  LEFT_MAX,
  PANE_CHROME,
  PANE_GAP,
  RIGHT_COLLAPSED_WIDTH,
  RIGHT_MAX,
} from '@/render/app/layoutConstants';

interface LayoutState {
  containerWidth: number;
  sidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  leftWidth: number;
  rightWidth: number;
}

/** 容器宽度扣除左右外边距后的可用宽度 */
const inner = (containerWidth: number) => containerWidth - PANE_CHROME;

/** 构造一个用 ref 模拟状态的上下文：setter 会同步写回 ref，便于观察 */
function createCtx(initial: LayoutState) {
  const state = { ...initial };
  const appMain = { offsetWidth: initial.containerWidth } as unknown as HTMLDivElement;
  const appMainRef = { current: appMain as HTMLDivElement | null };
  const sidebarCollapsedRef = { current: state.sidebarCollapsed };
  const rightPanelCollapsedRef = { current: state.rightPanelCollapsed };
  const leftPanelWidthRef = { current: state.leftWidth };
  const rightPanelWidthRef = { current: state.rightWidth };
  const setSidebarCollapsed = vi.fn((v: boolean) => {
    sidebarCollapsedRef.current = v;
  });
  const setRightPanelCollapsed = vi.fn((v: boolean) => {
    rightPanelCollapsedRef.current = v;
  });
  const setLeftPanelWidth = vi.fn((v: number) => {
    leftPanelWidthRef.current = v;
  });
  const setRightPanelWidth = vi.fn((v: number) => {
    rightPanelWidthRef.current = v;
  });
  const ctx = {
    appMainRef,
    leftPanelWidthRef,
    rightPanelCollapsedRef,
    rightPanelWidthRef,
    setLeftPanelWidth,
    setRightPanelCollapsed,
    setRightPanelWidth,
    setSidebarCollapsed,
    sidebarCollapsedRef,
  } as unknown as UsePaneLayoutContext;
  return {
    ctx,
    appMainRef,
    sidebarCollapsedRef,
    rightPanelCollapsedRef,
    leftPanelWidthRef,
    rightPanelWidthRef,
    setSidebarCollapsed,
    setRightPanelCollapsed,
    setLeftPanelWidth,
    setRightPanelWidth,
  };
}

function mouseDown(clientX: number) {
  const preventDefault = vi.fn();
  return {
    event: { clientX, preventDefault } as unknown as React.MouseEvent<HTMLDivElement>,
    preventDefault,
  };
}

function move(clientX: number) {
  window.dispatchEvent(new MouseEvent('mousemove', { clientX }));
}

describe('usePaneLayout', () => {
  afterEach(() => {
    window.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('容器足够宽时 resolvePaneLayout 不改变任何状态', () => {
    const c = createCtx({
      containerWidth: 1600,
      sidebarCollapsed: false,
      rightPanelCollapsed: false,
      leftWidth: 260,
      rightWidth: 300,
    });
    const { result } = renderHook(() => usePaneLayout(c.ctx));
    act(() => result.current.resolvePaneLayout());
    expect(c.setSidebarCollapsed).not.toHaveBeenCalled();
    expect(c.setRightPanelCollapsed).not.toHaveBeenCalled();
    expect(c.setLeftPanelWidth).not.toHaveBeenCalled();
    expect(c.setRightPanelWidth).not.toHaveBeenCalled();
  });

  it('宽度超过上限时被裁剪到 LEFT_MAX / RIGHT_MAX', () => {
    const c = createCtx({
      containerWidth: 3000,
      sidebarCollapsed: false,
      rightPanelCollapsed: false,
      leftWidth: 900,
      rightWidth: 900,
    });
    const { result } = renderHook(() => usePaneLayout(c.ctx));
    act(() => result.current.resolvePaneLayout());
    expect(c.setLeftPanelWidth).toHaveBeenCalledWith(LEFT_MAX);
    expect(c.setRightPanelWidth).toHaveBeenCalledWith(RIGHT_MAX);
  });

  it('空间不足时默认优先缩小右侧面板', () => {
    const c = createCtx({
      containerWidth: 800,
      sidebarCollapsed: false,
      rightPanelCollapsed: false,
      leftWidth: 300,
      rightWidth: 300,
    });
    const { result } = renderHook(() => usePaneLayout(c.ctx));
    act(() => result.current.resolvePaneLayout());
    // 两侧卡片预算 = 784 - 320 - 2 × 间距 = 448 → right = 148
    expect(c.setRightPanelWidth).toHaveBeenCalledWith(inner(800) - CENTER_MIN - PANE_GAP * 2 - 300);
    expect(c.setLeftPanelWidth).not.toHaveBeenCalled();
  });

  it('preferExpanding=right 时优先缩小左侧面板', () => {
    const c = createCtx({
      containerWidth: 800,
      sidebarCollapsed: false,
      rightPanelCollapsed: false,
      leftWidth: 300,
      rightWidth: 300,
    });
    const { result } = renderHook(() => usePaneLayout(c.ctx));
    act(() => result.current.resolvePaneLayout({ preferExpanding: 'right' }));
    expect(c.setLeftPanelWidth).toHaveBeenCalledWith(inner(800) - CENTER_MIN - PANE_GAP * 2 - 300);
    expect(c.setRightPanelWidth).not.toHaveBeenCalled();
  });

  it('一侧完全没有空间时折叠该侧', () => {
    const c = createCtx({
      containerWidth: 700,
      sidebarCollapsed: false,
      rightPanelCollapsed: false,
      leftWidth: 400,
      rightWidth: 300,
    });
    const { result } = renderHook(() => usePaneLayout(c.ctx));
    act(() => result.current.resolvePaneLayout());
    // 右侧被挤到 0 → 折叠右侧；左侧 = 可用宽度 - 折叠条 - 一段间距
    expect(c.setRightPanelCollapsed).toHaveBeenCalledWith(true);
    expect(c.leftPanelWidthRef.current).toBe(
      inner(700) - CENTER_MIN - RIGHT_COLLAPSED_WIDTH - PANE_GAP
    );
  });

  it('只有左侧展开时左侧宽度占满可用空间', () => {
    const c = createCtx({
      containerWidth: 600,
      sidebarCollapsed: false,
      rightPanelCollapsed: true,
      leftWidth: 400,
      rightWidth: 300,
    });
    const { result } = renderHook(() => usePaneLayout(c.ctx));
    act(() => result.current.resolvePaneLayout());
    expect(c.setLeftPanelWidth).toHaveBeenCalledWith(
      inner(600) - CENTER_MIN - RIGHT_COLLAPSED_WIDTH - PANE_GAP
    );
  });

  it('只有右侧展开且空间不足时折叠右侧', () => {
    const c = createCtx({
      containerWidth: 340,
      sidebarCollapsed: true,
      rightPanelCollapsed: false,
      leftWidth: 200,
      rightWidth: 300,
    });
    const { result } = renderHook(() => usePaneLayout(c.ctx));
    act(() => result.current.resolvePaneLayout());
    expect(c.setRightPanelCollapsed).toHaveBeenCalledWith(true);
  });

  it('只有右侧展开时右侧宽度占满可用空间', () => {
    const c = createCtx({
      containerWidth: 600,
      sidebarCollapsed: true,
      rightPanelCollapsed: false,
      leftWidth: 200,
      rightWidth: 400,
    });
    const { result } = renderHook(() => usePaneLayout(c.ctx));
    act(() => result.current.resolvePaneLayout());
    expect(c.setRightPanelWidth).toHaveBeenCalledWith(
      inner(600) - CENTER_MIN - LEFT_COLLAPSED_WIDTH - PANE_GAP
    );
  });

  it('容器宽度为 0 时只做上限裁剪', () => {
    const c = createCtx({
      containerWidth: 0,
      sidebarCollapsed: false,
      rightPanelCollapsed: false,
      leftWidth: 300,
      rightWidth: 300,
    });
    c.appMainRef.current = null;
    const { result } = renderHook(() => usePaneLayout(c.ctx));
    act(() => result.current.resolvePaneLayout());
    expect(c.setLeftPanelWidth).not.toHaveBeenCalled();
    expect(c.setRightPanelWidth).not.toHaveBeenCalled();
  });

  it('handleToggleSidebar 在折叠/展开间切换', () => {
    const c = createCtx({
      containerWidth: 1600,
      sidebarCollapsed: true,
      rightPanelCollapsed: false,
      leftWidth: 260,
      rightWidth: 300,
    });
    const { result } = renderHook(() => usePaneLayout(c.ctx));
    act(() => result.current.handleToggleSidebar());
    expect(c.setSidebarCollapsed).toHaveBeenLastCalledWith(false);
    act(() => result.current.handleToggleSidebar());
    expect(c.setSidebarCollapsed).toHaveBeenLastCalledWith(true);
  });

  it('handleToggleRightPanel 在折叠/展开间切换', () => {
    const c = createCtx({
      containerWidth: 1600,
      sidebarCollapsed: false,
      rightPanelCollapsed: true,
      leftWidth: 260,
      rightWidth: 300,
    });
    const { result } = renderHook(() => usePaneLayout(c.ctx));
    act(() => result.current.handleToggleRightPanel());
    expect(c.setRightPanelCollapsed).toHaveBeenLastCalledWith(false);
    act(() => result.current.handleToggleRightPanel());
    expect(c.setRightPanelCollapsed).toHaveBeenLastCalledWith(true);
  });

  it('窗口 resize 时重新计算布局，卸载后不再响应', () => {
    const c = createCtx({
      containerWidth: 1600,
      sidebarCollapsed: false,
      rightPanelCollapsed: false,
      leftWidth: 300,
      rightWidth: 300,
    });
    const { unmount } = renderHook(() => usePaneLayout(c.ctx));
    (c.appMainRef.current as unknown as { offsetWidth: number }).offsetWidth = 800;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(c.setRightPanelWidth).toHaveBeenCalledWith(inner(800) - CENTER_MIN - PANE_GAP * 2 - 300);
    unmount();
    c.setRightPanelWidth.mockClear();
    (c.appMainRef.current as unknown as { offsetWidth: number }).offsetWidth = 700;
    window.dispatchEvent(new Event('resize'));
    expect(c.setRightPanelWidth).not.toHaveBeenCalled();
  });

  it('两侧都展开时为两段卡片间距预留空间，刚好放得下时不做调整', () => {
    const left = 260;
    const right = 300;
    const exact = PANE_CHROME + left + PANE_GAP + CENTER_MIN + PANE_GAP + right;
    const c = createCtx({
      containerWidth: exact,
      sidebarCollapsed: false,
      rightPanelCollapsed: false,
      leftWidth: left,
      rightWidth: right,
    });
    const { result } = renderHook(() => usePaneLayout(c.ctx));
    act(() => result.current.resolvePaneLayout());
    expect(c.setRightPanelWidth).not.toHaveBeenCalled();
    expect(c.setLeftPanelWidth).not.toHaveBeenCalled();

    // 再窄 1px，就要从右侧卡片扣掉 1px
    (c.appMainRef.current as unknown as { offsetWidth: number }).offsetWidth = exact - 1;
    act(() => result.current.resolvePaneLayout());
    expect(c.setRightPanelWidth).toHaveBeenCalledWith(right - 1);
  });

  it('拖拽时最大宽度扣除外边距与两段间距', () => {
    const c = createCtx({
      containerWidth: 1100,
      sidebarCollapsed: false,
      rightPanelCollapsed: false,
      leftWidth: 260,
      rightWidth: 300,
    });
    const { result } = renderHook(() => usePaneLayout(c.ctx));
    act(() => result.current.handleLeftResizerMouseDown(mouseDown(0).event));
    const maxAllowed = inner(1100) - CENTER_MIN - (300 + PANE_GAP) - PANE_GAP;
    move(maxAllowed - 260); // 刚好拖到上限
    expect(c.setLeftPanelWidth).toHaveBeenLastCalledWith(maxAllowed);
    expect(c.setRightPanelCollapsed).not.toHaveBeenCalled();
  });

  describe('左侧拖拽', () => {
    it('拖拽调整宽度、设置光标样式，mouseup 后清理', () => {
      const c = createCtx({
        containerWidth: 1600,
        sidebarCollapsed: false,
        rightPanelCollapsed: false,
        leftWidth: 260,
        rightWidth: 300,
      });
      const { result } = renderHook(() => usePaneLayout(c.ctx));
      const { event, preventDefault } = mouseDown(100);
      act(() => result.current.handleLeftResizerMouseDown(event));
      expect(preventDefault).toHaveBeenCalled();
      expect(document.body.style.cursor).toBe('col-resize');
      move(140);
      expect(c.setLeftPanelWidth).toHaveBeenLastCalledWith(300);
      window.dispatchEvent(new MouseEvent('mouseup'));
      expect(document.body.style.cursor).toBe('');
      c.setLeftPanelWidth.mockClear();
      move(200);
      expect(c.setLeftPanelWidth).not.toHaveBeenCalled();
    });

    it('拖到阈值以下自动折叠', () => {
      const c = createCtx({
        containerWidth: 1600,
        sidebarCollapsed: false,
        rightPanelCollapsed: false,
        leftWidth: 260,
        rightWidth: 300,
      });
      const { result } = renderHook(() => usePaneLayout(c.ctx));
      act(() => result.current.handleLeftResizerMouseDown(mouseDown(300).event));
      move(100);
      expect(c.setSidebarCollapsed).toHaveBeenCalledWith(true);
    });

    it('拖得过宽时折叠右侧面板以保证中间最小宽度', () => {
      const c = createCtx({
        containerWidth: 1000,
        sidebarCollapsed: false,
        rightPanelCollapsed: false,
        leftWidth: 260,
        rightWidth: 300,
      });
      const { result } = renderHook(() => usePaneLayout(c.ctx));
      act(() => result.current.handleLeftResizerMouseDown(mouseDown(0).event));
      move(200); // next = 460 > 984 - 320 - (300 + 8) - 8 = 348
      expect(c.setRightPanelCollapsed).toHaveBeenCalledWith(true);
      expect(c.setLeftPanelWidth).toHaveBeenLastCalledWith(
        Math.min(LEFT_MAX, inner(1000) - CENTER_MIN - RIGHT_COLLAPSED_WIDTH - PANE_GAP, 460)
      );
    });

    it('从折叠状态拖拽展开', () => {
      const c = createCtx({
        containerWidth: 1600,
        sidebarCollapsed: true,
        rightPanelCollapsed: true,
        leftWidth: 200,
        rightWidth: 300,
      });
      const { result } = renderHook(() => usePaneLayout(c.ctx));
      act(() => result.current.handleLeftResizerMouseDown(mouseDown(0).event));
      move(50);
      expect(c.setLeftPanelWidth).toHaveBeenLastCalledWith(250);
      expect(c.setSidebarCollapsed).toHaveBeenCalledWith(false);
    });
  });

  describe('右侧拖拽', () => {
    it('向左拖拽放大右侧面板', () => {
      const c = createCtx({
        containerWidth: 1600,
        sidebarCollapsed: false,
        rightPanelCollapsed: false,
        leftWidth: 260,
        rightWidth: 300,
      });
      const { result } = renderHook(() => usePaneLayout(c.ctx));
      act(() => result.current.handleRightResizerMouseDown(mouseDown(1000).event));
      move(950);
      expect(c.setRightPanelWidth).toHaveBeenLastCalledWith(350);
    });

    it('拖到阈值以下自动折叠', () => {
      const c = createCtx({
        containerWidth: 1600,
        sidebarCollapsed: false,
        rightPanelCollapsed: false,
        leftWidth: 260,
        rightWidth: 300,
      });
      const { result } = renderHook(() => usePaneLayout(c.ctx));
      act(() => result.current.handleRightResizerMouseDown(mouseDown(1000).event));
      move(1200);
      expect(c.setRightPanelCollapsed).toHaveBeenCalledWith(true);
    });

    it('拖得过宽时折叠左侧面板', () => {
      const c = createCtx({
        containerWidth: 1000,
        sidebarCollapsed: false,
        rightPanelCollapsed: false,
        leftWidth: 300,
        rightWidth: 300,
      });
      const { result } = renderHook(() => usePaneLayout(c.ctx));
      act(() => result.current.handleRightResizerMouseDown(mouseDown(1000).event));
      move(800); // next = 500 > 984 - 320 - (300 + 8) - 8 = 348
      expect(c.setSidebarCollapsed).toHaveBeenCalledWith(true);
      expect(c.setRightPanelWidth).toHaveBeenLastCalledWith(
        Math.min(RIGHT_MAX, inner(1000) - CENTER_MIN - LEFT_COLLAPSED_WIDTH - PANE_GAP, 500)
      );
    });

    it('从折叠状态拖拽展开', () => {
      const c = createCtx({
        containerWidth: 1600,
        sidebarCollapsed: true,
        rightPanelCollapsed: true,
        leftWidth: 260,
        rightWidth: 200,
      });
      const { result } = renderHook(() => usePaneLayout(c.ctx));
      act(() => result.current.handleRightResizerMouseDown(mouseDown(1000).event));
      move(900);
      expect(c.setRightPanelWidth).toHaveBeenLastCalledWith(300);
      expect(c.setRightPanelCollapsed).toHaveBeenCalledWith(false);
    });
  });
});
