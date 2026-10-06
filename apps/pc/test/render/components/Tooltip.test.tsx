// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import Tooltip from '@/render/components/Tooltip';

function rect(r: Partial<DOMRect>): DOMRect {
  const base = { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 };
  return { ...base, ...r, toJSON: () => ({}) } as DOMRect;
}

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('悬停超过延迟后显示，移出后隐藏', () => {
    render(
      <Tooltip content="提示文字" delay={200}>
        <button>trigger</button>
      </Tooltip>
    );
    const wrapper = screen.getByText('trigger').parentElement as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(60);
    });
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toBe('提示文字');
    // 渲染到 body 下（portal）
    expect(tip.parentElement).toBe(document.body);
    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('延迟期间移出则不显示', () => {
    render(
      <Tooltip content="x">
        <span>t</span>
      </Tooltip>
    );
    const wrapper = screen.getByText('t').parentElement as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    fireEvent.mouseLeave(wrapper);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('content 为空时不渲染', () => {
    render(
      <Tooltip content="">
        <span>t</span>
      </Tooltip>
    );
    fireEvent.mouseEnter(screen.getByText('t').parentElement as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('顶部空间不足时翻转到下方，并夹紧到视口内', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.getAttribute('role') === 'tooltip') return rect({ width: 100, height: 20 });
      return rect({ left: 0, top: 5, width: 10, height: 10, bottom: 15, right: 10 });
    });
    render(
      <Tooltip content="tip" position="top">
        <span>t</span>
      </Tooltip>
    );
    fireEvent.mouseEnter(screen.getByText('t').parentElement as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const tip = screen.getByRole('tooltip');
    expect(tip.className).toContain('bottom');
    expect(tip.style.top).toBe('21px');
    expect(tip.style.left).toBe('8px');
    // resize 时重新计算
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(tip.className).toContain('bottom');
  });

  it('底部空间不足时翻转到上方', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.getAttribute('role') === 'tooltip') return rect({ width: 50, height: 20 });
      const top = window.innerHeight - 15;
      return rect({ left: 200, top, width: 40, height: 10, bottom: top + 10, right: 240 });
    });
    render(
      <Tooltip content="tip" position="bottom">
        <span>t</span>
      </Tooltip>
    );
    fireEvent.mouseEnter(screen.getByText('t').parentElement as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const tip = screen.getByRole('tooltip');
    expect(tip.className).toContain('top');
    expect(tip.style.left).toBe('195px');
  });

  it('卸载时清理未触发的定时器', () => {
    const { unmount } = render(
      <Tooltip content="x">
        <span>t</span>
      </Tooltip>
    );
    fireEvent.mouseEnter(screen.getByText('t').parentElement as HTMLElement);
    unmount();
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
  });

  it('在指针下方挂载（如内容异步加载后重渲染）时也会显示提示', () => {
    const originalMatches = Element.prototype.matches;
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (
      this: Element,
      selector: string
    ) {
      if (selector === ':hover') return true;
      return originalMatches.call(this, selector);
    });
    render(
      <Tooltip content="挂载即悬停">
        <button type="button">按钮</button>
      </Tooltip>
    );
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole('tooltip').textContent).toBe('挂载即悬停');
  });
});
