/**
 * MessagePort Channel — 渲染进程端的 MessagePort 直连通信模块。
 *
 * 架构：
 *   Main Process → MessageChannelMain → port1 → windowA, port2 → windowB
 *   Preload → ipcRenderer.on('port-transfer') → window.postMessage(ports)
 *   本模块 → 接收 ports → 提供 React hook (useMessagePort)
 *
 * 用于替代 IPC relay 模式，实现零主进程开销的 render-to-render 直连。
 * 未来可直接用于协同编辑、每帧同步等高频实时场景。
 */

// ── Port 到达缓冲 ──────────────────────────────────────────
// 解决时序问题：port 可能在 React hook mount 之前到达
type PortListener = (port: MessagePort) => void;

const pendingPorts = new Map<string, MessagePort>();
const subscribers = new Map<string, Set<PortListener>>();

/**
 * 全局监听器：捕获从 preload 转发过来的 MessagePort。
 * 此模块必须在 React 渲染之前被导入（由 main.tsx side-effect import 保证）。
 */
window.addEventListener('message', (event: MessageEvent) => {
  if (event.data?.type !== 'port-transfer' || !event.data?.channelName) return;

  const { channelName } = event.data as { type: string; channelName: string };
  const [port] = event.ports;
  if (!port) return;

  const subs = subscribers.get(channelName);
  if (subs && subs.size > 0) {
    // 有活跃订阅者 → 直接交付给第一个
    const [first] = subs;
    first(port);
  } else {
    // 无订阅者 → 缓冲，等 hook mount 后取走（关闭旧端口防止泄漏）
    const old = pendingPorts.get(channelName);
    if (old) old.close();
    pendingPorts.set(channelName, port);
  }
});

/**
 * 订阅指定通道的 MessagePort 到达事件。
 * 如果 port 已缓冲，立即交付。
 * 返回取消订阅函数。
 */
export function subscribePort(channelName: string, listener: PortListener): () => void {
  // 检查缓冲区
  const buffered = pendingPorts.get(channelName);
  if (buffered) {
    pendingPorts.delete(channelName);
    // 异步交付，避免在 subscribe 调用栈中直接触发
    queueMicrotask(() => listener(buffered));
  }

  let subs = subscribers.get(channelName);
  if (!subs) {
    subs = new Set();
    subscribers.set(channelName, subs);
  }
  subs.add(listener);

  return () => {
    subs!.delete(listener);
    if (subs!.size === 0) subscribers.delete(channelName);
  };
}
