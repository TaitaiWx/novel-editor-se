// @vitest-environment happy-dom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Checkbox from '@/render/components/Checkbox';

afterEach(() => cleanup());

function Controlled({ onChange }: { onChange?: (checked: boolean) => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <Checkbox
      checked={checked}
      onChange={(next) => {
        setChecked(next);
        onChange?.(next);
      }}
      label="遵循章纲"
    />
  );
}

describe('Checkbox', () => {
  it('保留真实 checkbox 语义，可按名称找到', () => {
    render(<Checkbox label="角色卡" defaultChecked />);
    const box = screen.getByRole('checkbox', { name: '角色卡' });
    expect(box).toBeInstanceOf(HTMLInputElement);
    expect((box as HTMLInputElement).checked).toBe(true);
  });

  it('点击方框与点击标签都能切换（受控）', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: '遵循章纲' }) as HTMLInputElement;
    await user.click(box);
    expect(box.checked).toBe(true);
    await user.click(screen.getByText('遵循章纲'));
    expect(box.checked).toBe(false);
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it('Space 键切换', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox label="资料卡" onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: '资料卡' }) as HTMLInputElement;
    box.focus();
    await user.keyboard(' ');
    expect(box.checked).toBe(true);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('受控值不变时不会自行切换', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox label="锁定" checked={false} onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: '锁定' }) as HTMLInputElement;
    await user.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(box.checked).toBe(false);
  });

  it('indeterminate 设置 DOM 属性与 aria-checked="mixed"', () => {
    const { rerender } = render(<Checkbox label="全选" indeterminate checked={false} />);
    const box = screen.getByRole('checkbox', { name: '全选' }) as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    expect(box.getAttribute('aria-checked')).toBe('mixed');
    rerender(<Checkbox label="全选" checked />);
    expect(box.indeterminate).toBe(false);
    expect(box.hasAttribute('aria-checked')).toBe(false);
  });

  it('disabled 时不可切换', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox label="设定资料" disabled onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: '设定资料' }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    await user.click(screen.getByText('设定资料'));
    expect(onChange).not.toHaveBeenCalled();
    expect(box.checked).toBe(false);
  });

  it('透传 aria-label / id / name / data-testid，说明文字经 aria-describedby 关联', () => {
    render(
      <Checkbox
        aria-label="仅高亮首次"
        id="first-only"
        name="firstOnly"
        data-testid="first-only"
        description="每章只高亮第一次出现"
      />
    );
    const box = screen.getByTestId('first-only');
    expect(box).toBe(screen.getByRole('checkbox', { name: '仅高亮首次' }));
    expect(box.id).toBe('first-only');
    expect(box.getAttribute('name')).toBe('firstOnly');
    const describedBy = box.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe('每章只高亮第一次出现');
  });

  it('自绘方框对读屏隐藏', () => {
    const { container } = render(<Checkbox label="x" />);
    expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
  });
});
