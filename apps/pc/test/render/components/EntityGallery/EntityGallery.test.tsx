// @vitest-environment happy-dom
import React from 'react';
import { modelInfo } from '../../helpers/aiModel';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CHARACTER_MEDIA_KINDS, type MediaItem } from '@novel-editor/core/entity-media';
import EntityGallery from '@/render/components/EntityGallery';
import { dataUrlToBytes } from '@/render/components/EntityGallery/mediaActions';
import { clearAvatarCache } from '@/render/utils/characterAvatar';
import { installElectronMock, uninstallElectronMock } from '../../hooks/electronMock';
import { chooseOption } from '../../helpers/select';

const PNG_URL = 'data:image/png;base64,iVBORw0KGgo=';

function provider(id: string, kind: 'image' | 'text', ready: boolean) {
  return modelInfo({
    id,
    kind,
    label: id,
    description: '',
    defaultBaseUrl: '',
    defaultModel: 'm',
    models: ['m'],
    configured: ready,
    secureStorage: true,
    enabled: ready,
    baseUrl: '',
    model: 'm',
  });
}

let saveSeq = 0;
function setup(options: { imageReady?: boolean; items?: MediaItem[]; cover?: string } = {}) {
  const mock = installElectronMock((channel, ...args) => {
    switch (channel) {
      case 'ai-providers-list':
        return {
          ok: true,
          data: [provider('seedream-image', 'image', options.imageReady ?? true)],
        };
      case 'entity-image-save':
        saveSeq += 1;
        return { ok: true, data: { relativePath: `资料/图集/人物/林舟/${saveSeq}.png` } };
      case 'entity-image-delete':
        return { ok: true, data: null };
      case 'ai-image-generate':
        return {
          ok: true,
          data: {
            images: [{ dataUrl: PNG_URL }, { dataUrl: PNG_URL }, { dataUrl: PNG_URL }],
            providerId: 'seedream-image',
            model: 'seedream-test',
          },
        };
      case 'read-file-binary':
        return { base64Content: 'AAAA', mimeType: 'image/png' };
      default:
        return args.length ? null : null;
    }
  });
  const onChange = vi.fn();
  const buildPrompt = vi.fn(
    ({ kind, style, extra }: { kind: string; style: string; extra: string }) =>
      `${style}|${kind}|林舟|${extra}`
  );
  const view = render(
    <EntityGallery
      entity="character"
      name="林舟"
      workPath="/w"
      items={options.items ?? []}
      cover={options.cover}
      kinds={CHARACTER_MEDIA_KINDS}
      buildPrompt={buildPrompt}
      onChange={onChange}
    />
  );
  return { mock, onChange, buildPrompt, ...view };
}

const item = (id: string, kind: MediaItem['kind']): MediaItem => ({
  id,
  path: `资料/图集/人物/林舟/${id}.png`,
  kind,
  source: 'upload',
  createdAt: '2026-10-07T00:00:00.000Z',
});

afterEach(() => {
  uninstallElectronMock();
  clearAvatarCache();
});

describe('EntityGallery（人物 / 设定图集）', () => {
  it('空图集：点击即上传（可多选），都存为形象图，第一张自动成为主要形象图', async () => {
    const { mock, onChange } = setup();
    expect(screen.queryByLabelText('上传为')).toBeNull();
    const dropzone = screen.getByTestId('entity-gallery-dropzone');
    expect(dropzone.textContent).toContain('点击上传图片，或把图片拖到这里');
    const input = screen.getByTestId('entity-gallery-input') as HTMLInputElement;
    const clicked = vi.spyOn(input, 'click');
    fireEvent.click(dropzone);
    expect(clicked).toHaveBeenCalled();
    const files = [
      new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }),
      new File([new Uint8Array([2])], 'b.png', { type: 'image/png' }),
    ];
    fireEvent.change(input, { target: { files } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const saves = mock.invoke.mock.calls.filter(([channel]) => channel === 'entity-image-save');
    expect(saves).toHaveLength(2);
    expect(saves[0][1]).toBe('/w');
    expect(saves[0][2]).toMatchObject({ entity: 'character', name: '林舟' });
    const change = onChange.mock.calls[0][0] as { media: MediaItem[]; cover: string };
    expect(change.media.map((entry) => entry.kind)).toEqual(['portrait', 'portrait']);
    expect(change.cover).toBe(change.media[0].path);
  });

  it('拖入图片上传，非图片文件被忽略', async () => {
    const { mock, onChange } = setup();
    const gallery = screen.getByTestId('entity-gallery');
    const files = [
      new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }),
      new File(['x'], 'note.txt', { type: 'text/plain' }),
    ];
    fireEvent.drop(gallery, { dataTransfer: { files, types: ['Files'] } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const saves = mock.invoke.mock.calls.filter(([channel]) => channel === 'entity-image-save');
    expect(saves).toHaveLength(1);
  });

  it('右键菜单：设为三视图 / 主要形象图、在编辑器旁边打开', async () => {
    const existing = [item('p', 'portrait'), item('q', 'portrait')];
    const { onChange } = setup({ items: existing, cover: existing[0].path });
    expect(screen.getByText('主要形象图')).toBeTruthy();
    const tiles = screen.getAllByRole('listitem');
    fireEvent.contextMenu(tiles[1]);
    const menu = screen.getByRole('menu');
    // 已经是形象图：该项不可用，点击不改动
    fireEvent.click(within(menu).getByText('设为形象图'));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.contextMenu(screen.getAllByRole('listitem')[1]);
    fireEvent.click(within(screen.getByRole('menu')).getByText('设为三视图'));
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        media: [existing[0], { ...existing[1], kind: 'turnaround' }],
        cover: existing[0].path,
      })
    );
    fireEvent.contextMenu(screen.getAllByRole('listitem')[1]);
    fireEvent.click(within(screen.getByRole('menu')).getByText('设为主要形象图'));
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({ media: existing, cover: existing[1].path })
    );
    const opened = vi.fn();
    window.addEventListener('novel-editor:open-reference', opened);
    fireEvent.contextMenu(screen.getAllByRole('listitem')[0]);
    fireEvent.click(within(screen.getByRole('menu')).getByText('在编辑器旁边打开'));
    expect(opened).toHaveBeenCalledTimes(1);
    const detail = (opened.mock.calls[0][0] as CustomEvent).detail as {
      items: Array<{ path: string; kind: string }>;
      index: number;
    };
    expect(detail.items.map((entry) => entry.path)).toEqual([
      '/w/资料/图集/人物/林舟/p.png',
      '/w/资料/图集/人物/林舟/q.png',
    ]);
    expect(detail.index).toBe(0);
    window.removeEventListener('novel-editor:open-reference', opened);
  });

  it('AI 生成：三视图 + 画风 + 补一句 → 4 张候选（带参考图）→ 选 2 张保存（含提示词）', async () => {
    const existing = [item('t', 'turnaround'), item('p', 'portrait')];
    const { mock, onChange, buildPrompt } = setup({ items: existing, cover: existing[1].path });
    const aiButton = await screen.findByRole('button', { name: /AI 生成/ });
    await waitFor(() => expect((aiButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(aiButton);
    const panel = await screen.findByRole('region', { name: 'AI 生成图片' });
    fireEvent.click(within(panel).getByRole('radio', { name: '三视图' }));
    chooseOption('画风', '水墨', within(panel));
    fireEvent.change(within(panel).getByLabelText('补充一句（可不填）'), {
      target: { value: '雪夜' },
    });
    expect(within(panel).getByText(/带 2 张参考图保持一致/)).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: '生成 4 张三视图' }));
    const listbox = await within(panel).findByRole('listbox', { name: '候选图' });
    const candidates = within(listbox).getAllByRole('option');
    expect(candidates).toHaveLength(3);
    const request = mock.invoke.mock.calls.find(
      ([channel]) => channel === 'ai-image-generate'
    )?.[1];
    expect(request).toMatchObject({
      workPath: '/w',
      prompt: '水墨|turnaround|林舟|雪夜',
      aspectRatio: '16:9',
      count: 4,
      references: [existing[0].path, existing[1].path],
    });
    expect(buildPrompt).toHaveBeenCalled();
    fireEvent.click(candidates[0]);
    fireEvent.click(candidates[2]);
    expect(candidates[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.click(within(panel).getByRole('button', { name: '保存 2 张' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const saves = mock.invoke.mock.calls.filter(([channel]) => channel === 'entity-image-save');
    expect(saves).toHaveLength(2);
    expect(saves[0][2]).toMatchObject({
      prompt: '水墨|turnaround|林舟|雪夜',
      providerId: 'seedream-image',
      model: 'seedream-test',
    });
    const change = onChange.mock.calls[0][0] as { media: MediaItem[]; cover: string };
    expect(
      change.media
        .slice(0, 2)
        .every((entry) => entry.kind === 'turnaround' && entry.source === 'ai')
    ).toBe(true);
    // 已有封面保持不变
    expect(change.cover).toBe(existing[1].path);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'AI 生成图片' })).toBeNull());
  });

  it('设为主要形象图、删除（同时删除文件）、查看大图；旧类型归入形象图分组', async () => {
    const existing = [item('p', 'portrait'), item('o', 'outfit')];
    const { mock, onChange } = setup({ items: existing, cover: existing[0].path });
    expect(screen.getByRole('heading', { name: /形象图/ })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /服装/ })).toBeNull();
    expect(screen.getByText('主要形象图')).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText('设为主要形象图')[0]);
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({ media: existing, cover: existing[1].path })
    );
    fireEvent.click(screen.getAllByLabelText('删除图片')[0]);
    await waitFor(() =>
      expect(mock.invoke).toHaveBeenCalledWith('entity-image-delete', '/w', existing[0].path)
    );
    // 删除当前封面后封面回落到剩下的图
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({ media: [existing[1]], cover: existing[1].path })
    );
    fireEvent.click(screen.getAllByLabelText(/^查看 /)[1]);
    expect(screen.getByRole('dialog', { name: '查看图片' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('关闭大图'));
    expect(screen.queryByRole('dialog', { name: '查看图片' })).toBeNull();
  });

  it('没有配置图片服务：AI 按钮打开设置中心并说明原因', async () => {
    setup({ imageReady: false });
    const opened = vi.fn();
    window.addEventListener('open-settings-tab', opened);
    const button = screen.getByRole('button', { name: /AI 生成/ });
    fireEvent.mouseEnter(button.parentElement as HTMLElement);
    expect((await screen.findByRole('tooltip')).textContent).toContain('还没有配置图片服务');
    fireEvent.click(button);
    expect(opened).toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'AI 生成图片' })).toBeNull();
    window.removeEventListener('open-settings-tab', opened);
  });

  it('dataUrlToBytes', () => {
    expect(Array.from(dataUrlToBytes('data:image/png;base64,AQID'))).toEqual([1, 2, 3]);
  });
});
