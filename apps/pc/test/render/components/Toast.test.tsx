// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import ToastProvider, { useToast } from '@/render/components/Toast';

type ToastApi = ReturnType<typeof useToast>;

function setup() {
  let api: ToastApi | null = null;
  const Capture: React.FC = () => {
    api = useToast();
    return null;
  };
  render(
    <ToastProvider>
      <Capture />
    </ToastProvider>
  );
  return () => api as unknown as ToastApi;
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('useToast 在 Provider 之外使用时抛错', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useToast())).toThrow(/ToastProvider/);
    spy.mockRestore();
  });

  it('各类型方法显示对应图标与类名', () => {
    const api = setup();
    act(() => {
      api().success('保存成功');
      api().error('出错了');
      api().warning('小心');
      api().info('提示');
    });
    expect(screen.getByText('保存成功').parentElement?.className).toContain('success');
    expect(screen.getByText('出错了').parentElement?.className).toContain('error');
    expect(screen.getByText('小心').parentElement?.className).toContain('warning');
    expect(screen.getByText('提示').parentElement?.textContent).toContain('ℹ');
  });

  it('show 默认类型为 info，3 秒后进入消失动画并在 300ms 后移除', () => {
    const api = setup();
    act(() => api().show('hello'));
    const el = screen.getByText('hello').parentElement as HTMLElement;
    expect(el.className).toContain('info');
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(el.className).toContain('dismissing');
    expect(screen.queryByText('hello')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByText('hello')).toBeNull();
  });

  it('duration 为 0 时不自动消失，也没有进度条', () => {
    const api = setup();
    act(() => api().show('sticky', { duration: 0 }));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    const el = screen.getByText('sticky').parentElement as HTMLElement;
    expect(el.querySelector('.progressBar')).toBeNull();
  });

  it('点击关闭按钮移除通知', () => {
    const api = setup();
    act(() => api().error('bad', 0));
    fireEvent.click(screen.getByLabelText('关闭通知'));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByText('bad')).toBeNull();
  });

  it('最多同时显示 5 条，超出时丢弃最早的', () => {
    const api = setup();
    act(() => {
      for (let i = 1; i <= 7; i += 1) api().info(`m${i}`, 0);
    });
    expect(screen.queryByText('m1')).toBeNull();
    expect(screen.queryByText('m2')).toBeNull();
    expect(screen.getByText('m3')).toBeTruthy();
    expect(screen.getByText('m7')).toBeTruthy();
    expect(screen.getAllByLabelText('关闭通知')).toHaveLength(5);
  });
});
