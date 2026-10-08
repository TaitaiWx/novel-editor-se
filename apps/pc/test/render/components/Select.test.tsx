// @vitest-environment happy-dom
import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import Select, { type SelectItem, type SelectOption } from '@/render/components/Select';
import {
  findTypeaheadIndex,
  flattenSelectItems,
  nextEnabledIndex,
} from '@/render/components/Select/model';
import Popover from '@/render/components/Popover';
import { chooseOption, selectOptionTexts } from '../helpers/select';

type Fruit = 'apple' | 'banana' | 'blueberry' | 'cherry' | 'durian';

const OPTIONS: SelectOption<Fruit>[] = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana', description: '黄色' },
  { value: 'blueberry', label: 'Blueberry' },
  { value: 'cherry', label: 'Cherry', disabled: true },
  { value: 'durian', label: 'Durian' },
];

function Harness({
  initial = 'apple',
  options = OPTIONS,
  onChange,
  disabled,
  placeholder,
}: {
  initial?: Fruit | '';
  options?: SelectItem<Fruit>[];
  onChange?: (value: Fruit) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState<Fruit | ''>(initial);
  return (
    <div>
      <Select<Fruit>
        aria-label="水果"
        name="fruit"
        value={value}
        options={options}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
      <button type="button">外部按钮</button>
    </div>
  );
}

const trigger = () => screen.getByRole('combobox', { name: '水果' });
const listbox = () => screen.queryByRole('listbox', { name: '水果' });
const activeOption = () => {
  const id = trigger().getAttribute('aria-activedescendant');
  return id ? document.getElementById(id)?.textContent : null;
};

describe('Select', () => {
  it('点击打开、显示选中项，点击选项后选中并收起', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(trigger().textContent).toBe('Apple');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(listbox()).toBeNull();

    fireEvent.click(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    const list = listbox() as HTMLElement;
    const options = within(list).getAllByRole('option');
    expect(options).toHaveLength(5);
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(options[1].textContent).toContain('黄色');

    fireEvent.click(within(list).getByRole('option', { name: /Banana/ }));
    expect(onChange).toHaveBeenCalledWith('banana');
    expect(listbox()).toBeNull();
    expect(trigger().textContent).toBe('Banana');
    expect((document.querySelector('input[name="fruit"]') as HTMLInputElement).value).toBe(
      'banana'
    );

    // 再次点击触发器收起
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(listbox()).toBeNull();
  });

  it('禁用的选项不能选中，鼠标悬停也不会成为当前项', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(trigger());
    const cherry = screen.getByRole('option', { name: 'Cherry' });
    expect(cherry.getAttribute('aria-disabled')).toBe('true');
    fireEvent.mouseEnter(cherry);
    expect(activeOption()).toBe('Apple');
    fireEvent.click(cherry);
    expect(onChange).not.toHaveBeenCalled();
    expect(listbox()).not.toBeNull();
  });

  it('键盘：↓ 打开，↑ / ↓ / Home / End 移动（跳过禁用项），Enter 选中', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(listbox()).not.toBeNull();
    expect(activeOption()).toBe('Apple');
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(activeOption()).toBe('Blueberry');
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(activeOption()).toBe('Durian');
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(activeOption()).toBe('Durian');
    fireEvent.keyDown(trigger(), { key: 'ArrowUp' });
    expect(activeOption()).toBe('Blueberry');
    fireEvent.keyDown(trigger(), { key: 'Home' });
    expect(activeOption()).toBe('Apple');
    fireEvent.keyDown(trigger(), { key: 'End' });
    expect(activeOption()).toBe('Durian');
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('durian');
    expect(listbox()).toBeNull();

    // Space 打开、Space 选中当前项（未变化不触发 onChange）
    fireEvent.keyDown(trigger(), { key: ' ' });
    expect(activeOption()).toBe('Durian');
    fireEvent.keyDown(trigger(), { key: ' ' });
    expect(listbox()).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('Esc 关闭且不冒泡到外层，Tab 关闭', () => {
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    render(<Harness />);
    fireEvent.click(trigger());
    fireEvent.keyDown(trigger(), { key: 'Escape' });
    expect(listbox()).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    document.removeEventListener('keydown', outer);

    fireEvent.click(trigger());
    fireEvent.keyDown(trigger(), { key: 'Tab' });
    expect(listbox()).toBeNull();
  });

  it('点击外部关闭', () => {
    render(<Harness />);
    fireEvent.click(trigger());
    expect(listbox()).not.toBeNull();
    fireEvent.mouseDown(screen.getByRole('button', { name: '外部按钮' }));
    expect(listbox()).toBeNull();
  });

  it('首字跳转：打开时移动当前项，连续按同一字符轮换；关闭时直接选中', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(trigger());
    fireEvent.keyDown(trigger(), { key: 'b' });
    expect(activeOption()).toContain('Banana');
    fireEvent.keyDown(trigger(), { key: 'b' });
    expect(activeOption()).toBe('Blueberry');
    fireEvent.keyDown(trigger(), { key: 'Escape' });

    fireEvent.keyDown(trigger(), { key: 'd' });
    expect(onChange).toHaveBeenCalledWith('durian');
    expect(listbox()).toBeNull();
  });

  it('禁用时不能打开；没有选中项时显示占位文字', () => {
    const { unmount } = render(<Harness disabled />);
    fireEvent.click(trigger());
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(listbox()).toBeNull();
    unmount();

    render(<Harness initial="" placeholder="挑一个" />);
    expect(trigger().textContent).toBe('挑一个');
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    expect(activeOption()).toBe('Apple');
  });

  it('分组：显示分组标题，选项按顺序展开', () => {
    const grouped: SelectItem<Fruit>[] = [
      { label: '常见', options: [OPTIONS[0], OPTIONS[1]] },
      { label: '少见', options: [{ value: 'durian', label: 'Durian' }] },
    ];
    const onChange = vi.fn();
    render(<Harness options={grouped} onChange={onChange} />);
    fireEvent.click(trigger());
    const groups = screen.getAllByRole('group');
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(['常见', '少见']);
    fireEvent.keyDown(trigger(), { key: 'End' });
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('durian');
  });

  it('在 Popover 里选择不会关闭外层弹层（嵌套弹层）', () => {
    const onClose = vi.fn();
    render(
      <Popover open onClose={onClose} closeOnOutsideClick>
        <Harness />
      </Popover>
    );
    expect(selectOptionTexts('水果')).toHaveLength(5);
    chooseOption('水果', 'Blueberry');
    expect(onClose).not.toHaveBeenCalled();
    expect(trigger().textContent).toBe('Blueberry');
  });
});

describe('Select model', () => {
  const flat = flattenSelectItems(OPTIONS);

  it('nextEnabledIndex 跳过禁用项、到头停住', () => {
    expect(nextEnabledIndex(flat, -1, 1)).toBe(0);
    expect(nextEnabledIndex(flat, 2, 1)).toBe(4);
    expect(nextEnabledIndex(flat, 4, -1)).toBe(2);
    expect(nextEnabledIndex(flat, 4, 1)).toBe(4);
    expect(nextEnabledIndex([{ value: 'a', label: 'a', disabled: true }], -1, 1)).toBe(-1);
  });

  it('findTypeaheadIndex 支持多字符前缀与循环查找', () => {
    expect(findTypeaheadIndex(flat, 'bl', 0)).toBe(2);
    expect(findTypeaheadIndex(flat, 'a', 2)).toBe(0);
    expect(findTypeaheadIndex(flat, 'z', 0)).toBe(-1);
    // 禁用项不会被首字跳到
    expect(findTypeaheadIndex(flat, 'c', 0)).toBe(-1);
    expect(findTypeaheadIndex(flat, '', 0)).toBe(-1);
    expect(
      findTypeaheadIndex([{ value: 'x', label: <b>节点</b>, textValue: '节点' }], '节', -1)
    ).toBe(0);
  });

  it('custom：列表底部可手动填写，回车采用；不合法时标红不采用；当前值不在选项里时触发器显示该值', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Select
        aria-label="时长"
        value="6"
        options={[
          { value: '4', label: '4 秒' },
          { value: '6', label: '6 秒' },
        ]}
        custom={{
          label: '自定义秒数',
          normalize: (text) => (/^\d+$/.test(text.trim()) ? text.trim() : null),
        }}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole('combobox', { name: '时长' }));
    const input = screen.getByLabelText('时长（自定义）') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('12');
    expect(screen.queryByRole('listbox')).toBeNull();
    rerender(
      <Select
        aria-label="时长"
        value="12"
        options={[{ value: '4', label: '4 秒' }]}
        custom={{ label: '自定义秒数' }}
        onChange={onChange}
      />
    );
    expect(screen.getByRole('combobox', { name: '时长' }).textContent).toContain('12');
    // 打开时输入框带出当前的自定义值；Esc 关闭
    fireEvent.click(screen.getByRole('combobox', { name: '时长' }));
    const again = screen.getByLabelText('时长（自定义）') as HTMLInputElement;
    expect(again.value).toBe('12');
    fireEvent.keyDown(again, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
