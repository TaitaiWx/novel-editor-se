// @vitest-environment happy-dom
import React from 'react';
import { editorText, replaceEditorText } from '../../../testUtils/codeMirror';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CharacterDesignForm } from '@/render/components/RightPanel/CharactersView/CharacterDesignForm';
import { parseCharacterDesign } from '@novel-editor/core/entity-media';
import { flushPreparationParticipants } from '@/render/utils/rendererPreparation';

it('an acknowledged field refresh preserves another field still being edited', async () => {
  const original = parseCharacterDesign({ appearance: '旧外貌', outfit: '旧衣服' });
  const { rerender } = render(<CharacterDesignForm design={original} onSave={() => {}} />);
  replaceEditorText(screen.getByLabelText('人物服装'), '正在写的衣服');
  rerender(
    <CharacterDesignForm design={{ ...original, appearance: '已保存的外貌' }} onSave={() => {}} />
  );
  expect(editorText(screen.getByLabelText('人物服装'))).toBe('正在写的衣服');
  expect(editorText(screen.getByLabelText('人物外貌'))).toBe('已保存的外貌');
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
  replaceEditorText(appearance, '黑发');
  fireEvent.blur(appearance);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  replaceEditorText(outfit, '蓝衣');
  fireEvent.blur(outfit);
  replaceEditorText(appearance, '黑发，左眉有疤');
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish();
  });
  await screen.findByRole('alert');
  expect(save.mock.calls[0]).toEqual([{ appearance: '黑发' }, { appearance: '' }]);
  expect(save.mock.calls[1]).toEqual([{ outfit: '蓝衣' }, { outfit: '' }]);
  expect(editorText(appearance)).toBe('黑发，左眉有疤');
  expect(editorText(outfit)).toBe('蓝衣');
  fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(save.mock.calls.slice(2)).toContainEqual([{ outfit: '蓝衣' }, { outfit: '' }]);
});

it('keeps the original compare-and-swap baseline on an external edit, then explicitly retries against the displayed version', async () => {
  const original = parseCharacterDesign({ appearance: '旧外貌' });
  const save = vi.fn().mockRejectedValueOnce(new Error('已被修改')).mockResolvedValue(undefined);
  const { rerender } = render(<CharacterDesignForm design={original} onSave={save} />);
  const appearance = screen.getByLabelText('人物外貌');
  replaceEditorText(appearance, '我的草稿');
  rerender(<CharacterDesignForm design={{ ...original, appearance: '别处保存' }} onSave={save} />);
  fireEvent.blur(appearance);
  await screen.findByRole('alert');
  expect(save).toHaveBeenLastCalledWith({ appearance: '我的草稿' }, { appearance: '旧外貌' });
  expect(screen.getByRole('alert').textContent).toContain('别处保存');
  expect(editorText(appearance)).toBe('我的草稿');
  fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(save).toHaveBeenLastCalledWith({ appearance: '我的草稿' }, { appearance: '别处保存' });
});

it('proposed design fields edit their draft without triggering autosave on blur', () => {
  const save = vi.fn();
  const editDraft = vi.fn();
  const { container } = render(
    <CharacterDesignForm
      design={parseCharacterDesign({ appearance: '黑发' })}
      draftOverride={{ appearance: '银发' }}
      draftBaseline={{ appearance: '黑发' }}
      fieldKeys={['appearance']}
      onDraftChange={editDraft}
      onSave={save}
    />
  );
  const appearance = screen.getByRole('textbox', { name: '人物外貌' });
  expect(editorText(appearance)).toBe('银发');
  expect(container.querySelector('del')?.textContent).toBe('黑');
  replaceEditorText(appearance, '银发蓝眼');
  fireEvent.blur(appearance);
  expect(editDraft).toHaveBeenLastCalledWith('appearance', '银发蓝眼', '黑发');
  expect(save).not.toHaveBeenCalled();
});

it('queued saves retain their original owner when the editor unmounts', async () => {
  let finish!: () => void;
  const save = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValue(undefined);
  const { unmount } = render(
    <CharacterDesignForm design={parseCharacterDesign({})} onSave={save} />
  );
  replaceEditorText(screen.getByLabelText('人物外貌'), '黑发');
  fireEvent.blur(screen.getByLabelText('人物外貌'));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  replaceEditorText(screen.getByLabelText('人物服装'), '蓝衣');
  fireEvent.blur(screen.getByLabelText('人物服装'));
  unmount();
  await act(async () => {
    finish();
  });
  expect(save.mock.calls).toEqual([
    [{ appearance: '黑发' }, { appearance: '' }],
    [{ outfit: '蓝衣' }, { outfit: '' }],
  ]);
  expect(await flushPreparationParticipants()).toBe(true);
});
