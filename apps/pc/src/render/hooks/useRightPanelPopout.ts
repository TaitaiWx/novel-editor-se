import React, { useCallback, useRef } from 'react';
import { PortChannel } from '@/shared/portChannels';
import { type ThrottledFunction, throttle } from '@/render/utils/throttle';
import { useCrdtOpsSender } from '@/render/utils/useCrdtOpsChannel';
import { useMessagePort } from '@/render/utils/useMessagePort';
import type { AppState } from './useAppState';
import type { PaneLayoutApi } from './usePaneLayout';

export type UseRightPanelPopoutContext = Pick<
  AppState,
  | 'activeTab'
  | 'editorContent'
  | 'editorContentRef'
  | 'folderPath'
  | 'rightPanelPoppedOut'
  | 'setRightPanelPoppedOut'
> &
  Pick<PaneLayoutApi, 'resolvePaneLayout'>;

/**
 * 右侧面板弹出为独立窗口，并通过 MessagePort 同步编辑内容
 */
export function useRightPanelPopout(ctx: UseRightPanelPopoutContext) {
  const {
    activeTab,
    editorContent,
    editorContentRef,
    folderPath,
    resolvePaneLayout,
    rightPanelPoppedOut,
    setRightPanelPoppedOut,
  } = ctx;

  // 监听右侧面板独立窗口关闭 → 恢复三栏布局
  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const dispose = ipc.on('right-panel-window-closed', () => {
      setRightPanelPoppedOut(false);
      resolvePaneLayout({ nextRightPanelCollapsed: false, preferExpanding: 'right' });
    });
    return () => {
      dispose?.();
    };
  }, [resolvePaneLayout]);

  const handlePopOutRightPanel = useCallback(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc || !folderPath) return;
    const hasTab = !!activeTab;
    void ipc.invoke('open-right-panel-window', folderPath, editorContentRef.current, hasTab);
    setRightPanelPoppedOut(true);
  }, [folderPath, activeTab]);

  // MessagePort 直连：当独立窗口建立端口通道后，内容变化直接 postMessage 到面板
  // 数据驱动 —— 主窗口是唯一数据源，零 main-process 开销
  const { connected: portConnected, send: sendToPanel } = useMessagePort<string>(
    PortChannel.ContentSync
  );
  // 协同编辑预留：增量操作流独立通道（与全文字符串同步解耦）
  useCrdtOpsSender();

  // 节流发送 —— throttle 包裹 send，高频打字时限制到 ≈20fps（50ms 间隔）
  // 用函数级 throttle 而非 useThrottle hook：消除中间 state + 额外渲染，
  // editorContent 变化在同一渲染周期内触发节流发送，leading 首触即发 + trailing 尾值不丢
  const throttledSendRef = useRef<ThrottledFunction<(d: string) => void> | null>(null);
  if (!throttledSendRef.current) {
    throttledSendRef.current = throttle((data: string) => sendToPanel(data), 50);
  }

  React.useEffect(() => {
    if (!rightPanelPoppedOut || !portConnected) {
      throttledSendRef.current?.cancel();
      return;
    }
    // editorContent 变化 → 节流发送
    // portConnected 由 false→true 时也触发（leading edge），等价于 "push on connect"
    throttledSendRef.current!(editorContent);
  }, [rightPanelPoppedOut, portConnected, editorContent]);

  // 组件卸载时 flush 残余的 trailing 调用，确保最后一次变更送达
  React.useEffect(() => () => throttledSendRef.current?.flush(), []);

  return {
    handlePopOutRightPanel,
  };
}

export type RightPanelPopoutApi = ReturnType<typeof useRightPanelPopout>;
