// @vitest-environment happy-dom
import React, { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import OverlayPortal from '@/render/components/OverlayPortal';

describe('OverlayPortal', () => {
  it('open=false 时不渲染', () => {
    render(
      <OverlayPortal open={false}>
        <span>content</span>
      </OverlayPortal>
    );
    expect(screen.queryByText('content')).toBeNull();
  });

  it('渲染到 document.body 并透传 div 属性，支持对象 ref', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <div id="host">
        <OverlayPortal open ref={ref} className="box" data-x="1" role="dialog">
          <span>content</span>
        </OverlayPortal>
      </div>
    );
    const box = screen.getByRole('dialog');
    expect(box.parentElement).toBe(document.body);
    expect(box.className).toBe('box');
    expect(box.getAttribute('data-x')).toBe('1');
    expect(ref.current).toBe(box);
  });

  it('支持函数 ref', () => {
    const fnRef = vi.fn();
    render(
      <OverlayPortal open ref={fnRef}>
        <span>c</span>
      </OverlayPortal>
    );
    expect(fnRef).toHaveBeenCalledWith(expect.any(HTMLDivElement));
  });

  it('closeOnOutsideClick：外部点击关闭，内部或 containRefs 内点击不关闭', () => {
    const onClose = vi.fn();
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const anchorRef = { current: anchor };
    render(
      <OverlayPortal open onClose={onClose} closeOnOutsideClick containRefs={[anchorRef]}>
        <span>inside</span>
      </OverlayPortal>
    );
    fireEvent.mouseDown(screen.getByText('inside'));
    fireEvent.mouseDown(anchor);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    anchor.remove();
  });

  it('未开启 closeOnOutsideClick / closeOnEscape 时不关闭', () => {
    const onClose = vi.fn();
    render(
      <OverlayPortal open onClose={onClose}>
        <span>c</span>
      </OverlayPortal>
    );
    fireEvent.mouseDown(document.body);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closeOnEscape：Escape 关闭，其他键与 IME 组字忽略', () => {
    const onClose = vi.fn();
    render(
      <OverlayPortal open onClose={onClose} closeOnEscape>
        <span>c</span>
      </OverlayPortal>
    );
    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.keyDown(document, { key: 'Escape', isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('关闭后移除监听', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <OverlayPortal open onClose={onClose} closeOnEscape closeOnOutsideClick>
        <span>c</span>
      </OverlayPortal>
    );
    rerender(
      <OverlayPortal open={false} onClose={onClose} closeOnEscape closeOnOutsideClick>
        <span>c</span>
      </OverlayPortal>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });
});
