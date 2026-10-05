// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useThrottle } from '@/render/utils/useThrottle';

describe('useThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('首个值立即输出，间隔内变化在尾部输出最新值', () => {
    const { result, rerender } = renderHook(({ value }) => useThrottle(value, 100), {
      initialProps: { value: '第一章' },
    });
    expect(result.current).toBe('第一章');

    act(() => {
      vi.advanceTimersByTime(10);
    });
    rerender({ value: '第一章 风起' });
    rerender({ value: '第一章 风起云涌' });
    expect(result.current).toBe('第一章');

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('第一章 风起云涌');
  });

  it('间隔过后变化立即生效', () => {
    const { result, rerender } = renderHook(({ value }) => useThrottle(value, 50), {
      initialProps: { value: 1 },
    });
    act(() => {
      vi.advanceTimersByTime(60);
    });
    rerender({ value: 2 });
    expect(result.current).toBe(2);
  });

  it('卸载时清理挂起的定时器', () => {
    const { rerender, unmount } = renderHook(({ value }) => useThrottle(value, 100), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'b' });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
