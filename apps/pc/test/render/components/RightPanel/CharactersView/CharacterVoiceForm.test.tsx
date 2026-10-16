// @vitest-environment happy-dom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import CharacterVoiceForm from '@/render/components/RightPanel/CharactersView/CharacterVoiceForm';
import { editorText, replaceEditorText } from '../../../testUtils/codeMirror';

it('saves trimmed voice fields on blur, keeps multiline timbre and preserves provider voice settings', () => {
  const onSave = vi.fn();
  render(
    <CharacterVoiceForm
      voice={{ gender: 'male', age: '17', timbre: '清亮', providerVoiceId: 'existing-voice' }}
      onSave={onSave}
    />
  );
  const age = screen.getByRole('textbox', { name: '人物声音 年龄' });
  replaceEditorText(age, ' 18 ');
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.blur(age);
  expect(onSave).toHaveBeenLastCalledWith({
    gender: 'male',
    age: '18',
    timbre: '清亮',
    providerVoiceId: 'existing-voice',
  });
  const timbre = screen.getByRole('textbox', { name: '人物声音 音色' });
  replaceEditorText(timbre, ' 清亮\n放轻声音 ');
  fireEvent.blur(timbre);
  expect(onSave).toHaveBeenLastCalledWith({
    gender: 'male',
    age: '17',
    timbre: '清亮\n放轻声音',
    providerVoiceId: 'existing-voice',
  });
});

it('edits proposed voice values through draft callbacks without saving on blur', () => {
  const onSave = vi.fn();
  const onDraftChange = vi.fn();
  const { container } = render(
    <CharacterVoiceForm
      voice={{ age: '17' }}
      draftOverride={{ age: '18' }}
      draftBaseline={{ age: '17' }}
      onDraftChange={onDraftChange}
      onSave={onSave}
    />
  );
  const age = screen.getByRole('textbox', { name: '人物声音 年龄' });
  expect(editorText(age)).toBe('18');
  expect(container.querySelector('del')?.textContent).toBe('7');
  replaceEditorText(age, '19');
  fireEvent.blur(age);
  expect(onDraftChange).toHaveBeenLastCalledWith({ age: '19' });
  expect(onSave).not.toHaveBeenCalled();
});
