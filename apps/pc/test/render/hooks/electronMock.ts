import { vi, type Mock } from 'vitest';
import type { ElectronAPI } from '@/render/types/electron-api';

export type InvokeHandler = (channel: string, ...args: unknown[]) => unknown;

export interface ElectronMock {
  invoke: Mock<(channel: string, ...args: unknown[]) => Promise<unknown>>;
  on: Mock<(channel: string, listener: (...args: unknown[]) => void) => () => void>;
  removeListener: Mock<(channel: string, listener: (...args: unknown[]) => void) => void>;
  removeAllListeners: Mock<(channel: string) => void>;
  /** 手动触发主进程推送事件 */
  emit: (channel: string, ...args: unknown[]) => void;
}

/**
 * 在 window 上安装一个最小可用的 electron mock。
 * handler 返回值会被 Promise.resolve 包裹；抛错则 reject。
 */
export function installElectronMock(handler: InvokeHandler = () => undefined): ElectronMock {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const invoke = vi.fn(async (channel: string, ...args: unknown[]) => handler(channel, ...args));
  const on = vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
    const set = listeners.get(channel) ?? new Set();
    set.add(listener);
    listeners.set(channel, set);
    return () => {
      set.delete(listener);
    };
  });
  const removeListener = vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
    listeners.get(channel)?.delete(listener);
  });
  const removeAllListeners = vi.fn((channel: string) => {
    listeners.delete(channel);
  });
  const emit = (channel: string, ...args: unknown[]) => {
    listeners.get(channel)?.forEach((listener) => listener({}, ...args));
  };

  (window as unknown as { electron: ElectronAPI }).electron = {
    getLastDroppedPaths: () => [],
    ipcRenderer: { invoke, on, removeListener, removeAllListeners },
  } as unknown as ElectronAPI;

  return { invoke, on, removeListener, removeAllListeners, emit };
}

export function uninstallElectronMock(): void {
  delete (window as unknown as { electron?: ElectronAPI }).electron;
}
