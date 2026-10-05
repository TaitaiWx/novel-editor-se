// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import CopyTooltip from '@/render/components/CopyTooltip';

describe('CopyTooltip', () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function hover() {
    const wrapper = screen.getByText('label').parentElement as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    return wrapper;
  }

  it('悬停后显示完整文本，移出后隐藏', () => {
    render(
      <CopyTooltip text="full-device-id" position="bottom">
        <span>label</span>
      </CopyTooltip>
    );
    const wrapper = hover();
    const tip = screen.getByText('full-device-id');
    expect(tip.className).toContain('bottom');
    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByText('full-device-id')).toBeNull();
  });

  it('点击复制文本，显示“已复制”，1.5 秒后恢复', () => {
    render(
      <CopyTooltip text="abc">
        <span>label</span>
      </CopyTooltip>
    );
    const wrapper = hover();
    fireEvent.click(wrapper);
    expect(writeText).toHaveBeenCalledWith('abc');
    expect(screen.getByText('已复制 ✓')).toBeTruthy();
    // 连续点击会重置计时
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.click(wrapper);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('已复制 ✓')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByText('abc')).toBeTruthy();
  });

  it('text 为空时不显示提示', () => {
    render(
      <CopyTooltip text="">
        <span>label</span>
      </CopyTooltip>
    );
    hover();
    expect(document.querySelector('.tooltip')).toBeNull();
  });
});
