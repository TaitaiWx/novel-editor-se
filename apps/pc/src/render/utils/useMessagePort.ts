/**
 * useMessagePort — 基于 MessagePort 的直连通信 React Hook。
 *
 * 提供零主进程开销的 render-to-render 直连通道。
 * 适用于所有窗口间实时数据同步场景。
 *
 * @example
 * // 发送端（主窗口）
 * const { connected, send } = useMessagePort<string>('content-sync');
 * useEffect(() => { if (connected) send(editorContent); }, [editorContent, connected, send]);
 *
 * @example
 * // 接收端（面板窗口）
 * const { connected } = useMessagePort<string>('content-sync', (data) => setContent(data));
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { subscribePort } from './messagePortChannel';

export function useMessagePort<TSend = unknown, TReceive = TSend>(
  channelName: string,
  onMessage?: (data: TReceive) => void
): { connected: boolean; send: (data: TSend) => void } {
  const portRef = useRef<MessagePort | null>(null);
  const [connected, setConnected] = useState(false);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    const unsubscribe = subscribePort(channelName, (port) => {
      // 关闭旧端口（重连场景）
      if (portRef.current) {
        portRef.current.close();
      }

      port.onmessage = (e: MessageEvent) => {
        onMessageRef.current?.(e.data);
      };
      port.start();
      portRef.current = port;
      setConnected(true);
    });

    return () => {
      unsubscribe();
      if (portRef.current) {
        portRef.current.close();
        portRef.current = null;
      }
      setConnected(false);
    };
  }, [channelName]);

  const send = useCallback(
    (data: TSend) => {
      portRef.current?.postMessage(data);
    },
    [] // portRef 是 stable ref
  );

  return { connected, send };
}
