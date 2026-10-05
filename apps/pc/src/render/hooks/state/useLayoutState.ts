import { useRef, useState } from 'react';
import { DEFAULT_SETTINGS_DRAFT } from '@/render/utils/appSettings';

/**
 * 布局领域状态：左右面板折叠/宽度、右侧面板弹出、专注模式，
 * 以及布局容器与侧边栏焦点相关 ref（只声明，不含副作用）
 */
export function useLayoutState() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(
    DEFAULT_SETTINGS_DRAFT.general.collapseRightPanelOnStartup
  );
  const [rightPanelPoppedOut, setRightPanelPoppedOut] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(260);
  const [rightPanelWidth, setRightPanelWidth] = useState(300);

  // 记录进入专注模式前的面板状态，退出时恢复
  const preFocusStateRef = useRef({
    sidebarCollapsed: false,
    rightPanelCollapsed: DEFAULT_SETTINGS_DRAFT.general.collapseRightPanelOnStartup,
  });

  // 侧边栏焦点跟踪（VS Code 风格：mousedown 判断是否在侧边栏区域内）
  const sidebarRef = useRef<HTMLDivElement>(null);
  const appMainRef = useRef<HTMLDivElement>(null);
  const sidebarFocusedRef = useRef(false);
  const sidebarCollapsedRef = useRef(sidebarCollapsed);
  sidebarCollapsedRef.current = sidebarCollapsed;
  const rightPanelCollapsedRef = useRef(rightPanelCollapsed);
  rightPanelCollapsedRef.current = rightPanelCollapsed;
  // 宽度同步到 ref，避免拖拽回调读到过期闭包
  const leftPanelWidthRef = useRef(leftPanelWidth);
  leftPanelWidthRef.current = leftPanelWidth;
  const rightPanelWidthRef = useRef(rightPanelWidth);
  rightPanelWidthRef.current = rightPanelWidth;

  return {
    sidebarCollapsed,
    setSidebarCollapsed,
    rightPanelCollapsed,
    setRightPanelCollapsed,
    rightPanelPoppedOut,
    setRightPanelPoppedOut,
    focusMode,
    setFocusMode,
    leftPanelWidth,
    setLeftPanelWidth,
    rightPanelWidth,
    setRightPanelWidth,
    preFocusStateRef,
    sidebarRef,
    appMainRef,
    sidebarFocusedRef,
    sidebarCollapsedRef,
    rightPanelCollapsedRef,
    leftPanelWidthRef,
    rightPanelWidthRef,
  };
}

export type LayoutState = ReturnType<typeof useLayoutState>;
