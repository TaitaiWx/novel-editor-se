import { saveAllEditors } from '../components/TextEditor/active-editor';
import type { RendererPreparationRequest } from '../../shared/renderer-preparation';
type Participant = () => boolean | void | Promise<boolean | void>;
const participants = new Set<Participant>();
/** Components register pending draft/session persistence; completion must reflect actual IPC acknowledgement. */
export function registerPreparationParticipant(participant: Participant): () => void {
  participants.add(participant);
  return () => {
    participants.delete(participant);
  };
}
export async function flushPreparationParticipants(): Promise<boolean> {
  for (const participant of [...participants]) {
    if ((await participant()) === false) return false;
  }
  return true;
}
export const PREPARATION_CANCELLED_EVENT = 'novel-editor:preparation-cancelled';
let activeRequest: string | null = null;
export function isRendererPreparing(): boolean {
  return activeRequest !== null;
}
export function installRendererPreparation(): void {
  const ipc = window.electron?.ipcRenderer;
  if (!ipc) return;
  let root: HTMLElement | null = null;
  let previousInert = false;
  const release = (requestId: string) => {
    if (activeRequest !== requestId) return;
    activeRequest = null;
    if (root) root.inert = previousInert;
    root = null;
  };
  ipc.on('renderer-preparation-release', (_event, requestId: string) => release(requestId));
  ipc.on('renderer-preparation-request', async (_event, request: RendererPreparationRequest) => {
    if (activeRequest) {
      await ipc.invoke('renderer-preparation-result', {
        requestId: request.requestId,
        success: false,
      });
      return;
    }
    activeRequest = request.requestId;
    // Include portals (dialogs and popovers) so they cannot introduce a new draft after acknowledgement.
    root = document.body;
    previousInert = root?.inert ?? false;
    if (root) root.inert = true;
    let success = false;
    try {
      success = (await saveAllEditors()) && (await flushPreparationParticipants());
    } catch (error) {
      console.error('准备保存失败:', error);
    }
    // A timed-out operation has already been cancelled by main; never resurrect its lock.
    if (activeRequest !== request.requestId) return;
    if (!success) {
      release(request.requestId);
      document.dispatchEvent(new CustomEvent(PREPARATION_CANCELLED_EVENT));
    }
    await ipc.invoke('renderer-preparation-result', { requestId: request.requestId, success });
  });
}
