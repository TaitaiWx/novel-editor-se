// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ActsView } from '@/render/components/RightPanel/ActsView';
import type { PlotActBoard } from '@/render/components/RightPanel/types';
import {
  installElectronMock,
  uninstallElectronMock,
  type ElectronMock,
} from '../../hooks/electronMock';

const SCRIPT = [
  '第一幕 起',
  '第一场 雨夜',
  '主角在雨夜出场。',
  '第二场 相遇',
  '两人相遇。',
  '第二幕 承',
  '第三场 冲突',
  '矛盾爆发。',
].join('\n');

const STORAGE_KEY = 'novel-editor:plot-board:/novel';

interface MockOpts {
  stored?: Record<string, PlotActBoard> | null;
  getError?: boolean;
  ai?: { ok: boolean; text?: string; error?: string };
}

function mockIpc(opts: MockOpts = {}): ElectronMock {
  return installElectronMock((channel) => {
    if (channel === 'db-settings-get') {
      if (opts.getError) throw new Error('x');
      return opts.stored ? JSON.stringify(opts.stored) : null;
    }
    if (channel === 'ai-request') return opts.ai ?? { ok: true, text: 'AI 建议内容' };
    return true;
  });
}

function savedBoards(mock: ElectronMock): Record<string, PlotActBoard> {
  const call = mock.invoke.mock.calls.filter((c) => c[0] === 'db-settings-set').at(-1);
  expect(call?.[1]).toBe(STORAGE_KEY);
  return JSON.parse(String(call?.[2])) as Record<string, PlotActBoard>;
}

afterEach(() => {
  uninstallElectronMock();
});

describe('ActsView', () => {
  it('无内容时显示空提示', () => {
    mockIpc();
    render(<ActsView content="" folderPath="/novel" />);
    expect(screen.getByText('打开文件后查看幕剧结构')).toBeTruthy();
  });

  it('无幕结构时显示格式提示', () => {
    mockIpc();
    render(<ActsView content="只是一些普通文字" folderPath={null} />);
    expect(screen.getByText(/未检测到幕剧结构/)).toBeTruthy();
    expect(screen.getByText(/支持格式/)).toBeTruthy();
  });

  it('渲染幕选择条，点击幕切换并滚动', async () => {
    mockIpc();
    const onScrollToLine = vi.fn();
    render(<ActsView content={SCRIPT} folderPath="/novel" onScrollToLine={onScrollToLine} />);
    const chip = (title: string) =>
      screen
        .getAllByText(title)
        .find((el) => el.closest('button')?.className.includes('actSelectorChip'))
        ?.closest('button') as HTMLButtonElement;
    expect(chip('第一幕 起')).toBeTruthy();
    expect(chip('第二幕 承')).toBeTruthy();
    expect(screen.getByText('0/2')).toBeTruthy();
    expect(screen.getByText('0/1')).toBeTruthy();

    fireEvent.click(chip('第二幕 承'));
    expect(onScrollToLine).toHaveBeenCalledWith(6);
    expect(chip('第二幕 承').className).toContain('actSelectorActive');
    // 再次点击取消选择 → 回退到第一幕
    fireEvent.click(chip('第二幕 承'));
    expect(chip('第一幕 起').className).toContain('actSelectorActive');
  });

  it('故事板：编辑前提并持久化，切换结构节点', async () => {
    const mock = mockIpc();
    render(<ActsView content={SCRIPT} folderPath="/novel" />);
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledWith('db-settings-get', STORAGE_KEY));
    const premise = screen.getByPlaceholderText('这一幕开始前，人物与局势处于什么状态？');
    fireEvent.change(premise, { target: { value: '风雨欲来' } });
    await waitFor(() => expect(Object.values(savedBoards(mock))[0].premise).toBe('风雨欲来'));

    fireEvent.change(screen.getByPlaceholderText('主角在这一幕要达成什么？'), {
      target: { value: '找到真相' },
    });
    await waitFor(() => expect(Object.values(savedBoards(mock))[0].goal).toBe('找到真相'));
  });

  it('加载已保存的剧情板', async () => {
    const stored: Record<string, PlotActBoard> = {
      '0:1:第一幕 起': {
        premise: '已保存的前提',
        goal: '',
        conflict: '',
        twist: '',
        payoff: '',
        aiSuggestion: '旧的 AI 建议',
        structureNodes: [],
        sceneBoards: [],
      } as unknown as PlotActBoard,
    };
    mockIpc({ stored });
    render(<ActsView content={SCRIPT} folderPath="/novel" />);
    expect(await screen.findByDisplayValue('已保存的前提')).toBeTruthy();
    expect(screen.getByText('旧的 AI 建议')).toBeTruthy();
  });

  it('加载失败时使用空剧情板', async () => {
    const mock = mockIpc({ getError: true });
    render(<ActsView content={SCRIPT} folderPath="/novel" />);
    await waitFor(() => expect(mock.invoke).toHaveBeenCalled());
    expect(
      (screen.getByPlaceholderText('这一幕开始前，人物与局势处于什么状态？') as HTMLTextAreaElement)
        .value
    ).toBe('');
  });

  it('AI 一键建议：成功与失败', async () => {
    const mock = mockIpc({ ai: { ok: true, text: '建议：加强冲突' } });
    const { unmount } = render(<ActsView content={SCRIPT} folderPath="/novel" />);
    fireEvent.click(screen.getByRole('button', { name: 'AI 一键建议' }));
    expect(await screen.findByText('建议：加强冲突')).toBeTruthy();
    const req = mock.invoke.mock.calls.find((c) => c[0] === 'ai-request')?.[1] as {
      prompt: string;
    };
    expect(req.prompt).toContain('第一幕 起');
    unmount();

    mockIpc({ ai: { ok: false, error: '额度不足' } });
    const second = render(<ActsView content={SCRIPT} folderPath="/novel" />);
    fireEvent.click(screen.getByRole('button', { name: 'AI 一键建议' }));
    expect(await screen.findByText('额度不足')).toBeTruthy();
    second.unmount();

    mockIpc({ ai: { ok: true } });
    render(<ActsView content={SCRIPT} folderPath="/novel" />);
    fireEvent.click(screen.getByRole('button', { name: 'AI 一键建议' }));
    expect(await screen.findByText('AI 未返回内容')).toBeTruthy();
  });

  it('场景 AI 补充建议写入 outcome', async () => {
    const mock = mockIpc({ ai: { ok: true, text: '场景结果：主角受伤' } });
    render(<ActsView content={SCRIPT} folderPath="/novel" />);
    const toggle = screen
      .getAllByRole('button')
      .find(
        (el) =>
          el.getAttribute('aria-expanded') === 'false' && el.textContent?.includes('第一场 雨夜')
      );
    fireEvent.click(toggle as HTMLElement);
    fireEvent.click(screen.getAllByRole('button', { name: 'AI 补充建议' })[0]);
    await waitFor(() => {
      const board = Object.values(savedBoards(mock))[0];
      expect(board.sceneBoards[0].outcome).toBe('场景结果：主角受伤');
    });
  });

  it('切换到泳道线和因果链视图，点击场景滚动定位', () => {
    mockIpc();
    const onScrollToLine = vi.fn();
    render(<ActsView content={SCRIPT} folderPath="/novel" onScrollToLine={onScrollToLine} />);

    fireEvent.click(screen.getByRole('button', { name: '泳道线' }));
    expect(screen.getByRole('button', { name: '泳道线' }).className).toContain('layoutModeActive');
    fireEvent.click(screen.getAllByText('第二场 相遇')[0]);
    expect(onScrollToLine).toHaveBeenCalledWith(4);

    fireEvent.click(screen.getByRole('button', { name: '因果链' }));
    fireEvent.click(screen.getAllByText('第一场 雨夜')[0]);
    expect(onScrollToLine).toHaveBeenCalledWith(2);

    fireEvent.click(screen.getByRole('button', { name: '故事板' }));
    expect(screen.getByRole('button', { name: 'AI 一键建议' })).toBeTruthy();
  });

  it('泳道线拖拽重排场景并持久化', async () => {
    const mock = mockIpc();
    const { container } = render(<ActsView content={SCRIPT} folderPath="/novel" />);
    fireEvent.click(screen.getByRole('button', { name: '泳道线' }));
    const cards = Array.from(container.querySelectorAll('[draggable="true"]'));
    expect(cards.length).toBeGreaterThanOrEqual(2);
    const target = cards[1].parentElement as HTMLElement;
    fireEvent.dragStart(cards[0]);
    fireEvent.dragOver(target);
    fireEvent.drop(target);
    fireEvent.dragEnd(cards[0]);
    await waitFor(() => {
      const board = Object.values(savedBoards(mock))[0];
      expect(board.sceneBoards.map((s) => s.title)).toEqual(['第二场 相遇', '第一场 雨夜']);
    });
  });

  // BUG: ActsView.tsx 中 `actStripData` 的 useMemo 位于两个 early return 之后，
  // 违反 Rules of Hooks（注释声称"ALL hooks above"但并非如此）。
  // 当内容从"有幕结构"变为空（例如切换到空文件）时，hook 数量变化导致 React 抛错
  // "Rendered fewer hooks than expected"，整个面板崩溃。
  it('内容从有幕结构切换为空时不应崩溃', () => {
    mockIpc();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { rerender } = render(<ActsView content={SCRIPT} folderPath="/novel" />);
      rerender(<ActsView content="" folderPath="/novel" />);
      expect(screen.getByText('打开文件后查看幕剧结构')).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });
});
