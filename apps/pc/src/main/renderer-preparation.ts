import { ipcMain, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import type {
  RendererPreparationResult,
  RendererPreparationRequest,
} from '../shared/renderer-preparation';
export interface RendererPreparationLease {
  release: () => void;
}
const pending = new Map<string, { senderId: number; finish: (success: boolean) => void }>();
const busy = new Set<number>();
let installed = false;
export function registerRendererPreparation(): void {
  if (installed) return;
  installed = true;
  ipcMain.handle('renderer-preparation-result', (event, result: RendererPreparationResult) => {
    if (!result || typeof result.requestId !== 'string' || typeof result.success !== 'boolean')
      return;
    const request = pending.get(result.requestId);
    if (request?.senderId === event.sender.id) request.finish(result.success);
  });
}
/** Timeout is a cancellation, never permission to destroy a live renderer. */
export function requestRendererPreparation(
  sender: WebContents,
  reason: RendererPreparationRequest['reason']
): Promise<RendererPreparationLease | null> {
  registerRendererPreparation();
  if (sender.isDestroyed() || sender.isCrashed()) {
    return Promise.resolve(reason === 'close' ? { release: () => {} } : null);
  }
  if (busy.has(sender.id)) return Promise.resolve(null);
  busy.add(sender.id);
  const requestId = randomUUID();
  return new Promise((resolve) => {
    const release = () => {
      busy.delete(sender.id);
      if (!sender.isDestroyed()) sender.send('renderer-preparation-release', requestId);
    };
    const finish = (success: boolean) => {
      if (!pending.delete(requestId)) return;
      clearTimeout(timer);
      sender.removeListener('destroyed', destroyed);
      if (success) resolve({ release });
      else {
        release();
        resolve(null);
      }
    };
    const destroyed = () => finish(false);
    const timer = setTimeout(() => finish(false), 30_000);
    pending.set(requestId, { senderId: sender.id, finish });
    sender.once('destroyed', destroyed);
    try {
      sender.send('renderer-preparation-request', { requestId, reason });
    } catch {
      finish(false);
    }
  });
}
