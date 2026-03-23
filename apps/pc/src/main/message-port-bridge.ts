/**
 * MessagePort Bridge — 建立两个 BrowserWindow 之间的直连通道。
 *
 * 使用 Electron MessageChannelMain 创建端口对，分别发送到两个窗口的渲染进程，
 * 实现零主进程开销的 render→render 直连通信。
 *
 * 优势对比 IPC relay：
 *   - 零主进程 CPU 开销（数据不经过 main process）
 *   - 更低延迟（<1ms vs IPC invoke 3-5ms round-trip）
 *   - 原生 structured-clone 传输（自动处理复杂对象）
 *   - 支持 Transferable（ArrayBuffer / ImageBitmap 零拷贝）
 *   - 适合高频实时场景：协同编辑、每帧同步
 */
import { BrowserWindow, MessageChannelMain } from 'electron';

/**
 * 在两个 BrowserWindow 之间建立命名 MessagePort 通道。
 *
 * @param windowA  第一个窗口（通常是主窗口 / 发送端）
 * @param windowB  第二个窗口（通常是面板窗口 / 接收端）
 * @param channelName  通道名称，用于 renderer 识别
 */
export function establishPortChannel(
  windowA: BrowserWindow,
  windowB: BrowserWindow,
  channelName: string
): void {
  const { port1, port2 } = new MessageChannelMain();

  // 将 port1 发送到 windowA 的渲染进程
  windowA.webContents.postMessage('port-transfer', channelName, [port1]);

  // 将 port2 发送到 windowB 的渲染进程
  windowB.webContents.postMessage('port-transfer', channelName, [port2]);
}
