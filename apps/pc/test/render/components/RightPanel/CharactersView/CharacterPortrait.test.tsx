// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CharacterPortrait } from '@/render/components/RightPanel/CharactersView/CharacterPortrait';
import CharacterAvatar from '@/render/components/CharacterAvatar';
import { clearAvatarCache } from '@/render/utils/characterAvatar';
import { installElectronMock, uninstallElectronMock } from '../../../hooks/electronMock';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

afterEach(() => {
  uninstallElectronMock();
  clearAvatarCache();
});

describe('人物形象图（详情页大图）', () => {
  it('没有图时显示竖版占位（首字 +「添加形象图」），不是小圆头像', () => {
    installElectronMock();
    render(<CharacterPortrait name="林舟" workPath="/w" onChange={vi.fn()} />);
    const button = screen.getByRole('button', { name: '为 林舟 添加形象图' });
    expect(button.textContent).toContain('林');
    expect(button.textContent).toContain('添加形象图');
    expect(button.className).toContain('frameEmpty');
  });

  it('有图时完整显示大图；相对路径经 read-file-binary 读取', async () => {
    const mock = installElectronMock((channel) =>
      channel === 'read-file-binary' ? { base64Content: 'AAAA', mimeType: 'image/png' } : null
    );
    render(
      <CharacterPortrait
        name="苏晴"
        avatar="资料/人物头像/苏晴.png"
        workPath="/w"
        onChange={vi.fn()}
      />
    );
    const image = await screen.findByAltText('苏晴 的形象图');
    expect(image.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(mock.invoke).toHaveBeenCalledWith('read-file-binary', '/w/资料/人物头像/苏晴.png');
    expect(screen.getByRole('button', { name: '更换 苏晴 的形象图' })).toBeTruthy();
  });

  it('选择图片 → character-avatar-save → 写回相对路径；失败时显示错误', async () => {
    const mock = installElectronMock((channel) =>
      channel === 'character-avatar-save'
        ? { ok: true, data: { relativePath: '资料/人物头像/林舟-1.png' } }
        : null
    );
    const onChange = vi.fn();
    render(<CharacterPortrait name="林舟" workPath="/w" onChange={onChange} />);
    const input = screen.getByTestId('character-avatar-input') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('资料/人物头像/林舟-1.png'));
    const call = mock.invoke.mock.calls.find(([channel]) => channel === 'character-avatar-save');
    expect(call?.slice(1, 3)).toEqual(['/w', '林舟']);

    mock.invoke.mockResolvedValueOnce({ ok: false, error: '图片过大' });
    fireEvent.change(input, { target: { files: [file] } });
    expect((await screen.findByRole('alert')).textContent).toBe('图片过大');
  });

  it('没有作品目录时不可更换', () => {
    installElectronMock();
    render(<CharacterPortrait name="林舟" workPath={null} onChange={vi.fn()} />);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('CharacterAvatar（引用处的小圆头像）', () => {
  it('有图显示圆形图片，没有图显示首字；尺寸可配', async () => {
    installElectronMock();
    const { container, rerender } = render(<CharacterAvatar name="林舟" avatar={PNG} size={30} />);
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe(PNG));
    expect((container.querySelector('img') as HTMLElement).style.width).toBe('30px');
    rerender(<CharacterAvatar name="苏晴" src={null} />);
    expect(container.textContent).toBe('苏');
  });
});
