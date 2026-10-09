import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const handlers = vi.hoisted(() => new Map<string, any>());
vi.mock('electron', () => ({
  ipcMain: { handle: (key: string, handler: any) => handlers.set(key, handler) },
}));
import { requestRendererPreparation } from '../../src/main/renderer-preparation';
function sender(id: number) {
  return Object.assign(new EventEmitter(), {
    id,
    send: vi.fn(),
    isDestroyed: () => false,
    isCrashed: () => false,
  });
}
beforeEach(() => vi.useRealTimers());
describe('renderer preparation IPC', () => {
  it('accepts acknowledgements only from the requested window and stays leased until release', async () => {
    const win = sender(10);
    const pending = requestRendererPreparation(win as any, 'close');
    const request = win.send.mock.calls[0][1];
    const ack = handlers.get('renderer-preparation-result');
    let done = false;
    void pending.then(() => {
      done = true;
    });
    ack({ sender: { id: 11 } }, { requestId: request.requestId, success: true });
    await Promise.resolve();
    expect(done).toBe(false);
    ack({ sender: { id: 10 } }, { requestId: request.requestId, success: true });
    const lease = await pending;
    expect(lease).not.toBeNull();
    expect(await requestRendererPreparation(win as any, 'export')).toBeNull();
    lease!.release();
    expect(win.send).toHaveBeenLastCalledWith('renderer-preparation-release', request.requestId);
  });
  it('timeout cancels instead of allowing close', async () => {
    vi.useFakeTimers();
    const win = sender(12);
    const pending = requestRendererPreparation(win as any, 'close');
    await vi.advanceTimersByTimeAsync(30000);
    expect(await pending).toBeNull();
    expect(win.send.mock.calls.at(-1)?.[0]).toBe('renderer-preparation-release');
  });
});
