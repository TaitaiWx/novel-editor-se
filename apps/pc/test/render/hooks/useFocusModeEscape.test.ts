// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { canEscapeExitFocus, useFocusModeEscape } from '@/render/hooks/useFocusModeEscape';

function pressEscape(target: EventTarget = document.body, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useFocusModeEscape', () => {
  it('专注模式下 Esc 退出专注模式', () => {
    const exit = vi.fn();
    renderHook(() => useFocusModeEscape(true, exit));
    const event = pressEscape();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('非专注模式下不响应', () => {
    const exit = vi.fn();
    renderHook(() => useFocusModeEscape(false, exit));
    pressEscape();
    expect(exit).not.toHaveBeenCalled();
  });

  it('切换为非专注模式后移除监听', () => {
    const exit = vi.fn();
    const { rerender } = renderHook(({ on }) => useFocusModeEscape(on, exit), {
      initialProps: { on: true },
    });
    rerender({ on: false });
    pressEscape();
    expect(exit).not.toHaveBeenCalled();
  });

  it('有对话框打开时不退出（即使对话框在 document 上同步关闭自己）', () => {
    const exit = vi.fn();
    renderHook(() => useFocusModeEscape(true, exit));
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    // 模拟弹层：在 document 冒泡阶段关闭自己，不调用 preventDefault
    const closeOnEsc = () => dialog.remove();
    document.addEventListener('keydown', closeOnEsc);
    pressEscape();
    document.removeEventListener('keydown', closeOnEsc);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(exit).not.toHaveBeenCalled();
    // 弹层关闭后，下一次 Esc 才退出专注模式
    pressEscape();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('OverlayPortal 弹层（data-overlay-layer）打开时不退出', () => {
    const exit = vi.fn();
    renderHook(() => useFocusModeEscape(true, exit));
    const layer = document.createElement('div');
    layer.setAttribute('data-overlay-layer', '');
    document.body.appendChild(layer);
    pressEscape();
    expect(exit).not.toHaveBeenCalled();
  });

  it('编辑器搜索面板打开时 Esc 关闭搜索，不退出专注模式', () => {
    const exit = vi.fn();
    renderHook(() => useFocusModeEscape(true, exit));
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const panel = document.createElement('div');
    panel.className = 'cm-sp-panel';
    const closeSearch = vi.fn(() => {
      panel.remove();
      return true;
    });
    const view = new EditorView({
      state: EditorState.create({ extensions: [keymap.of([{ key: 'Escape', run: closeSearch }])] }),
      parent,
    });
    view.dom.appendChild(panel);
    const event = pressEscape(view.contentDOM);
    expect(closeSearch).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(exit).not.toHaveBeenCalled();
    view.destroy();
  });

  it('其他处理器已 preventDefault 时不退出', () => {
    const exit = vi.fn();
    renderHook(() => useFocusModeEscape(true, exit));
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.addEventListener('keydown', (e) => e.preventDefault());
    pressEscape(button);
    expect(exit).not.toHaveBeenCalled();
  });

  it('输入法组字时不退出', () => {
    const exit = vi.fn();
    renderHook(() => useFocusModeEscape(true, exit));
    pressEscape(document.body, { isComposing: true });
    pressEscape(document.body, { keyCode: 229 });
    expect(exit).not.toHaveBeenCalled();
  });

  it('焦点在普通输入框时 Esc 留给输入框；在编辑器正文中时退出', () => {
    const exit = vi.fn();
    renderHook(() => useFocusModeEscape(true, exit));
    const input = document.createElement('input');
    document.body.appendChild(input);
    pressEscape(input);
    expect(exit).not.toHaveBeenCalled();

    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({ state: EditorState.create({ doc: '正文' }), parent });
    pressEscape(view.contentDOM);
    expect(exit).toHaveBeenCalledTimes(1);
    view.destroy();
  });
});

describe('canEscapeExitFocus', () => {
  it('只接受不带修饰键、非重复的 Esc', () => {
    const make = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);
    expect(canEscapeExitFocus(make({ key: 'Escape' }))).toBe(true);
    expect(canEscapeExitFocus(make({ key: 'Enter' }))).toBe(false);
    expect(canEscapeExitFocus(make({ key: 'Escape', shiftKey: true }))).toBe(false);
    expect(canEscapeExitFocus(make({ key: 'Escape', repeat: true }))).toBe(false);
  });
});
