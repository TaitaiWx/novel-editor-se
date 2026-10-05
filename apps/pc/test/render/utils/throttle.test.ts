import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { throttle } from '@/render/utils/throttle';

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('默认 leading + trailing：首次立即执行，尾值不丢失', () => {
    const fn = vi.fn((_text: string) => undefined);
    const throttled = throttle(fn, 100);

    throttled('第一章');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith('第一章');

    vi.advanceTimersByTime(30);
    throttled('第二章');
    throttled('第三章');
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(70);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('第三章');
  });

  it('间隔已过时立即执行并清除挂起的定时器', () => {
    const fn = vi.fn((_n: number) => undefined);
    const throttled = throttle(fn, 100);
    throttled(1);
    vi.advanceTimersByTime(150);
    throttled(2);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('leading=false 时首次调用延迟到间隔结束', () => {
    const fn = vi.fn((_n: number) => undefined);
    const throttled = throttle(fn, 100, { leading: false });
    throttled(1);
    throttled(2);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(2);
  });

  it('trailing=false 时间隔内的调用被丢弃', () => {
    const fn = vi.fn((_n: number) => undefined);
    const throttled = throttle(fn, 100, { trailing: false });
    throttled(1);
    throttled(2);
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('cancel 取消挂起的 trailing 调用并重置时间', () => {
    const fn = vi.fn((_n: number) => undefined);
    const throttled = throttle(fn, 100);
    throttled(1);
    throttled(2);
    throttled.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
    throttled(3);
    expect(fn).toHaveBeenCalledTimes(2);
    throttled.cancel(); // 无定时器时也安全
  });

  it('flush 立即执行挂起调用；无挂起时不执行', () => {
    const fn = vi.fn((_n: number) => undefined);
    const throttled = throttle(fn, 100);
    throttled(1);
    throttled(2);
    throttled.flush();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(2);
    throttled.flush();
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
