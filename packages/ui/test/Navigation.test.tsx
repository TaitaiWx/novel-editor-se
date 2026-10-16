// @vitest-environment happy-dom
import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Tabs from '@novel-editor/ui/Tabs';
import TabBar from '@novel-editor/ui/TabBar';
import SettingsButton from '@novel-editor/ui/SettingsButton';
import SearchMultiSelect from '@novel-editor/ui/SearchMultiSelect';

const items = [
  { id: 'all', label: '全部', badge: 3, panelId: 'all-panel' },
  { id: 'locked', label: '禁用', disabled: true },
  { id: 'done', label: '完成', error: true },
];

describe('导航与多选', () => {
  it('Tab 键盘环绕跳过禁用项，Home/End 定位，IME 不切换', () => {
    function Harness() {
      const [value, setValue] = useState('all');
      return <Tabs label="状态" items={items} value={value} onChange={setValue} />;
    }
    render(<Harness />);
    const all = screen.getByRole('tab', { name: /全部/ });
    const done = screen.getByRole('tab', { name: /完成/ });
    fireEvent.keyDown(all, { key: 'ArrowRight', isComposing: true });
    expect(all.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(all, { key: 'ArrowRight' });
    expect(done.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(done);
    fireEvent.keyDown(done, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(all);
    fireEvent.keyDown(all, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(done);
    fireEvent.keyDown(done, { key: 'Home' });
    expect(document.activeElement).toBe(all);
    fireEvent.keyDown(all, { key: 'End' });
    expect(document.activeElement).toBe(done);
    fireEvent.click(all);
    expect(all.getAttribute('aria-selected')).toBe('true');
  });

  it('失效选中值仍可键盘进入，全部禁用时不触发变更', () => {
    const change = vi.fn();
    const { rerender } = render(
      <Tabs label="状态" items={items} value="missing" onChange={change} />
    );
    expect(screen.getAllByRole('tab')[0].tabIndex).toBe(0);
    rerender(
      <Tabs
        label="状态"
        items={items.map((item) => ({ ...item, disabled: true }))}
        value="missing"
        onChange={change}
      />
    );
    fireEvent.keyDown(screen.getAllByRole('tab')[0], { key: 'ArrowRight' });
    expect(change).not.toHaveBeenCalled();
  });

  it('标签关闭不触发选择，支持中键关闭和右键批量操作', () => {
    const actions = {
      onTabSelect: vi.fn(),
      onTabClose: vi.fn(),
      onCloseOtherTabs: vi.fn(),
      onCloseAllTabs: vi.fn(),
      onCloseAllAndSave: vi.fn(),
    };
    const { container, rerender } = render(
      <TabBar
        tabs={['C:\\book\\one.md', '__untitled__:新文档', '__changelog__:更新']}
        activeTab="C:\\book\\one.md"
        {...actions}
      />
    );
    fireEvent.click(screen.getByText('one.md'));
    expect(actions.onTabSelect).toHaveBeenCalledWith('C:\\book\\one.md');
    actions.onTabSelect.mockClear();
    fireEvent.click(screen.getByLabelText('Close 新文档'));
    expect(actions.onTabSelect).not.toHaveBeenCalled();
    expect(actions.onTabClose).toHaveBeenLastCalledWith('__untitled__:新文档');
    fireEvent.mouseDown(screen.getByText('更新'), { button: 1 });
    expect(actions.onTabClose).toHaveBeenLastCalledWith('__changelog__:更新');
    for (const label of ['关闭', '关闭其他', '关闭所有', '保存所有并关闭']) {
      fireEvent.contextMenu(screen.getByText('one.md'));
      fireEvent.click(within(screen.getByRole('menu')).getByText(label));
      expect(screen.queryByRole('menu')).toBeNull();
    }
    expect(actions.onCloseOtherTabs).toHaveBeenCalledWith('C:\\book\\one.md');
    expect(actions.onCloseAllTabs).toHaveBeenCalledOnce();
    expect(actions.onCloseAllAndSave).toHaveBeenCalledOnce();
    fireEvent.contextMenu(container.firstElementChild!);
    expect(within(screen.getByRole('menu')).queryByText('关闭其他')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    rerender(
      <TabBar
        tabs={['one']}
        tabLabels={{ one: '自定义标题' }}
        focusMode
        activeTab={null}
        {...actions}
      />
    );
    expect(screen.getByText('自定义标题')).toBeTruthy();
    fireEvent.contextMenu(screen.getByText('自定义标题'));
    fireEvent.click(screen.getByText('关闭其他'));
    expect(actions.onCloseOtherTabs).toHaveBeenCalledOnce();
    rerender(<TabBar tabs={[]} activeTab={null} {...actions} />);
    expect(container.textContent).toBe('');
  });

  it('设置操作使用最新回调并关闭浮层', () => {
    const wrap = vi.fn();
    const action = vi.fn();
    render(
      <SettingsButton
        wordWrap={false}
        onToggleWordWrap={wrap}
        items={[
          { key: 'reset', label: '还原布局', kind: 'action', hint: '恢复默认', onClick: action },
        ]}
      />
    );
    fireEvent.click(screen.getByLabelText('显示设置'));
    fireEvent.click(screen.getByText('自动换行'));
    expect(wrap).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByLabelText('显示设置'));
    fireEvent.click(screen.getByText('还原布局'));
    expect(action).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  function Multi({ disabled = false }: { disabled?: boolean }) {
    const [value, setValue] = useState(['missing']);
    return (
      <SearchMultiSelect
        label="人物"
        options={[
          { value: 'lin', label: '林舟' },
          { value: 'su', label: 'Su Qing' },
        ]}
        value={value}
        onChange={setValue}
        disabled={disabled}
      />
    );
  }

  it('搜索不创建选项，键盘多选/取消、移除旧引用，关闭后可以重开', () => {
    render(<Multi />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(screen.queryByLabelText('移除林舟')).toBeNull();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByLabelText('移除Su Qing')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByLabelText('移除林舟')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.queryByLabelText('移除林舟')).toBeNull();
    fireEvent.change(input, { target: { value: ' su ' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.click(screen.getByRole('option'));
    expect(screen.queryByLabelText('移除Su Qing')).toBeNull();
    fireEvent.change(input, { target: { value: '不存在' } });
    expect(screen.getByText('没有匹配的选项')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.queryByLabelText('移除不存在')).toBeNull();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(screen.getByLabelText('移除missing'));
    expect(screen.queryByLabelText('移除missing')).toBeNull();
  });

  it('禁用多选会关闭列表并禁止移除', () => {
    const { rerender } = render(<Multi />);
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeTruthy();
    rerender(<Multi disabled />);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect((screen.getByRole('combobox') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('移除missing'));
    expect(screen.getByLabelText('移除missing')).toBeTruthy();
  });
});
