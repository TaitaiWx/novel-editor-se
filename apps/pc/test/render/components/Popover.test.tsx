// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import Popover from '@/render/components/Popover';

function rect(r: Partial<DOMRect>): DOMRect {
  const base = { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 };
  return { ...base, ...r, toJSON: () => ({}) } as DOMRect;
}

const CONTENT = rect({ width: 100, height: 50 });

function mockContentRect(content: DOMRect = CONTENT) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    if (this.getAttribute('data-anchor') === '1') {
      return rect({ left: 200, top: 100, width: 40, height: 20, right: 240, bottom: 120 });
    }
    return content;
  });
}

describe('Popover', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('open=false 时不渲染', () => {
    render(
      <Popover open={false} anchorRect={rect({})}>
        <span>body</span>
      </Popover>
    );
    expect(screen.queryByText('body')).toBeNull();
  });

  it('没有锚点时保持隐藏样式（未定位）', () => {
    render(
      <Popover open>
        <span>body</span>
      </Popover>
    );
    const pop = screen.getByRole('dialog');
    expect(pop.className).toContain('hidden');
  });

  it('默认放在锚点下方并左对齐', () => {
    mockContentRect();
    const anchorRect = rect({
      left: 200,
      top: 100,
      width: 40,
      height: 20,
      right: 240,
      bottom: 120,
    });
    render(
      <Popover open anchorRect={anchorRect} className="extra" zIndex={42}>
        <span>body</span>
      </Popover>
    );
    const pop = screen.getByRole('dialog');
    expect(pop.getAttribute('data-placement')).toBe('bottom');
    expect(pop.style.left).toBe('200px');
    expect(pop.style.top).toBe('128px');
    expect(pop.style.zIndex).toBe('42');
    expect(pop.className).toContain('extra');
    expect(pop.className).not.toContain('hidden');
  });

  it('align=center / end 与 crossOffset 计算水平位置', () => {
    mockContentRect();
    const anchorRect = rect({
      left: 200,
      top: 100,
      width: 40,
      height: 20,
      right: 240,
      bottom: 120,
    });
    const { rerender } = render(
      <Popover open anchorRect={anchorRect} align="center">
        <span>body</span>
      </Popover>
    );
    expect(screen.getByRole('dialog').style.left).toBe('170px');
    rerender(
      <Popover open anchorRect={anchorRect} align="end" crossOffset={5}>
        <span>body</span>
      </Popover>
    );
    expect(screen.getByRole('dialog').style.left).toBe('145px');
  });

  it('上方空间不足时从 top 翻转到 bottom', () => {
    mockContentRect();
    const anchorRect = rect({ left: 10, top: 20, width: 40, height: 20, right: 50, bottom: 40 });
    render(
      <Popover open anchorRect={anchorRect} placement="top">
        <span>body</span>
      </Popover>
    );
    expect(screen.getByRole('dialog').getAttribute('data-placement')).toBe('bottom');
  });

  it('下方空间不足时从 bottom 翻转到 top', () => {
    mockContentRect();
    const top = window.innerHeight - 30;
    const anchorRect = rect({ left: 10, top, width: 40, height: 20, right: 50, bottom: top + 20 });
    render(
      <Popover open anchorRect={anchorRect}>
        <span>body</span>
      </Popover>
    );
    const pop = screen.getByRole('dialog');
    expect(pop.getAttribute('data-placement')).toBe('top');
    expect(pop.style.top).toBe(`${top - 50 - 8}px`);
  });

  it('使用 anchorRef 定位，点击锚点不触发外部关闭，外部点击与 Escape 关闭', () => {
    mockContentRect();
    const onClose = vi.fn();
    const Host: React.FC = () => {
      const ref = React.useRef<HTMLButtonElement | null>(null);
      return (
        <>
          <button ref={ref} data-anchor="1">
            anchor
          </button>
          <Popover open anchorRef={ref} onClose={onClose} closeOnOutsideClick closeOnEscape>
            <span>body</span>
          </Popover>
        </>
      );
    };
    render(<Host />);
    expect(screen.getByRole('dialog').style.left).toBe('200px');
    fireEvent.mouseDown(screen.getByText('anchor'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('窗口 resize/scroll 时重新定位', () => {
    let left = 200;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(CONTENT);
    const Host: React.FC<{ r: DOMRect }> = ({ r }) => (
      <Popover open anchorRect={r}>
        <span>body</span>
      </Popover>
    );
    const anchor = rect({ left, top: 100, width: 40, height: 20, right: left + 40, bottom: 120 });
    render(<Host r={anchor} />);
    expect(screen.getByRole('dialog').style.left).toBe('200px');
    left = 300;
    (anchor as unknown as { left: number }).left = 300;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByRole('dialog').style.left).toBe('300px');
  });

  it('鼠标进出回调透传', () => {
    const onMouseEnter = vi.fn();
    const onMouseLeave = vi.fn();
    render(
      <Popover open onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
        <span>body</span>
      </Popover>
    );
    fireEvent.mouseEnter(screen.getByRole('dialog'));
    fireEvent.mouseLeave(screen.getByRole('dialog'));
    expect(onMouseEnter).toHaveBeenCalled();
    expect(onMouseLeave).toHaveBeenCalled();
  });
});
