// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import KeyframeSection, {
  type KeyframeSectionProps,
} from '@/render/components/SceneVideoView/Inspector/KeyframeSection';
import { clearAvatarCache } from '@/render/utils/characterAvatar';
import { installElectronMock, uninstallElectronMock } from '../../hooks/electronMock';

const URLS = ['data:image/png;base64,AAA1', 'data:image/png;base64,AAA2'];

function setup(props: Partial<KeyframeSectionProps> = {}) {
  installElectronMock((channel) =>
    channel === 'read-file-binary' ? { base64Content: 'AAAA', mimeType: 'image/png' } : null
  );
  const handlers = {
    onOpenPreviz: vi.fn(),
    onGenerate: vi.fn(async () => URLS),
    onAdopt: vi.fn(async (_dataUrl: string) => undefined),
    onClear: vi.fn(),
  };
  render(
    <KeyframeSection
      label="镜头1"
      workPath="/p/novels/星河旅人"
      imageReady
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

afterEach(() => {
  uninstallElectronMock();
  clearAvatarCache();
});

describe('KeyframeSection', () => {
  it('没有预演与首帧：占位文字，按钮为「3D 预演」「生成首帧（4 选 1）」，没有「不用首帧」', () => {
    const handlers = setup();
    const section = screen.getByRole('region', { name: '镜头1 首帧' });
    expect(within(section).getByText('还没有预演')).toBeTruthy();
    expect(within(section).getByText('还没有首帧')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '不用首帧' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '3D 预演' }));
    expect(handlers.onOpenPreviz).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '生成首帧（4 选 1）' })).toBeTruthy();
  });

  it('已有预演与首帧：显示两张图，按钮变为「重新预演」「重新生成首帧」，可「不用首帧」', async () => {
    const handlers = setup({ previz: '资料/视频/a/预演.png', keyframe: '资料/视频/a/首帧.png' });
    expect(await screen.findByAltText('镜头1 预演截图')).toBeTruthy();
    expect(await screen.findByAltText('镜头1 首帧')).toBeTruthy();
    expect(screen.getByRole('button', { name: '重新预演' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '重新生成首帧' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '不用首帧' }));
    expect(handlers.onClear).toHaveBeenCalledTimes(1);
  });

  it('未配置图片服务时不能生成', () => {
    setup({ imageReady: false });
    expect(
      (screen.getByRole('button', { name: '生成首帧（4 选 1）' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('生成后列出首帧候选，采用其中一张后候选收起', async () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole('button', { name: '生成首帧（4 选 1）' }));
    const list = await screen.findByRole('listbox', { name: '首帧候选' });
    const options = within(list).getAllByRole('option');
    expect(options.map((option) => option.getAttribute('aria-label'))).toEqual([
      '采用首帧候选 1',
      '采用首帧候选 2',
    ]);
    expect(handlers.onGenerate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('option', { name: '采用首帧候选 2' }));
    await waitFor(() => expect(screen.queryByRole('listbox', { name: '首帧候选' })).toBeNull());
    expect(handlers.onAdopt).toHaveBeenCalledWith(URLS[1]);
  });

  it('生成中按钮禁用并显示「生成中…」', async () => {
    let finish: (value: string[]) => void = () => undefined;
    setup({ onGenerate: () => new Promise<string[]>((resolve) => (finish = resolve)) });
    const button = screen.getByRole('button', { name: '生成首帧（4 选 1）' }) as HTMLButtonElement;
    fireEvent.click(button);
    expect(button.textContent).toContain('生成中…');
    expect(button.disabled).toBe(true);
    finish([]);
    await waitFor(() => expect(button.textContent).toBe('生成首帧（4 选 1）'));
    expect(screen.queryByRole('listbox', { name: '首帧候选' })).toBeNull();
  });

  it('生成 / 采用失败时显示错误；采用失败保留候选', async () => {
    setup({
      onGenerate: vi.fn(async () => {
        throw new Error('额度不足');
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: '生成首帧（4 选 1）' }));
    expect((await screen.findByRole('alert')).textContent).toBe('额度不足');
  });

  it('采用失败：显示错误并保留候选', async () => {
    setup({ onAdopt: vi.fn(async () => Promise.reject('写入失败')) });
    fireEvent.click(screen.getByRole('button', { name: '生成首帧（4 选 1）' }));
    fireEvent.click(await screen.findByRole('option', { name: '采用首帧候选 1' }));
    expect((await screen.findByRole('alert')).textContent).toBe('写入失败');
    expect(screen.getByRole('listbox', { name: '首帧候选' })).toBeTruthy();
  });
});
