// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/render/components/RightPanel/OutlineView', () => ({
  OutlineView: ({ mode }: { mode: string }) => <div data-testid={`outline-${mode}`} />,
}));
vi.mock('@/render/components/RightPanel/ActsView', () => ({
  ActsView: () => <div data-testid="acts" />,
}));

const { default: RightPanel } = await import('@/render/components/RightPanel');

function renderPanel(props: Partial<React.ComponentProps<typeof RightPanel>> = {}) {
  return render(
    <RightPanel
      content=""
      collapsed={false}
      onToggle={vi.fn()}
      folderPath="/novel"
      dbReady={false}
      {...props}
    />
  );
}

afterEach(() => cleanup());

describe('RightPanel（大纲）', () => {
  it('标题「大纲」用居中的标题样式，保留弹出与折叠按钮', () => {
    const onPopOut = vi.fn();
    const onToggle = vi.fn();
    renderPanel({ onPopOut, onToggle });
    const title = screen.getByRole('heading', { name: '大纲' });
    expect(title.className).toContain('panelTitle');
    fireEvent.click(screen.getByRole('button', { name: '在新窗口中打开' }));
    fireEvent.click(screen.getByRole('button', { name: '折叠面板' }));
    expect(onPopOut).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('只有 目录 / 章纲 / 卷纲 三个视图，默认目录', () => {
    renderPanel({ scopeKind: 'chapter' });
    const toggles = screen
      .getAllByRole('button')
      .filter((button) => button.hasAttribute('aria-pressed'));
    expect(toggles.map((button) => button.textContent)).toEqual(['目录', '章纲', '卷纲']);
    expect(screen.getByRole('button', { name: '目录' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('outline-catalog')).toBeTruthy();
    expect(screen.queryByText('三签卡')).toBeNull();
    expect(screen.queryByText('成长')).toBeNull();
    expect(screen.queryByText('当前章人物')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '章纲' }));
    expect(screen.getByTestId('outline-outline')).toBeTruthy();
    expect(screen.getByRole('button', { name: '章纲' }).getAttribute('title')).toBe('本章的章纲');

    fireEvent.click(screen.getByRole('button', { name: '卷纲' }));
    expect(screen.getByTestId('acts')).toBeTruthy();
  });

  it('未打开作品时给出说明；折叠时只剩展开按钮', () => {
    const { rerender } = renderPanel({ enabled: false });
    expect(screen.getByText('打开作品后，可在这里查看目录、章纲与卷纲。')).toBeTruthy();
    rerender(
      <RightPanel content="" collapsed onToggle={vi.fn()} folderPath={null} dbReady={false} />
    );
    expect(screen.getByTitle('展开面板')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '大纲' })).toBeNull();
  });
});
