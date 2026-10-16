// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useProfileDraft } from '@/render/components/RightPanel/CharactersView/CharacterDetailWorkspace/useProfileDraft';
import type { Character } from '@/render/components/RightPanel/types';
import { flushPreparationParticipants } from '@/render/utils/rendererPreparation';
import { installElectronMock, uninstallElectronMock } from './electronMock';

const person: Character = {
  id: 1,
  name: '林舟',
  role: '主角',
  category: 'major',
  description: '',
  currentState: [],
  design: { appearance: '黑发', outfit: '', personality: '', speech: '', background: '旧身世' },
  voice: { age: '17' },
};
const skill = JSON.stringify({
  id: 'skill-1',
  kind: 'skill',
  name: '剑术',
  description: '会用剑',
  status: 'planned',
});
const goal = JSON.stringify({
  id: 'goal-1',
  kind: 'goal',
  name: '归乡',
  description: '回家',
  status: 'planned',
});
const proposal = {
  design: { appearance: '银发', background: '新身世' },
  voice: { age: '18' },
  development: { 'skill-1': skill, 'goal-1': goal },
};
afterEach(uninstallElectronMock);

it('saves only the selected tab with original CAS values and discards other tabs independently', async () => {
  const ipc = installElectronMock();
  const { result } = renderHook(() => useProfileDraft(person, '/work'));
  act(() => {
    result.current.fill(proposal, person);
  });
  expect(
    ['design', 'environment', 'power', 'plot'].map((tab) => result.current.hasTabDraft(tab))
  ).toEqual([true, true, true, true]);
  expect(await flushPreparationParticipants()).toBe(false);
  await act(async () => {
    await result.current.save('design');
  });
  expect(ipc.invoke).toHaveBeenCalledWith(
    'db-character-patch-profile-draft',
    '/work',
    1,
    { appearance: '银发' },
    { appearance: '黑发' },
    { voice: { age: '18' }, voiceExpected: { age: '17' }, development: {}, developmentExpected: {} }
  );
  expect(result.current.hasTabDraft('design')).toBe(false);
  act(() => result.current.discard('environment'));
  expect(result.current.values).toEqual({});
  await act(async () => {
    await result.current.save('power');
  });
  expect(ipc.invoke).toHaveBeenLastCalledWith(
    'db-character-patch-profile-draft',
    '/work',
    1,
    {},
    {},
    {
      voice: {},
      voiceExpected: {},
      development: { 'skill-1': skill },
      developmentExpected: { 'skill-1': '' },
    }
  );
  expect(result.current.hasTabDraft('plot')).toBe(true);
  act(() => result.current.discard('plot'));
  expect(result.current.hasDraft).toBe(false);
  expect(await flushPreparationParticipants()).toBe(true);
});

it('retains the first baseline across refreshes and edits, and retains drafts after a conflict', async () => {
  const ipc = installElectronMock(() => {
    throw new Error('资料已在别处修改');
  });
  const { result, rerender } = renderHook(({ character }) => useProfileDraft(character, '/work'), {
    initialProps: { character: person },
  });
  act(() => {
    result.current.fill(proposal, person);
  });
  rerender({ character: { ...person, design: { ...person.design!, appearance: '远端黑发' } } });
  act(() => result.current.edit('appearance', ' 作者银发 ', '远端黑发'));
  await act(async () => {
    await result.current.save('design');
  });
  expect(ipc.invoke.mock.calls[0]?.[3]).toEqual({ appearance: '作者银发' });
  expect(ipc.invoke.mock.calls[0]?.[4]).toEqual({ appearance: '黑发' });
  expect(result.current.error).toBe('资料已在别处修改');
  expect(result.current.values?.appearance).toBe(' 作者银发 ');
  expect(result.current.hasTabDraft('design')).toBe(true);
});

it('does not overwrite edits made during generation and keeps newer drafts while a save is in flight', async () => {
  let finish!: () => void;
  const ipc = installElectronMock(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const { result, rerender } = renderHook(({ character }) => useProfileDraft(character, '/work'), {
    initialProps: { character: person },
  });
  rerender({ character: { ...person, design: { ...person.design!, appearance: '作者刚改' } } });
  act(() => {
    result.current.fill(proposal, person);
  });
  expect(result.current.values).toEqual({ background: '新身世' });
  let saving!: Promise<void>;
  act(() => {
    saving = result.current.save('environment');
  });
  expect(result.current.saving).toBe(true);
  act(() => result.current.edit('background', '保存时的新编辑', '旧身世'));
  await act(async () => {
    await result.current.save('environment');
  });
  expect(ipc.invoke).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish();
    await saving;
  });
  expect(result.current.values?.background).toBe('保存时的新编辑');
  expect(result.current.hasTabDraft('environment')).toBe(true);
});

it('keeps character/workspace drafts isolated and unregisters the close guard on unmount', async () => {
  installElectronMock();
  const { result, rerender, unmount } = renderHook(
    ({ character, work }) => useProfileDraft(character, work),
    { initialProps: { character: person, work: '/work' } }
  );
  act(() => {
    result.current.fill(proposal, person);
  });
  rerender({ character: { ...person, id: 2 }, work: '/work' });
  expect(result.current.hasDraft).toBe(false);
  expect(await flushPreparationParticipants()).toBe(false);
  rerender({ character: person, work: '/other-work' });
  expect(result.current.hasDraft).toBe(false);
  rerender({ character: person, work: '/work' });
  expect(result.current.values?.appearance).toBe('银发');
  unmount();
  expect(await flushPreparationParticipants()).toBe(true);
});
