// @vitest-environment happy-dom
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CharacterDesignForm } from '@/render/components/RightPanel/CharactersView/CharacterDesignForm';
import { parseCharacterDesign } from '@novel-editor/core/entity-media';
import { flushPreparationParticipants } from '@/render/utils/rendererPreparation';

it('an acknowledged field refresh preserves another field still being edited', async () => {
  const original = parseCharacterDesign({ appearance: '旧外貌', outfit: '旧衣服' });
  const { rerender } = render(<CharacterDesignForm design={original} onSave={() => {}} />);
  fireEvent.change(screen.getByLabelText('人物服装'), { target: { value: '正在写的衣服' } });
  rerender(
    <CharacterDesignForm design={{ ...original, appearance: '已保存的外貌' }} onSave={() => {}} />
  );
  expect((screen.getByLabelText('人物服装') as HTMLTextAreaElement).value).toBe('正在写的衣服');
  expect((screen.getByLabelText('人物外貌') as HTMLTextAreaElement).value).toBe('已保存的外貌');
  expect(await flushPreparationParticipants()).toBe(false);
});

it('serializes field patches, preserves newer edits during save and retains failed drafts for retry', async () => {
  let finish!: () => void;
  const save = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    )
    .mockRejectedValueOnce(new Error('写入失败'))
    .mockResolvedValue(undefined);
  render(<CharacterDesignForm design={parseCharacterDesign({})} onSave={save} />);
  const appearance = screen.getByLabelText('人物外貌');
  const outfit = screen.getByLabelText('人物服装');
  fireEvent.change(appearance, { target: { value: '黑发' } });
  fireEvent.blur(appearance);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  fireEvent.change(outfit, { target: { value: '蓝衣' } });
  fireEvent.blur(outfit);
  fireEvent.change(appearance, { target: { value: '黑发，左眉有疤' } });
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish();
  });
  await screen.findByRole('alert');
  expect(save.mock.calls[0]).toEqual([{ appearance: '黑发' }, { appearance: '' }]);
  expect(save.mock.calls[1]).toEqual([{ outfit: '蓝衣' }, { outfit: '' }]);
  expect((appearance as HTMLTextAreaElement).value).toBe('黑发，左眉有疤');
  expect((outfit as HTMLTextAreaElement).value).toBe('蓝衣');
  fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(save.mock.calls.slice(2)).toContainEqual([{ outfit: '蓝衣' }, { outfit: '' }]);
});

it('keeps the original compare-and-swap baseline on an external edit, then explicitly retries against the displayed version', async () => {
  const original = parseCharacterDesign({ appearance: '旧外貌' });
  const save = vi.fn().mockRejectedValueOnce(new Error('已被修改')).mockResolvedValue(undefined);
  const { rerender } = render(<CharacterDesignForm design={original} onSave={save} />);
  const appearance = screen.getByLabelText('人物外貌');
  fireEvent.change(appearance, { target: { value: '我的草稿' } });
  rerender(<CharacterDesignForm design={{ ...original, appearance: '别处保存' }} onSave={save} />);
  fireEvent.blur(appearance);
  await screen.findByRole('alert');
  expect(save).toHaveBeenLastCalledWith({ appearance: '我的草稿' }, { appearance: '旧外貌' });
  expect(screen.getByRole('alert').textContent).toContain('别处保存');
  expect((appearance as HTMLTextAreaElement).value).toBe('我的草稿');
  fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(save).toHaveBeenLastCalledWith({ appearance: '我的草稿' }, { appearance: '别处保存' });
});
