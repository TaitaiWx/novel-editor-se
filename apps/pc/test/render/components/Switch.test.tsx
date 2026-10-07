// @vitest-environment happy-dom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Switch from '@/render/components/Switch';

afterEach(() => cleanup());

function Controlled({ onChange }: { onChange?: (checked: boolean) => void }) {
  const [checked, setChecked] = useState(true);
  return (
    <Switch
      checked={checked}
      onChange={(next) => {
        setChecked(next);
        onChange?.(next);
      }}
      label="仅在每章第一次出现时高亮"
    />
  );
}

describe('Switch', () => {
  it('role="switch" 且 aria-checked 与状态同步（受控）', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: '仅在每章第一次出现时高亮' });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await user.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect((sw as HTMLInputElement).checked).toBe(false);
    await user.click(screen.getByText('仅在每章第一次出现时高亮'));
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(onChange.mock.calls).toEqual([[false], [true]]);
  });

  it('非受控：defaultChecked 与 Space 切换', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch aria-label="自动保存" defaultChecked onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: '自动保存' });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    sw.focus();
    await user.keyboard(' ');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('disabled 时不可切换', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch label="同步" disabled onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: '同步' }) as HTMLInputElement;
    expect(sw.disabled).toBe(true);
    await user.click(screen.getByText('同步'));
    expect(onChange).not.toHaveBeenCalled();
    expect(sw.getAttribute('aria-checked')).toBe('false');
  });

  it('说明文字经 aria-describedby 关联，透传 id / name / data-testid', () => {
    render(
      <Switch label="高亮" description="关闭后全文高亮" id="hl" name="hl" data-testid="hl-switch" />
    );
    const sw = screen.getByTestId('hl-switch');
    expect(sw.id).toBe('hl');
    expect(sw.getAttribute('name')).toBe('hl');
    const describedBy = sw.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe('关闭后全文高亮');
  });
});
