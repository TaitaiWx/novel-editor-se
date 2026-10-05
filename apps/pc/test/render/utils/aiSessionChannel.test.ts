import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAISessionChannel, type AISessionMessage } from '@/render/utils/aiSessionChannel';
import type { AISessionSnapshot } from '@/render/state/aiSessionSnapshot';

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  onmessage: ((event: MessageEvent<AISessionMessage>) => void) | null = null;
  posted: AISessionMessage[] = [];
  closed = false;
  constructor(public name: string) {
    FakeBroadcastChannel.instances.push(this);
  }
  postMessage(msg: AISessionMessage) {
    this.posted.push(msg);
    // 模拟同名通道广播给其他实例（BroadcastChannel 不会回送给自己）
    FakeBroadcastChannel.instances
      .filter((other) => other !== this && other.name === this.name && !other.closed)
      .forEach((other) => other.onmessage?.({ data: msg } as MessageEvent<AISessionMessage>));
  }
  close() {
    this.closed = true;
  }
}

const snapshot = { messages: [] } as unknown as AISessionSnapshot;

describe('createAISessionChannel', () => {
  beforeEach(() => {
    FakeBroadcastChannel.instances = [];
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('广播状态并被其他窗口接收', () => {
    const main = createAISessionChannel('main');
    const panel = createAISessionChannel('panel');
    const received = vi.fn();
    panel.onMessage(received);

    main.broadcast(snapshot, '/n/第一章.md');
    expect(received).toHaveBeenCalledWith(snapshot, '/n/第一章.md');

    const sent = FakeBroadcastChannel.instances[0].posted[0];
    expect(sent).toMatchObject({
      type: 'state-sync',
      senderId: 'main',
      sessionKey: '/n/第一章.md',
    });
    expect(typeof sent.timestamp).toBe('number');
    expect(FakeBroadcastChannel.instances[0].name).toBe('novel-editor-ai-session');
  });

  it('忽略自己发出的消息、非 state-sync 消息与空消息', () => {
    const channel = createAISessionChannel('self');
    const received = vi.fn();
    channel.onMessage(received);
    const raw = FakeBroadcastChannel.instances[0];
    const deliver = (data: unknown) => raw.onmessage?.({ data } as MessageEvent<AISessionMessage>);

    deliver({ type: 'state-sync', senderId: 'self', state: snapshot, timestamp: 0 });
    deliver({ type: 'other', senderId: 'x', state: snapshot, timestamp: 0 });
    deliver(null);
    expect(received).not.toHaveBeenCalled();

    deliver({ type: 'state-sync', senderId: 'x', state: snapshot, timestamp: 0 });
    expect(received).toHaveBeenCalledTimes(1);
  });

  it('未指定 senderId 时自动生成；关闭后不再回调', () => {
    const channel = createAISessionChannel();
    const raw = FakeBroadcastChannel.instances[0];
    channel.broadcast(snapshot);
    expect(raw.posted[0].senderId).toMatch(/^\d+-[a-z0-9]+$/);

    const received = vi.fn();
    channel.onMessage(received);
    channel.close();
    expect(raw.closed).toBe(true);
    raw.onmessage?.({
      data: { type: 'state-sync', senderId: 'x', state: snapshot, timestamp: 0 },
    } as MessageEvent<AISessionMessage>);
    expect(received).not.toHaveBeenCalled();
  });
});
