// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import ReferencePane, {
  REFERENCE_PANE_MAX_WIDTH,
  REFERENCE_PANE_MIN_WIDTH,
  clampPaneWidth,
  indexAfterRemove,
  mergeReferenceItems,
} from '@/render/components/ReferencePane';
import { describeReference } from '@/render/components/ReferencePane/ReferenceInfo';
import { REVEAL_IN_FILE_PANEL_EVENT } from '@/render/utils/workspaceFiles';
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

  it('indexAfterRemove：移除后选中下一张，移除最后一张时选中前一张', () => {
    expect(indexAfterRemove(3, 0)).toBe(0);
    expect(indexAfterRemove(3, 1)).toBe(1);
    expect(indexAfterRemove(3, 2)).toBe(1);
    expect(indexAfterRemove(1, 0)).toBe(0);
  });

  it('describeReference：类型 · 文件名，已知时附尺寸 / 时长（只认同一路径）', () => {
    expect(describeReference(A, null)).toEqual(['图片', 'a.png']);
    expect(describeReference(A, { path: A.path, width: 800, height: 600 })).toEqual([
      '图片',
      'a.png',
      '800×600',
    ]);
    expect(describeReference(A, { path: B.path, width: 800, height: 600 })).toEqual([
      '图片',
      'a.png',
    ]);
    expect(describeReference(V, { path: V.path, width: 1280, height: 720, duration: 75 })).toEqual([
      '视频',
      '镜头1-v1.mp4',
      '1280×720',
      '1:15',
    ]);
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
    expect(
      within(pane)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['地图', '人物']);
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

  it('视频用自定义播放器（循环、静音、自动播放，可开声音 / 关循环）', async () => {
    render(<ReferencePane />);
    open([V]);
    const video = (await screen.findByTestId('reference-video')) as HTMLVideoElement;
    expect(video.tagName).toBe('VIDEO');
    expect(video.controls).toBe(false);
    expect(video.loop).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.autoplay).toBe(true);
    const player = screen.getByRole('group', { name: '视频 镜头1-v1.mp4' });
    expect(within(player).getByRole('slider', { name: '播放进度' })).toBeTruthy();
    fireEvent.click(within(player).getByRole('button', { name: '取消静音' }));
    expect(video.muted).toBe(false);
    // 读到元数据后信息行显示尺寸与时长
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1280 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 720 });
    Object.defineProperty(video, 'duration', { configurable: true, value: 8 });
    act(() => {
      video.dispatchEvent(new Event('loadedmetadata'));
    });
    expect(screen.getByTestId('reference-info').textContent).toContain('1280×720 · 0:08');
  });

  it('图片单击在适应宽度与原始大小之间切换；信息行显示尺寸', async () => {
    render(<ReferencePane />);
    open([A]);
    const image = (await screen.findByTestId('reference-image')) as HTMLImageElement;
    expect(image.getAttribute('data-zoomed')).toBe('false');
    const box = image.parentElement as HTMLElement;
    fireEvent.pointerDown(box, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(box, { clientX: 10, clientY: 10 });
    expect(image.getAttribute('data-zoomed')).toBe('true');
    // 拖动（平移）不切换
    fireEvent.pointerDown(box, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(box, { clientX: 60, clientY: 40 });
    fireEvent.pointerUp(box, { clientX: 60, clientY: 40 });
    expect(image.getAttribute('data-zoomed')).toBe('true');
    fireEvent.pointerDown(box, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(box, { clientX: 10, clientY: 10 });
    expect(image.getAttribute('data-zoomed')).toBe('false');

    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 1024 });
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 768 });
    fireEvent.load(image);
    expect(screen.getByTestId('reference-info').textContent).toContain('图片a.png · 1024×768');
  });

  it('信息行操作：用系统应用打开、在资料中定位、从列表移除', async () => {
    render(<ReferencePane />);
    open([A, B], 1);
    fireEvent.click(screen.getByRole('button', { name: '用系统应用打开' }));
    expect(mock.invoke).toHaveBeenCalledWith('open-in-system-app', B.path);

    const reveal = vi.fn();
    window.addEventListener(REVEAL_IN_FILE_PANEL_EVENT, reveal);
    fireEvent.click(screen.getByRole('button', { name: '在资料中定位' }));
    expect((reveal.mock.calls[0][0] as CustomEvent<{ path: string }>).detail.path).toBe(B.path);
    window.removeEventListener(REVEAL_IN_FILE_PANEL_EVENT, reveal);

    // 移除当前（第 2 张）→ 选中第 1 张，只剩一张时不再显示列表
    fireEvent.click(screen.getByRole('button', { name: '从参考列表移除' }));
    expect(within(screen.getByTestId('reference-pane')).getByText('地图')).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();
    // 全部移除后显示使用说明
    fireEvent.click(screen.getByRole('button', { name: '从参考列表移除' }));
    expect(screen.getByTestId('reference-empty')).toBeTruthy();
  });

  it('多张参考：按 index 打开，上一张 / 下一张循环切换，列表点选，方向键切换', async () => {
    render(<ReferencePane />);
    open([A, B, V], 1);
    const pane = screen.getByTestId('reference-pane');
    expect(within(pane).getByText('2 / 3')).toBeTruthy();
    const options = () =>
      within(screen.getByRole('listbox', { name: '参考列表' })).getAllByRole('option');
    expect(options()[1].getAttribute('aria-selected')).toBe('true');
    expect(options()[2].textContent).toBe('镜头1-v1.mp4');
    // 缩略图网格：图片显示缩略图，视频只显示播放图标（不为缩略图读取视频）
    await vi.waitFor(() =>
      expect(options()[0].querySelector('img')?.getAttribute('src')).toBe('blob:ref')
    );
    expect(options()[2].querySelector('img')).toBeNull();
    expect(options()[2].querySelector('svg')).not.toBeNull();
    expect(
      mock.invoke.mock.calls.filter(([, path]) => path === V.path && true).length
    ).toBeLessThanOrEqual(1);

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
