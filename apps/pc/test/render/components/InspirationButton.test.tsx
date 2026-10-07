// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import InspirationButton, { INSPIRATION_TIP } from '@/render/components/InspirationButton';
import EmptyState from '@/render/components/EmptyState';
import { OPEN_INSPIRATION_EVENT } from '@/render/components/InspirationDialog/inspiration';

afterEach(() => cleanup());

function listenOpen() {
  const onOpen = vi.fn();
  window.addEventListener(OPEN_INSPIRATION_EVENT, onOpen);
  return {
    onOpen,
    dispose: () => window.removeEventListener(OPEN_INSPIRATION_EVENT, onOpen),
  };
}

describe('InspirationButton（灵感入口）', () => {
  it('文件栏胶囊：图标 + 文字「灵感」，排到操作区最前，点击打开灵感弹窗', () => {
    const { onOpen, dispose } = listenOpen();
    render(<InspirationButton shortcut="Mod+Shift+Y" />);
    const pill = screen.getByRole('button', { name: '灵感' });
    expect(pill.textContent).toBe('灵感');
    expect(pill.querySelector('svg')).toBeTruthy();
    expect(pill.className).toContain('pill');
    expect(pill.getAttribute('aria-keyshortcuts')).toBe('Mod+Shift+Y');
    expect(pill.closest('[class*="pillSlot"]')).toBeTruthy();
    fireEvent.click(pill);
    expect(onOpen).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('悬停提示说明用途并带快捷键', async () => {
    render(<InspirationButton shortcut="Mod+Shift+Y" />);
    const pill = screen.getByRole('button', { name: '灵感' });
    fireEvent.mouseEnter(pill.parentElement as HTMLElement);
    const tip = await screen.findByRole('tooltip');
    expect(tip.textContent).toContain(INSPIRATION_TIP);
    expect(tip.textContent).toMatch(/Shift \+ Y/);
  });

  it('空编辑器主操作「灵感抽签」带快捷键提示，点击打开灵感弹窗', () => {
    const { onOpen, dispose } = listenOpen();
    render(
      <EmptyState
        title="选择文件开始编辑"
        variant="file"
        actions={<InspirationButton variant="primary" shortcut="Mod+Shift+Y" />}
      />
    );
    const action = screen.getByTestId('inspiration-empty-action');
    expect(action.textContent).toMatch(/^灵感抽签/);
    expect(action.textContent).toMatch(/Shift \+ Y$/);
    expect(screen.getByRole('button', { name: '灵感抽签' })).toBe(action);
    fireEvent.click(action);
    expect(onOpen).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('EmptyState 没有 actions 时不渲染操作区', () => {
    const { container } = render(<EmptyState title="x" />);
    expect(container.querySelector('[class*="emptyActions"]')).toBeNull();
  });
});
