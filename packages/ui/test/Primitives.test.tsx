// @vitest-environment happy-dom
import React, { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Avatar, Button, Input, TextArea, WindowControls } from '@novel-editor/ui';

describe('共享基础控件的原生语义', () => {
  it('按钮透传 ref、禁用、表单提交和外部样式', () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const ref = createRef<HTMLButtonElement>();
    const { rerender } = render(
      <form onSubmit={submit}>
        <Button ref={ref} variant="primary" className="custom">
          保存
        </Button>
      </form>
    );
    const button = screen.getByRole('button', { name: '保存' });
    expect(ref.current).toBe(button);
    expect(button.classList.contains('custom')).toBe(true);
    expect(button.getAttribute('data-variant')).toBe('primary');
    fireEvent.click(button);
    expect(submit).toHaveBeenCalledOnce();
    rerender(
      <form onSubmit={submit}>
        <Button disabled unstyled>
          保存
        </Button>
      </form>
    );
    fireEvent.click(screen.getByRole('button'));
    expect(submit).toHaveBeenCalledOnce();
    expect(screen.getByRole('button').getAttribute('data-variant')).toBeNull();
  });

  it.each([false, true])('单行/多行输入透传值、事件和 ref，unstyled=%s', (unstyled) => {
    const input = createRef<HTMLInputElement>();
    const textarea = createRef<HTMLTextAreaElement>();
    const change = vi.fn();
    render(
      <>
        <Input
          ref={input}
          aria-label="名称"
          defaultValue="原名"
          unstyled={unstyled}
          onChange={change}
          className="name"
        />
        <TextArea
          ref={textarea}
          aria-label="描述"
          defaultValue="第一行\n第二行"
          unstyled={unstyled}
          onChange={change}
          rows={4}
        />
      </>
    );
    expect(input.current?.value).toBe('原名');
    expect(textarea.current?.getAttribute('rows')).toBe('4');
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '新名' } });
    fireEvent.change(screen.getByLabelText('描述'), { target: { value: '新描述' } });
    expect(change).toHaveBeenCalledTimes(2);
    expect(textarea.current?.value).toBe('新描述');
  });

  it('头像无图片时使用完整 Unicode 首字，空名称兜底，有图片时禁止拖拽', () => {
    const { container, rerender } = render(<Avatar name=" 🐉龙" size={40} />);
    expect(container.textContent).toBe('🐉');
    rerender(<Avatar name=" " />);
    expect(container.textContent).toBe('?');
    rerender(
      <Avatar name="林舟" src="/portrait.png" size={64} color="#aabbcc" className="portrait" />
    );
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/portrait.png');
    expect(img.getAttribute('draggable')).toBe('false');
    expect(img.style.width).toBe('64px');
  });

  it('窗口按钮只调用注入的回调，最大化状态改变操作名称', () => {
    const actions = { onMinimize: vi.fn(), onToggleMaximize: vi.fn(), onClose: vi.fn() };
    const { rerender } = render(<WindowControls isMaximized={false} {...actions} />);
    fireEvent.click(screen.getByLabelText('最小化窗口'));
    fireEvent.click(screen.getByLabelText('最大化窗口'));
    fireEvent.click(screen.getByLabelText('关闭窗口'));
    Object.values(actions).forEach((action) => expect(action).toHaveBeenCalledOnce());
    rerender(<WindowControls platform="win32" isMaximized {...actions} />);
    fireEvent.click(screen.getByLabelText('还原窗口'));
    expect(actions.onToggleMaximize).toHaveBeenCalledTimes(2);
  });
});
