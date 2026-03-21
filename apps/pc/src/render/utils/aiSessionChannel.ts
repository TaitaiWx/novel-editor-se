/**
 * BroadcastChannel 实时跨窗口状态同步。
 *
 * 利用 BroadcastChannel API（Chromium / Electron 原生支持）实现同源窗口间的
 * 低延迟消息广播，替代 IPC 中转的快照式同步。
 *
 * 用法：
 *   const channel = createAISessionChannel();
 *   channel.broadcast(state);            // 发送
 *   channel.onMessage((state) => { … }); // 接收
 *   channel.close();                     // 卸载时关闭
 */

import type { AISessionSnapshot } from '../state/aiSessionSnapshot';

const CHANNEL_NAME = 'novel-editor-ai-session';

export interface AISessionMessage {
  type: 'state-sync';
  /** 消息来源标识（避免自己收到自己发的消息） */
  senderId: string;
  sessionKey?: string;
  state: AISessionSnapshot;
  timestamp: number;
}

export function createAISessionChannel(senderId?: string) {
  const id = senderId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const channel = new BroadcastChannel(CHANNEL_NAME);

  let listener: ((state: AISessionSnapshot, sessionKey?: string) => void) | null = null;

  channel.onmessage = (event: MessageEvent<AISessionMessage>) => {
    const msg = event.data;
    if (!msg || msg.type !== 'state-sync') return;
    // 忽略自己发出的消息
    if (msg.senderId === id) return;
    listener?.(msg.state, msg.sessionKey);
  };

  return {
    /** 广播当前 AI 会话状态 */
    broadcast(state: AISessionSnapshot, sessionKey?: string) {
      const msg: AISessionMessage = {
        type: 'state-sync',
        senderId: id,
        sessionKey,
        state,
        timestamp: Date.now(),
      };
      channel.postMessage(msg);
    },

    /** 注册接收回调（同时只有一个监听器） */
    onMessage(cb: (state: AISessionSnapshot, sessionKey?: string) => void) {
      listener = cb;
    },

    /** 关闭通道，卸载时调用 */
    close() {
      listener = null;
      channel.close();
    },
  };
}
