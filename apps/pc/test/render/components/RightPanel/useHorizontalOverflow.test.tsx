// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  computeHorizontalOverflow,
  useHorizontalOverflow,
} from '@/render/components/RightPanel/useHorizontalOverflow';

describe('computeHorizontalOverflow', () => {
  it('内容未溢出时两侧都无渐隐', () => {
    expect(
      computeHorizontalOverflow({ scrollLeft: 0, scrollWidth: 200, clientWidth: 200 })
    ).toEqual({ start: false, end: false });
    // 1px 以内的小数误差视为未溢出
    expect(
      computeHorizontalOverflow({ scrollLeft: 0, scrollWidth: 200.5, clientWidth: 200 })
    ).toEqual({ start: false, end: false });
  });

  it('溢出时按滚动位置判断左右两侧', () => {
    expect(
      computeHorizontalOverflow({ scrollLeft: 0, scrollWidth: 300, clientWidth: 140 })
    ).toEqual({ start: false, end: true });
    expect(
      computeHorizontalOverflow({ scrollLeft: 60, scrollWidth: 300, clientWidth: 140 })
    ).toEqual({ start: true, end: true });
    expect(
      computeHorizontalOverflow({ scrollLeft: 160, scrollWidth: 300, clientWidth: 140 })
    ).toEqual({ start: true, end: false });
  });
});

function setMetrics(element: HTMLElement, metrics: Record<string, number>) {
  for (const [key, value] of Object.entries(metrics)) {
    Object.defineProperty(element, key, { configurable: true, value, writable: true });
  }
}

const Probe: React.FC = () => {
  const { ref, overflow, update } = useHorizontalOverflow<HTMLDivElement>();
  return (
    <div>
      <div
        ref={ref}
        data-testid="scroller"
        data-start={String(overflow.start)}
        data-end={String(overflow.end)}
      />
      <button type="button" onClick={update}>
        recalc
      </button>
    </div>
  );
};

describe('useHorizontalOverflow', () => {
  it('滚动时更新两侧溢出状态', () => {
    render(<Probe />);
    const scroller = screen.getByTestId('scroller');
    expect(scroller.dataset.end).toBe('false');

    setMetrics(scroller, { scrollWidth: 300, clientWidth: 140, scrollLeft: 0 });
    act(() => {
      fireEvent.click(screen.getByText('recalc'));
    });
    expect(scroller.dataset.start).toBe('false');
    expect(scroller.dataset.end).toBe('true');

    setMetrics(scroller, { scrollLeft: 160 });
    act(() => {
      fireEvent.scroll(scroller);
    });
    expect(scroller.dataset.start).toBe('true');
    expect(scroller.dataset.end).toBe('false');
  });
});
