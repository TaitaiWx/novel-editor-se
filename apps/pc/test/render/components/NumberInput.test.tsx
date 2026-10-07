// @vitest-environment happy-dom
import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import NumberInput, { type NumberInputProps } from '@/render/components/NumberInput';
import {
  decimalsOf,
  formatNumber,
  isNumericDraft,
  normalizeNumber,
  parseNumber,
} from '@/render/components/NumberInput/model';

type HarnessProps = Partial<Omit<NumberInputProps, 'value' | 'onChange'>> & {
  initial?: number | null;
  onChange?: (value: number) => void;
};

function Harness({ initial = 5, onChange, ...rest }: HarnessProps) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <>
      <NumberInput
        aria-label="时长"
        min={1}
        max={10}
        {...rest}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
        onClear={() => {
          setValue(null);
          rest.onClear?.();
        }}
      />
      <output data-testid="value">{value === null ? 'null' : String(value)}</output>
    </>
  );
}

const input = () => screen.getByRole('spinbutton', { name: '时长' }) as HTMLInputElement;
const current = () => screen.getByTestId('value').textContent;

describe('NumberInput', () => {
  it('渲染 spinbutton 属性、单位后缀，− / + 步进并在边界禁用', () => {
    const onChange = vi.fn();
    render(<Harness initial={9} suffix="秒" onChange={onChange} />);
    expect(input().value).toBe('9');
    expect(input().getAttribute('aria-valuenow')).toBe('9');
    expect(input().getAttribute('aria-valuemin')).toBe('1');
    expect(input().getAttribute('aria-valuemax')).toBe('10');
    expect(input().getAttribute('inputmode')).toBe('numeric');
    expect(screen.getByText('秒')).toBeTruthy();

    const plus = screen.getByRole('button', { name: '增加时长' }) as HTMLButtonElement;
    const minus = screen.getByRole('button', { name: '减少时长' }) as HTMLButtonElement;
    fireEvent.click(plus);
    expect(onChange).toHaveBeenLastCalledWith(10);
    expect(input().value).toBe('10');
    expect(plus.disabled).toBe(true);
    fireEvent.click(minus);
    expect(current()).toBe('9');
  });

  it('键盘：↑ / ↓ 步进，Shift ×10，PageUp / PageDown，Home / End 跳到边界', () => {
    render(<Harness initial={5} max={100} />);
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(current()).toBe('6');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(current()).toBe('5');
    fireEvent.keyDown(input(), { key: 'ArrowUp', shiftKey: true });
    expect(current()).toBe('15');
    fireEvent.keyDown(input(), { key: 'PageDown' });
    expect(current()).toBe('5');
    fireEvent.keyDown(input(), { key: 'PageUp' });
    expect(current()).toBe('15');
    fireEvent.keyDown(input(), { key: 'End' });
    expect(current()).toBe('100');
    fireEvent.keyDown(input(), { key: 'Home' });
    expect(current()).toBe('1');
  });

  it('拒绝非数字输入；范围内的值实时生效，超出范围在失焦时夹取', () => {
    const onChange = vi.fn();
    render(<Harness initial={5} onChange={onChange} />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'abc' } });
    expect(input().value).toBe('5');
    fireEvent.change(input(), { target: { value: '-3' } });
    // min ≥ 0 时不允许负号
    expect(input().value).toBe('5');
    fireEvent.change(input(), { target: { value: '1.5' } });
    // step 为整数时不允许小数点
    expect(input().value).toBe('5');

    fireEvent.change(input(), { target: { value: '7' } });
    expect(current()).toBe('7');
    fireEvent.change(input(), { target: { value: '70' } });
    expect(current()).toBe('7');
    expect(input().value).toBe('70');
    fireEvent.blur(input());
    expect(current()).toBe('10');
    expect(input().value).toBe('10');

    // 全角数字自动转换；Enter 提交
    fireEvent.change(input(), { target: { value: '０' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(current()).toBe('1');
  });

  it('清空：不允许为空时失焦恢复原值；允许为空时调用 onClear 与 onCommit(null)', () => {
    const { unmount } = render(<Harness initial={4} />);
    fireEvent.change(input(), { target: { value: '' } });
    fireEvent.blur(input());
    expect(input().value).toBe('4');
    expect(current()).toBe('4');
    unmount();

    const onClear = vi.fn();
    const onCommit = vi.fn();
    render(<Harness initial={4} allowEmpty onClear={onClear} onCommit={onCommit} />);
    fireEvent.change(input(), { target: { value: '' } });
    fireEvent.blur(input());
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith(null);
    expect(current()).toBe('null');
    // 空值时步进从 min 开始
    fireEvent.click(screen.getByRole('button', { name: '增加时长' }));
    expect(current()).toBe('2');
    expect(onCommit).toHaveBeenLastCalledWith(2);
  });

  it('小数：按 step 精度取整，Esc 放弃正在输入的内容', () => {
    render(<Harness initial={0.5} min={0} max={2} step={0.1} />);
    expect(input().getAttribute('inputmode')).toBe('decimal');
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(current()).toBe('0.6');
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: '1.234' } });
    fireEvent.blur(input());
    expect(current()).toBe('1.2');
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: '1.' } });
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(input().value).toBe('1.2');
  });

  it('禁用时输入框与步进按钮都不可用', () => {
    render(<Harness disabled />);
    expect(input().disabled).toBe(true);
    expect((screen.getByRole('button', { name: '增加时长' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });
});

describe('NumberInput model', () => {
  it('isNumericDraft / parseNumber / normalize / format', () => {
    expect(isNumericDraft('-1.5', true, true)).toBe(true);
    expect(isNumericDraft('-', true, false)).toBe(true);
    expect(isNumericDraft('1.2.3', true, true)).toBe(false);
    expect(isNumericDraft('1e3', true, true)).toBe(false);
    expect(parseNumber('-')).toBeNull();
    expect(parseNumber(' 12 ')).toBe(12);
    expect(decimalsOf(0.01)).toBe(2);
    expect(decimalsOf(10)).toBe(0);
    expect(normalizeNumber(0.1 + 0.2, { precision: 1 })).toBe(0.3);
    expect(normalizeNumber(15, { min: 0, max: 10, precision: 0 })).toBe(10);
    expect(formatNumber(null)).toBe('');
    expect(formatNumber(1.25, 1)).toBe('1.3');
  });
});
