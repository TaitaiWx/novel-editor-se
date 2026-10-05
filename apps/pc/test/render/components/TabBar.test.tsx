// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import TabBar, { type TabBarProps } from '@/render/components/TabBar';

function setup(overrides: Partial<TabBarProps> = {}) {
  const props: TabBarProps = {
    tabs: ['/book/ch1.md', 'C:\\book\\ch2.md', '__untitled__:Untitled-1', '__changelog__:更新日志'],
    activeTab: '/book/ch1.md',
    onTabSelect: vi.fn(),
    onTabClose: vi.fn(),
    onCloseOtherTabs: vi.fn(),
    onCloseAllTabs: vi.fn(),
    onCloseAllAndSave: vi.fn(),
    ...overrides,
  };
  const utils = render(<TabBar {...props} />);
  return { props, ...utils };
}

describe('TabBar', () => {
  it('没有标签时不渲染', () => {
    const { container } = setup({ tabs: [] });
    expect(container.firstChild).toBeNull();
  });

  it('显示文件名（支持 Windows 路径、未命名、changelog 与自定义标签）', () => {
    setup({ tabLabels: { '/book/ch1.md': '第一章' } });
    expect(screen.getByText('第一章')).toBeTruthy();
    expect(screen.getByText('ch2.md')).toBeTruthy();
    expect(screen.getByText('Untitled-1')).toBeTruthy();
    expect(screen.getByText('更新日志')).toBeTruthy();
  });

  it('活动标签有 active 样式，专注模式加类名', () => {
    const { container } = setup({ focusMode: true });
    expect(screen.getByTitle('/book/ch1.md').className).toContain('active');
    expect(screen.getByTitle('C:\\book\\ch2.md').className).not.toContain('active');
    expect((container.firstChild as HTMLElement).className).toContain('focusMode');
  });

  it('点击标签选中，点击关闭按钮关闭且不触发选中', () => {
    const { props } = setup();
    fireEvent.click(screen.getByText('ch2.md'));
    expect(props.onTabSelect).toHaveBeenCalledWith('C:\\book\\ch2.md');
    fireEvent.click(screen.getByLabelText('Close ch2.md'));
    expect(props.onTabClose).toHaveBeenCalledWith('C:\\book\\ch2.md');
    expect(props.onTabSelect).toHaveBeenCalledTimes(1);
  });

  it('鼠标中键关闭标签，左键不关闭', () => {
    const { props } = setup();
    fireEvent.mouseDown(screen.getByTitle('/book/ch1.md'), { button: 0 });
    expect(props.onTabClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByTitle('/book/ch1.md'), { button: 1 });
    expect(props.onTabClose).toHaveBeenCalledWith('/book/ch1.md');
  });

  it('标签右键菜单：关闭 / 关闭其他 / 关闭所有 / 保存所有并关闭', () => {
    const { props } = setup();
    const tab = screen.getByTitle('/book/ch1.md');

    fireEvent.contextMenu(tab, { clientX: 10, clientY: 20 });
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.click(screen.getByText('关闭'));
    expect(props.onTabClose).toHaveBeenCalledWith('/book/ch1.md');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.contextMenu(tab);
    fireEvent.click(screen.getByText('关闭其他'));
    expect(props.onCloseOtherTabs).toHaveBeenCalledWith('/book/ch1.md');

    fireEvent.contextMenu(tab);
    fireEvent.click(screen.getByText('关闭所有'));
    expect(props.onCloseAllTabs).toHaveBeenCalled();

    fireEvent.contextMenu(tab);
    fireEvent.click(screen.getByText('保存所有并关闭'));
    expect(props.onCloseAllAndSave).toHaveBeenCalled();
  });

  it('只有一个标签时“关闭其他”被禁用', () => {
    const { props } = setup({ tabs: ['/a.md'], activeTab: '/a.md' });
    fireEvent.contextMenu(screen.getByTitle('/a.md'));
    const item = screen.getByText('关闭其他');
    expect(item.className).toContain('disabled');
    fireEvent.click(item);
    expect(props.onCloseOtherTabs).not.toHaveBeenCalled();
  });

  it('在空白区域右键只显示全局项，Escape 关闭菜单', () => {
    const { container } = setup();
    fireEvent.contextMenu(container.firstChild as HTMLElement);
    expect(screen.queryByText('关闭其他')).toBeNull();
    expect(screen.getByText('关闭所有')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('未提供可选回调时点击菜单项不抛错', () => {
    setup({ onCloseAllTabs: undefined, onCloseAllAndSave: undefined, onCloseOtherTabs: undefined });
    const tab = screen.getByTitle('/book/ch1.md');
    fireEvent.contextMenu(tab);
    expect(() => fireEvent.click(screen.getByText('关闭其他'))).not.toThrow();
    fireEvent.contextMenu(tab);
    expect(() => fireEvent.click(screen.getByText('关闭所有'))).not.toThrow();
    fireEvent.contextMenu(tab);
    expect(() => fireEvent.click(screen.getByText('保存所有并关闭'))).not.toThrow();
  });
});
