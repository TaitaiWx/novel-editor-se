/**
 * ai-stream-event 分发：主进程按窗口推送所有流的片段，这里按 streamId 交给对应的订阅者。
 *
 * ai-stream-start 返回 streamId 之前片段就可能到达，因此先开始监听、对未订阅的流暂存事件，
 * 订阅时补发。暂存有上限（其他功能发起、不经本路由订阅的流不会无限占用内存）。
 */
import type { AIStreamEvent } from '@/shared/ai';

type StreamListener = (event: AIStreamEvent) => void;
type OnChannel = (
  listener: (event: unknown, payload: AIStreamEvent) => void
) => (() => void) | void;

const MAX_PENDING_STREAMS = 32;
const MAX_PENDING_EVENTS = 4000;

export interface AIStreamRouter {
  /** 开始监听（发起流之前调用，保证不漏掉早到的片段） */
  prepare: () => void;
  subscribe: (streamId: string, listener: StreamListener) => () => void;
  dispose: () => void;
}

export function createAIStreamRouter(on: OnChannel): AIStreamRouter {
  const listeners = new Map<string, StreamListener>();
  const pending = new Map<string, AIStreamEvent[]>();
  let disposer: (() => void) | null | undefined;

  const route = (payload: AIStreamEvent) => {
    if (!payload || typeof payload.streamId !== 'string') return;
    const listener = listeners.get(payload.streamId);
    if (listener) {
      listener(payload);
      return;
    }
    let queue = pending.get(payload.streamId);
    if (!queue) {
      if (pending.size >= MAX_PENDING_STREAMS) {
        const oldest = pending.keys().next().value;
        if (oldest !== undefined) pending.delete(oldest);
      }
      queue = [];
      pending.set(payload.streamId, queue);
    }
    if (queue.length < MAX_PENDING_EVENTS) queue.push(payload);
  };

  return {
    prepare() {
      if (disposer !== undefined) return;
      disposer = on((_event, payload) => route(payload)) ?? null;
    },
    subscribe(streamId, listener) {
      this.prepare();
      listeners.set(streamId, listener);
      const queued = pending.get(streamId);
      if (queued) {
        pending.delete(streamId);
        for (const event of queued) {
          if (listeners.get(streamId) !== listener) break;
          listener(event);
        }
      }
      return () => {
        if (listeners.get(streamId) === listener) listeners.delete(streamId);
      };
    },
    dispose() {
      disposer?.();
      disposer = undefined;
      listeners.clear();
      pending.clear();
    },
  };
}

let sharedRouter: AIStreamRouter | null = null;

/** 窗口内共用的路由（经 preload 白名单的 ai-stream-event 通道） */
export function getAIStreamRouter(): AIStreamRouter | null {
  const ipc = typeof window !== 'undefined' ? window.electron?.ipcRenderer : undefined;
  if (!ipc) return null;
  if (!sharedRouter) {
    sharedRouter = createAIStreamRouter((listener) =>
      ipc.on<[unknown, AIStreamEvent]>('ai-stream-event', listener)
    );
  }
  return sharedRouter;
}
