// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SettingsButton from '@/render/components/SettingsButton';

describe('SettingsButton', () => {
  it('没有任何菜单项时点击不打开弹层', () => {
    render(<SettingsButton />);
    fireEvent.click(screen.getByLabelText('显示设置'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('点击打开菜单，自动换行开关切换并关闭菜单', () => {
    const onToggleWordWrap = vi.fn();
    render(<SettingsButton wordWrap={false} onToggleWordWrap={onToggleWordWrap} />);
    fireEvent.click(screen.getByLabelText('显示设置'));
    const item = screen.getByText('自动换行').closest('button') as HTMLButtonElement;
    expect(item.className).not.toContain('active');
    fireEvent.click(item);
    expect(onToggleWordWrap).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('自动换行开启时显示 active 样式', () => {
    render(<SettingsButton wordWrap onToggleWordWrap={() => {}} />);
    fireEvent.click(screen.getByLabelText('显示设置'));
    expect((screen.getByText('自动换行').closest('button') as HTMLElement).className).toContain(
      'active'
    );
  });

  it('渲染 action 与 toggle 自定义项，带 hint，点击后执行并关闭', () => {
    const onAction = vi.fn();
    const onToggle = vi.fn();
    render(
      <SettingsButton
        items={[
          { key: 'a', label: '导出', kind: 'action', hint: 'txt/md', onClick: onAction },
          { key: 't', label: '打字机模式', active: true, onClick: onToggle },
        ]}
      />
    );
    const toggle = screen.getByLabelText('显示设置');
    fireEvent.click(toggle);
    expect(screen.getByText('txt/md')).toBeTruthy();
    fireEvent.click(screen.getByText('导出'));
    expect(onAction).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(toggle);
    fireEvent.click(screen.getByText('打字机模式'));
    expect(onToggle).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('再次点击按钮、Escape 或外部点击都会关闭菜单', () => {
    render(<SettingsButton items={[{ key: 'a', label: 'A', onClick: () => {} }]} />);
    const toggle = screen.getByLabelText('显示设置');
    fireEvent.click(toggle);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(toggle);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(toggle);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
