// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useSidebarClipboardShortcuts,
  type UseSidebarClipboardShortcutsContext,
} from '@/render/hooks/useSidebarClipboardShortcuts';
import type { FileNode } from '@/render/types/File';

const files: FileNode[] = [
  {
    name: 'book',
    path: '/root/book',
    type: 'directory',
    children: [{ name: 'a.md', path: '/root/book/a.md', type: 'file' }],
  },
];

function createCtx(opts: { activeTab: string | null; focused?: boolean; folder?: string | null }) {
  const setClipboard = vi.fn();
  const handlePasteFiles = vi.fn();
  const ctx = {
    activeTabRef: { current: opts.activeTab },
    clipboard: [],
    filesRef: { current: files },
    folderPathRef: { current: opts.folder === undefined ? '/root' : opts.folder },
    handlePasteFiles,
    setClipboard,
    sidebarFocusedRef: { current: opts.focused ?? true },
  } as unknown as UseSidebarClipboardShortcutsContext;
  return { ctx, setClipboard, handlePasteFiles };
}

function press(init: KeyboardEventInit) {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(e);
  return e;
}

describe('useSidebarClipboardShortcuts', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('Cmd+C 复制当前活动的真实文件', () => {
    const { ctx, setClipboard } = createCtx({ activeTab: '/root/book/a.md' });
    renderHook(() => useSidebarClipboardShortcuts(ctx));
    const e = press({ key: 'c', metaKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(setClipboard).toHaveBeenCalledWith(['/root/book/a.md']);
  });

  it('Cmd+C 对虚拟路径不生效', () => {
    const { ctx, setClipboard } = createCtx({ activeTab: '__untitled__:Untitled-1' });
    renderHook(() => useSidebarClipboardShortcuts(ctx));
    const e = press({ key: 'c', ctrlKey: true });
    expect(e.defaultPrevented).toBe(false);
    expect(setClipboard).not.toHaveBeenCalled();
  });

  it('Cmd+V 粘贴到活动文件所在目录', () => {
    const { ctx, handlePasteFiles } = createCtx({ activeTab: '/root/book/a.md' });
    renderHook(() => useSidebarClipboardShortcuts(ctx));
    press({ key: 'v', metaKey: true });
    expect(handlePasteFiles).toHaveBeenCalledWith('/root/book');
  });

  it('Cmd+V 活动项为目录时粘贴到该目录', () => {
    const { ctx, handlePasteFiles } = createCtx({ activeTab: '/root/book' });
    renderHook(() => useSidebarClipboardShortcuts(ctx));
    press({ key: 'v', metaKey: true });
    expect(handlePasteFiles).toHaveBeenCalledWith('/root/book');
  });

  it('Cmd+V 无活动文件时粘贴到项目根目录；无根目录时不粘贴', () => {
    const a = createCtx({ activeTab: null });
    const { unmount } = renderHook(() => useSidebarClipboardShortcuts(a.ctx));
    press({ key: 'v', metaKey: true });
    expect(a.handlePasteFiles).toHaveBeenCalledWith('/root');
    unmount();

    const b = createCtx({ activeTab: null, folder: null });
    renderHook(() => useSidebarClipboardShortcuts(b.ctx));
    press({ key: 'v', metaKey: true });
    expect(b.handlePasteFiles).not.toHaveBeenCalled();
  });

  it('侧边栏未聚焦、无修饰键或 IME 组字时不处理', () => {
    const a = createCtx({ activeTab: '/root/book/a.md', focused: false });
    const { unmount } = renderHook(() => useSidebarClipboardShortcuts(a.ctx));
    press({ key: 'c', metaKey: true });
    expect(a.setClipboard).not.toHaveBeenCalled();
    unmount();

    const b = createCtx({ activeTab: '/root/book/a.md' });
    renderHook(() => useSidebarClipboardShortcuts(b.ctx));
    press({ key: 'c' });
    press({ key: 'c', metaKey: true, isComposing: true });
    expect(b.setClipboard).not.toHaveBeenCalled();
  });

  it.each([
    ['input', () => document.createElement('input')],
    ['textarea', () => document.createElement('textarea')],
    [
      'contenteditable',
      () => {
        const d = document.createElement('div');
        d.setAttribute('contenteditable', 'true');
        d.tabIndex = 0;
        return d;
      },
    ],
    [
      'cm-editor',
      () => {
        const wrap = document.createElement('div');
        wrap.className = 'cm-editor';
        const btn = document.createElement('button');
        wrap.appendChild(btn);
        document.body.appendChild(wrap);
        return btn;
      },
    ],
  ])('焦点在文本编辑区 (%s) 时不拦截', (_name, make) => {
    const el = make();
    if (!el.isConnected) document.body.appendChild(el);
    el.focus();
    const { ctx, setClipboard } = createCtx({ activeTab: '/root/book/a.md' });
    renderHook(() => useSidebarClipboardShortcuts(ctx));
    press({ key: 'c', metaKey: true });
    expect(setClipboard).not.toHaveBeenCalled();
  });

  it('卸载后移除监听', () => {
    const { ctx, setClipboard } = createCtx({ activeTab: '/root/book/a.md' });
    const { unmount } = renderHook(() => useSidebarClipboardShortcuts(ctx));
    unmount();
    press({ key: 'c', metaKey: true });
    expect(setClipboard).not.toHaveBeenCalled();
  });
});
