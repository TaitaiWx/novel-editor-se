// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { subscribePort } from '@/render/utils/messagePortChannel';
import { useMessagePort } from '@/render/utils/useMessagePort';
import { useCrdtOpsReceiver, useCrdtOpsSender } from '@/render/utils/useCrdtOpsChannel';
import type { CrdtOpsEnvelope } from '@/shared/crdtOps';

interface FakePort {
  onmessage: ((event: MessageEvent) => void) | null;
  close: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
}

function createFakePort(): FakePort {
  return { onmessage: null, close: vi.fn(), start: vi.fn(), postMessage: vi.fn() };
}

const asPort = (port: FakePort) => port as unknown as MessagePort;

function transferPort(channelName: string, port: FakePort | null, type = 'port-transfer') {
  const event = new MessageEvent('message', { data: { type, channelName } });
  Object.defineProperty(event, 'ports', { value: port ? [asPort(port)] : [] });
  window.dispatchEvent(event);
}

const flushMicrotasks = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('subscribePort', () => {
  it('订阅后到达的端口直接交付给第一个订阅者', () => {
    const first = vi.fn();
    const second = vi.fn();
    const off1 = subscribePort('ch-direct', first);
    const off2 = subscribePort('ch-direct', second);
    const port = createFakePort();
    transferPort('ch-direct', port);
    expect(first).toHaveBeenCalledWith(port);
    expect(second).not.toHaveBeenCalled();
    off1();
    off2();
  });

  it('无订阅者时缓冲端口，订阅时异步交付；重复到达会关闭旧端口', async () => {
    const oldPort = createFakePort();
    const newPort = createFakePort();
    transferPort('ch-buffer', oldPort);
    transferPort('ch-buffer', newPort);
    expect(oldPort.close).toHaveBeenCalled();

    const listener = vi.fn();
    const off = subscribePort('ch-buffer', listener);
    expect(listener).not.toHaveBeenCalled();
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledWith(newPort);
    off();
  });

  it('忽略非 port-transfer 消息与无端口消息', () => {
    const listener = vi.fn();
    const off = subscribePort('ch-ignore', listener);
    transferPort('ch-ignore', createFakePort(), 'other');
    transferPort('ch-ignore', null);
    window.dispatchEvent(new MessageEvent('message', { data: null }));
    expect(listener).not.toHaveBeenCalled();
    off();
  });

  it('取消订阅后端口进入缓冲区', async () => {
    const listener = vi.fn();
    subscribePort('ch-unsub', listener)();
    const port = createFakePort();
    transferPort('ch-unsub', port);
    expect(listener).not.toHaveBeenCalled();
    const late = vi.fn();
    const off = subscribePort('ch-unsub', late);
    await flushMicrotasks();
    expect(late).toHaveBeenCalledWith(port);
    off();
  });
});

describe('useMessagePort', () => {
  it('端口到达后 connected=true，可收发消息；重连关闭旧端口；卸载时关闭', () => {
    const onMessage = vi.fn();
    const { result, unmount } = renderHook(() => useMessagePort<string>('hook-ch', onMessage));
    expect(result.current.connected).toBe(false);
    result.current.send('未连接时发送不会报错');

    const port = createFakePort();
    act(() => transferPort('hook-ch', port));
    expect(result.current.connected).toBe(true);
    expect(port.start).toHaveBeenCalled();

    result.current.send('第一章 正文');
    expect(port.postMessage).toHaveBeenCalledWith('第一章 正文');

    port.onmessage?.({ data: '面板回传' } as MessageEvent);
    expect(onMessage).toHaveBeenCalledWith('面板回传');

    const port2 = createFakePort();
    act(() => transferPort('hook-ch', port2));
    expect(port.close).toHaveBeenCalled();

    unmount();
    expect(port2.close).toHaveBeenCalled();
  });

  it('没有 onMessage 回调时收到消息也安全', () => {
    renderHook(() => useMessagePort<string>('hook-ch-no-cb'));
    const port = createFakePort();
    act(() => transferPort('hook-ch-no-cb', port));
    expect(() => port.onmessage?.({ data: 'x' } as MessageEvent)).not.toThrow();
  });
});

describe('useCrdtOpsChannel', () => {
  it('发送端与接收端使用 crdt-ops 通道', () => {
    const sender = renderHook(() => useCrdtOpsSender());
    const port = createFakePort();
    act(() => transferPort('crdt-ops', port));
    expect(sender.result.current.connected).toBe(true);
    sender.unmount();

    const onOps = vi.fn();
    const receiver = renderHook(() => useCrdtOpsReceiver(onOps));
    const port2 = createFakePort();
    act(() => transferPort('crdt-ops', port2));
    const envelope = { ops: [] } as unknown as CrdtOpsEnvelope;
    port2.onmessage?.({ data: envelope } as MessageEvent);
    expect(onOps).toHaveBeenCalledWith(envelope);
    receiver.unmount();
  });
});
