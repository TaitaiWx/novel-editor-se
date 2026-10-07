// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import ReferencePane, {
  REFERENCE_PANE_MAX_WIDTH,
  REFERENCE_PANE_MIN_WIDTH,
  clampPaneWidth,
  mergeReferenceItems,
} from '@/render/components/ReferencePane';
import ReferenceButton from '@/render/components/ReferenceButton';
import {
  referenceItemFor,
  requestOpenReference,
  type ReferenceItem,
} from '@/render/utils/referencePane';
import {
  installElectronMock,
  uninstallElectronMock,
  type ElectronMock,
} from '../../hooks/electronMock';

function item(path: string, title?: string): ReferenceItem {
  const result = referenceItemFor(path, title);
  if (!result) throw new Error(`不是媒体文件：${path}`);
  return result;
}

const A = item('/p/资料/a.png', '地图');
const B = item('/p/资料/b.png', '人物');
const V = item('/p/资料/视频/镜头1-v1.mp4');

describe('ReferencePane 纯函数', () => {
  it('clampPaneWidth：限制在最小 / 最大宽度之间并取整，非有限数回退默认宽度', () => {
    expect(clampPaneWidth(100)).toBe(REFERENCE_PANE_MIN_WIDTH);
    expect(clampPaneWidth(5000)).toBe(REFERENCE_PANE_MAX_WIDTH);
    expect(clampPaneWidth(400.6)).toBe(401);
    expect(clampPaneWidth(Number.NaN)).toBe(360);
    expect(clampPaneWidth(Number.POSITIVE_INFINITY)).toBe(360);
  });

  it('mergeReferenceItems：同一路径不重复（新的移到最后），最多 30 个', () => {
    expect(mergeReferenceItems([A, B], [A]).map((x) => x.path)).toEqual([B.path, A.path]);
    expect(mergeReferenceItems([], [V])).toEqual([V]);
    const many = Array.from({ length: 35 }, (_, index) => item(`/p/${index}.png`));
    const merged = mergeReferenceItems(many.slice(0, 20), many.slice(20));
    expect(merged).toHaveLength(30);
    expect(merged[0].path).toBe('/p/5.png');
    expect(merged[29].path).toBe('/p/34.png');
  });
});

describe('ReferencePane 组件', () => {
  let mock: ElectronMock;
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:ref');
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    mock = installElectronMock((channel, filePath) => {
      if (channel !== 'read-file-binary') return null;
      if (String(filePath).endsWith('broken.png')) throw new Error('权限不足');
      if (String(filePath).endsWith('empty.png'))
        return { base64Content: '', mimeType: 'image/png' };
      return {
        base64Content: 'AAAA',
        mimeType: String(filePath).endsWith('.mp4') ? 'video/mp4' : 'image/png',
      };
    });
    Object.assign(URL, { createObjectURL, revokeObjectURL });
  });

  afterEach(() => {
    uninstallElectronMock();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
  });

  const open = (items: ReferenceItem[], index?: number) =>
    act(() => {
      requestOpenReference({ items, index });
    });

  it('文件栏「参考」按钮：没有内容时放默认人物参考；再按一次收起；按钮显示按下状态', async () => {
    render(
      <>
        <ReferenceButton fallback={[A, B]} />
        <ReferencePane />
      </>
    );
    const button = screen.getByRole('button', { name: '参考' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    const pane = screen.getByTestId('reference-pane');
    expect(within(pane).getAllByText('地图').length).toBeGreaterThan(0);
    expect(within(pane).getAllByRole('option').map((option) => option.textContent)).toEqual([
      '地图',
      '人物',
    ]);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button);
    expect(screen.queryByTestId('reference-pane')).toBeNull();
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('没有任何参考时打开显示使用说明', () => {
    render(
      <>
        <ReferenceButton />
        <ReferencePane />
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: '参考' }));
    expect(screen.getByTestId('reference-empty').textContent).toContain('在编辑器旁边打开');
    fireEvent.click(screen.getByRole('button', { name: '关闭参考' }));
    expect(screen.queryByTestId('reference-pane')).toBeNull();
  });

  it('没有打开参考时不渲染；收到打开事件后停靠显示图片', async () => {
    const { container } = render(<ReferencePane />);
    expect(container.innerHTML).toBe('');
    open([A]);
    const pane = screen.getByTestId('reference-pane');
    expect(within(pane).getByText('地图')).toBeTruthy();
    const image = await screen.findByTestId('reference-image');
    expect(image.getAttribute('src')).toBe('blob:ref');
    expect(image.getAttribute('alt')).toBe('地图');
    expect(mock.invoke).toHaveBeenCalledWith('read-file-binary', A.path);
    // 只有一张时没有翻页与列表
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('button', { name: '上一张参考' })).toBeNull();
  });

  it('视频用 video 元素（循环、静音）', async () => {
    render(<ReferencePane />);
    open([V]);
    const video = await screen.findByTestId('reference-video');
    expect(video.tagName).toBe('VIDEO');
    expect(video.getAttribute('aria-label')).toBe('镜头1-v1.mp4');
    expect((video as HTMLVideoElement).loop).toBe(true);
    expect((video as HTMLVideoElement).muted).toBe(true);
  });

  it('多张参考：按 index 打开，上一张 / 下一张循环切换，列表点选，方向键切换', async () => {
    render(<ReferencePane />);
    open([A, B, V], 1);
    const pane = screen.getByTestId('reference-pane');
    expect(within(pane).getByText('2 / 3')).toBeTruthy();
    const options = () =>
      within(screen.getByRole('listbox', { name: '参考列表' })).getAllByRole('option');
    expect(options()[1].getAttribute('aria-selected')).toBe('true');
    expect(options()[2].textContent).toBe('▶ 镜头1-v1.mp4');

    fireEvent.click(screen.getByRole('button', { name: '下一张参考' }));
    expect(within(pane).getByText('3 / 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '下一张参考' }));
    expect(within(pane).getByText('1 / 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '上一张参考' }));
    expect(within(pane).getByText('3 / 3')).toBeTruthy();

    fireEvent.click(options()[1]);
    expect(within(pane).getByText('2 / 3')).toBeTruthy();
    fireEvent.keyDown(pane, { key: 'ArrowLeft' });
    expect(within(pane).getByText('1 / 3')).toBeTruthy();
    fireEvent.keyDown(pane, { key: 'ArrowRight' });
    expect(within(pane).getByText('2 / 3')).toBeTruthy();
  });

  it('再次打开已有的参考不重复，并定位到它', () => {
    render(<ReferencePane />);
    open([A, B]);
    open([A]);
    const pane = screen.getByTestId('reference-pane');
    expect(within(pane).getByText('2 / 2')).toBeTruthy();
    expect(within(pane).getAllByText('地图').length).toBeGreaterThan(0);
  });

  it('缩成小卡片 → 展开 → 关闭；关闭后清空列表', async () => {
    render(<ReferencePane />);
    open([A, B]);
    fireEvent.click(screen.getByRole('button', { name: '缩成小卡片' }));
    expect(screen.queryByTestId('reference-pane')).toBeNull();
    const mini = screen.getByTestId('reference-mini');
    expect(within(mini).getByText('地图')).toBeTruthy();
    fireEvent.click(within(mini).getByRole('button', { name: '展开参考窗格' }));
    expect(screen.getByTestId('reference-pane')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '缩成小卡片' }));
    fireEvent.click(
      within(screen.getByTestId('reference-mini')).getByRole('button', { name: '关闭参考' })
    );
    expect(screen.queryByTestId('reference-mini')).toBeNull();

    open([V]);
    const pane = screen.getByTestId('reference-pane');
    // 关闭时清空，重新打开只剩新的一张
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(within(pane).getByRole('button', { name: '关闭参考' }));
    expect(screen.queryByTestId('reference-pane')).toBeNull();
  });

  it('hidden 时隐藏，取消隐藏后恢复原状态', () => {
    const { rerender } = render(<ReferencePane hidden />);
    open([A]);
    expect(screen.queryByTestId('reference-pane')).toBeNull();
    rerender(<ReferencePane />);
    expect(screen.getByTestId('reference-pane')).toBeTruthy();
  });

  it('读取失败或文件为空时显示原因', async () => {
    render(<ReferencePane />);
    open([item('/p/broken.png')]);
    expect(await screen.findByText(/无法读取：.*权限不足/)).toBeTruthy();
    open([item('/p/empty.png')]);
    expect(await screen.findByText('无法读取：文件为空')).toBeTruthy();
  });

  it('没有 electron 时提示没有打开项目', async () => {
    uninstallElectronMock();
    render(<ReferencePane />);
    open([A]);
    expect(await screen.findByText('无法读取：没有打开项目')).toBeTruthy();
  });

  it('拖动左边缘调整宽度（限制在范围内）', () => {
    render(<ReferencePane />);
    open([A]);
    const pane = screen.getByTestId('reference-pane');
    const resizer = screen.getByRole('separator', { name: '拖动调整参考窗格宽度' });
    fireEvent.pointerDown(resizer, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(resizer, { clientX: 400, pointerId: 1 });
    expect(pane.style.width).toBe('460px');
    fireEvent.pointerMove(resizer, { clientX: -2000, pointerId: 1 });
    expect(pane.style.width).toBe(`${REFERENCE_PANE_MAX_WIDTH}px`);
    fireEvent.pointerUp(resizer, { pointerId: 1 });
    fireEvent.pointerMove(resizer, { clientX: 900, pointerId: 1 });
    expect(pane.style.width).toBe(`${REFERENCE_PANE_MAX_WIDTH}px`);
  });
});
