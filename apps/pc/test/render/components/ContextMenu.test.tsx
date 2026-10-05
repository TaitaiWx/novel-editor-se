// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ContextMenu from '@/render/components/ContextMenu';

describe('ContextMenu', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setup() {
    const onClose = vi.fn();
    const onRename = vi.fn();
    const onDelete = vi.fn();
    const onDisabled = vi.fn();
    render(
      <ContextMenu
        x={50}
        y={60}
        onClose={onClose}
        items={[
          { label: '重命名', onClick: onRename },
          { label: '', onClick: () => {}, separator: true },
          { label: '删除', onClick: onDelete, danger: true },
          { label: '不可用', onClick: onDisabled, disabled: true },
        ]}
      />
    );
    return { onClose, onRename, onDelete, onDisabled };
  }

  it('渲染菜单项、分隔线和危险/禁用样式', () => {
    setup();
    const menu = screen.getByRole('menu');
    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.left).toBe('50px');
    expect(menu.style.top).toBe('60px');
    expect(menu.querySelectorAll('.separator')).toHaveLength(1);
    expect(screen.getByText('删除').className).toContain('danger');
    expect(screen.getByText('不可用').className).toContain('disabled');
  });

  it('点击菜单项执行回调并关闭', () => {
    const { onClose, onRename } = setup();
    fireEvent.click(screen.getByText('重命名'));
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击禁用项不执行也不关闭', () => {
    const { onClose, onDisabled } = setup();
    fireEvent.click(screen.getByText('不可用'));
    expect(onDisabled).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape 与外部点击关闭菜单，内部 mousedown 不关闭', () => {
    const { onClose } = setup();
    fireEvent.mouseDown(screen.getByText('重命名'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('靠近视口边缘时夹紧位置', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
      right: 200,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    render(
      <ContextMenu
        x={window.innerWidth - 10}
        y={window.innerHeight - 10}
        onClose={() => {}}
        items={[{ label: 'a', onClick: () => {} }]}
      />
    );
    const menu = screen.getByRole('menu');
    expect(menu.style.left).toBe(`${window.innerWidth - 208}px`);
    expect(menu.style.top).toBe(`${window.innerHeight - 108}px`);
  });
});
