// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useVolumePlanState } from '@/render/components/RightPanel/VolumePlanView/useVolumePlanState';
import { flushPreparationParticipants } from '@/render/utils/rendererPreparation';
it('flushes debounced volume plan and waits for durable acknowledgement', async () => {
  let finish!: () => void;
  const invoke = vi.fn((channel: string) =>
    channel === 'db-settings-set'
      ? new Promise<void>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(null)
  );
  window.electron = { ipcRenderer: { invoke } } as any;
  const hook = renderHook(() =>
    useVolumePlanState({ volumePath: '/novel/v1', workPath: '/novel', markerOutline: null })
  );
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  act(() => hook.result.current.update((prev) => ({ ...prev, goal: 'last change' })));
  let done = false;
  const pending = flushPreparationParticipants().then((result) => {
    done = true;
    return result;
  });
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      'db-settings-set',
      expect.any(String),
      expect.stringContaining('last change')
    )
  );
  expect(done).toBe(false);
  finish();
  expect(await pending).toBe(true);
  hook.unmount();
});
