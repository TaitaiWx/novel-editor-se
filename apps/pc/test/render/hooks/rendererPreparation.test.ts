// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import {
  installRendererPreparation,
  registerPreparationParticipant,
  isRendererPreparing,
} from '@/render/utils/rendererPreparation';
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  document.body.inert = false;
});
function setup() {
  const listeners = new Map<string, any>();
  const invoke = vi.fn(async () => {});
  window.electron = {
    ipcRenderer: {
      on: (name: string, listener: any) => {
        listeners.set(name, listener);
        return () => {};
      },
      invoke,
    },
  } as any;
  installRendererPreparation();
  return { listeners, invoke };
}
it('holds the whole document including portals inert until main releases the saved lease', async () => {
  const { listeners, invoke } = setup();
  let finish!: () => void;
  cleanups.push(
    registerPreparationParticipant(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    )
  );
  const pending = listeners.get('renderer-preparation-request')(
    {},
    { requestId: 'held', reason: 'close' }
  );
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(document.body.inert).toBe(true);
  expect(invoke).not.toHaveBeenCalled();
  finish();
  await pending;
  expect(invoke).toHaveBeenCalledWith('renderer-preparation-result', {
    requestId: 'held',
    success: true,
  });
  expect(document.body.inert).toBe(true);
  listeners.get('renderer-preparation-release')({}, 'held');
  expect(document.body.inert).toBe(false);
  expect(isRendererPreparing()).toBe(false);
});
it('a dirty non-editor form participant cancels close and restores input immediately', async () => {
  const { listeners, invoke } = setup();
  cleanups.push(registerPreparationParticipant(() => false));
  await listeners.get('renderer-preparation-request')({}, { requestId: 'cancel', reason: 'close' });
  expect(invoke).toHaveBeenCalledWith('renderer-preparation-result', {
    requestId: 'cancel',
    success: false,
  });
  expect(document.body.inert).toBe(false);
});
it('late completion after main cancellation cannot resurrect a timed out lease', async () => {
  const { listeners, invoke } = setup();
  let finish!: () => void;
  cleanups.push(
    registerPreparationParticipant(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    )
  );
  const pending = listeners.get('renderer-preparation-request')(
    {},
    { requestId: 'late', reason: 'close' }
  );
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  listeners.get('renderer-preparation-release')({}, 'late');
  finish();
  await pending;
  expect(invoke).not.toHaveBeenCalled();
  expect(document.body.inert).toBe(false);
});
