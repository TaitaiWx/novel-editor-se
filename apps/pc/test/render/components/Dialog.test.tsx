// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import DialogProvider, { useDialog } from '@/render/components/Dialog';

type DialogApi = ReturnType<typeof useDialog>;

function setup() {
  let api: DialogApi | null = null;
  const Capture: React.FC = () => {
    api = useDialog();
    return null;
  };
  render(
    <DialogProvider>
      <Capture />
    </DialogProvider>
  );
  return () => api as unknown as DialogApi;
}

describe('Dialog', () => {
  it('useDialog 在 Provider 之外使用时抛错', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useDialog())).toThrow(/DialogProvider/);
    spy.mockRestore();
  });

  it('confirm 展示标题与消息，点击确定 resolve true 并关闭', async () => {
    const api = setup();
    let p: Promise<boolean> = Promise.resolve(false);
    act(() => {
      p = api().confirm('删除文件？', '此操作不可撤销');
    });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('删除文件？')).toBeTruthy();
    expect(screen.getByText('此操作不可撤销')).toBeTruthy();
    // confirm 模式下自动聚焦确定按钮
    expect(document.activeElement?.textContent).toBe('确定');
    fireEvent.click(screen.getByText('确定'));
    await expect(p).resolves.toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('confirm 点击取消 resolve false', async () => {
    const api = setup();
    let p: Promise<boolean> = Promise.resolve(true);
    act(() => {
      p = api().confirm('确认？');
    });
    fireEvent.click(screen.getByText('取消'));
    await expect(p).resolves.toBe(false);
  });

  it('confirm 按 Escape resolve false，按 Enter resolve true', async () => {
    const api = setup();
    let p: Promise<boolean> = Promise.resolve(true);
    act(() => {
      p = api().confirm('A');
    });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await expect(p).resolves.toBe(false);

    act(() => {
      p = api().confirm('B');
    });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
    await expect(p).resolves.toBe(true);
  });

  it('IME 组字中的 Enter 不提交', () => {
    const api = setup();
    act(() => {
      void api().confirm('A');
    });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter', keyCode: 229 });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('点击遮罩取消，点击对话框内部不取消', async () => {
    const api = setup();
    let p: Promise<boolean> = Promise.resolve(true);
    act(() => {
      p = api().confirm('A');
    });
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement);
    await expect(p).resolves.toBe(false);
  });

  it('prompt 使用默认值并聚焦输入框，确定时 resolve 输入内容', async () => {
    const api = setup();
    let p: Promise<string | null> = Promise.resolve(null);
    act(() => {
      p = api().prompt('重命名', '输入名称', '旧名');
    });
    const input = screen.getByPlaceholderText('输入名称') as HTMLInputElement;
    expect(input.value).toBe('旧名');
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: '新名' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await expect(p).resolves.toBe('新名');
  });

  it('prompt 取消时 resolve null', async () => {
    const api = setup();
    let p: Promise<string | null> = Promise.resolve('x');
    act(() => {
      p = api().prompt('名称');
    });
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByText('取消'));
    await expect(p).resolves.toBeNull();
  });

  it('Tab 焦点在对话框内循环', () => {
    const api = setup();
    act(() => {
      void api().prompt('名称');
    });
    const input = screen.getByRole('textbox');
    const confirmBtn = screen.getByText('确定');
    confirmBtn.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirmBtn);
    // 非边界元素上的 Tab 不拦截
    screen.getByText('取消').focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true, bubbles: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    // 非 Tab 键忽略
    fireEvent.keyDown(document, { key: 'a' });
  });
});
