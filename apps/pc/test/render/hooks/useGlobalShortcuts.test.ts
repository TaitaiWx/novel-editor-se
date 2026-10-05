// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useGlobalShortcuts,
  type UseGlobalShortcutsContext,
} from '@/render/hooks/useGlobalShortcuts';
import { DEFAULT_SHORTCUT_SETTINGS } from '@/render/utils/appSettings';
import { installElectronMock, uninstallElectronMock, type ElectronMock } from './electronMock';

function createCtx(activeTab: string | null = '/a.md') {
  const sidebar = document.createElement('div');
  const inside = document.createElement('span');
  sidebar.appendChild(inside);
  document.body.appendChild(sidebar);
  const fns = {
    closeTab: vi.fn(),
    handleCreateFile: vi.fn(),
    handleFormatCurrentChapter: vi.fn(),
    handleNewTab: vi.fn(),
    handleOpenLocal: vi.fn(),
    handleToggleSidebar: vi.fn(),
    toggleFocusMode: vi.fn(),
  };
  const sidebarFocusedRef = { current: false };
  const ctx = {
    ...fns,
    activeTabRef: { current: activeTab },
    appSettings: { shortcuts: DEFAULT_SHORTCUT_SETTINGS },
    sidebarFocusedRef,
    sidebarRef: { current: sidebar },
  } as unknown as UseGlobalShortcutsContext;
  return { ctx, fns, sidebar, inside, sidebarFocusedRef };
}

function press(init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

describe('useGlobalShortcuts', () => {
  let mock: ElectronMock;

  beforeEach(() => {
    mock = installElectronMock();
  });
  afterEach(() => {
    uninstallElectronMock();
    document.body.innerHTML = '';
  });

  it('挂载时注册主进程快捷键事件，卸载时清理', () => {
    const { ctx } = createCtx();
    const { unmount } = renderHook(() => useGlobalShortcuts(ctx));
    const channels = mock.on.mock.calls.map(([c]) => c);
    expect(channels).toEqual(
      expect.arrayContaining(['shortcut-new-file', 'shortcut-open-folder', 'shortcut-save-file'])
    );
    unmount();
    expect(mock.removeAllListeners).toHaveBeenCalledWith('shortcut-new-file');
  });

  it('Cmd+Q 调用 app-quit', () => {
    const { ctx } = createCtx();
    renderHook(() => useGlobalShortcuts(ctx));
    const e = press({ key: 'q', metaKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(mock.invoke).toHaveBeenCalledWith('app-quit');
  });

  it('Mod+B 切换侧边栏', () => {
    const { ctx, fns } = createCtx();
    renderHook(() => useGlobalShortcuts(ctx));
    press({ key: 'b', ctrlKey: true });
    expect(fns.handleToggleSidebar).toHaveBeenCalledTimes(1);
  });

  it('F11 与 Mod+Shift+F 切换专注模式', () => {
    const { ctx, fns } = createCtx();
    renderHook(() => useGlobalShortcuts(ctx));
    press({ key: 'F11' });
    press({ key: 'F', metaKey: true, shiftKey: true });
    expect(fns.toggleFocusMode).toHaveBeenCalledTimes(2);
  });

  it('Mod+W 关闭当前标签；无活动标签时不调用', () => {
    const a = createCtx('/a.md');
    const { unmount } = renderHook(() => useGlobalShortcuts(a.ctx));
    press({ key: 'w', metaKey: true });
    expect(a.fns.closeTab).toHaveBeenCalledWith('/a.md');
    unmount();

    const b = createCtx(null);
    renderHook(() => useGlobalShortcuts(b.ctx));
    const e = press({ key: 'w', metaKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(b.fns.closeTab).not.toHaveBeenCalled();
  });

  it('Mod+Alt+L 格式化章节', () => {
    const { ctx, fns } = createCtx();
    renderHook(() => useGlobalShortcuts(ctx));
    press({ key: 'l', metaKey: true, altKey: true });
    expect(fns.handleFormatCurrentChapter).toHaveBeenCalledTimes(1);
  });

  it('Cmd+N 新建标签，Cmd+Shift+N 不触发', () => {
    const { ctx, fns } = createCtx();
    renderHook(() => useGlobalShortcuts(ctx));
    press({ key: 'n', metaKey: true, shiftKey: true });
    expect(fns.handleNewTab).not.toHaveBeenCalled();
    press({ key: 'n', metaKey: true });
    expect(fns.handleNewTab).toHaveBeenCalledTimes(1);
  });

  it('IME 组字中的按键被忽略', () => {
    const { ctx, fns } = createCtx();
    renderHook(() => useGlobalShortcuts(ctx));
    press({ key: 'n', metaKey: true, isComposing: true });
    expect(fns.handleNewTab).not.toHaveBeenCalled();
  });

  it('普通按键不触发任何动作', () => {
    const { ctx, fns } = createCtx();
    renderHook(() => useGlobalShortcuts(ctx));
    const e = press({ key: 'a' });
    expect(e.defaultPrevented).toBe(false);
    Object.values(fns).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it('响应 app:new-file / app:open-folder 窗口事件', () => {
    const { ctx, fns } = createCtx();
    renderHook(() => useGlobalShortcuts(ctx));
    window.dispatchEvent(new Event('app:new-file'));
    window.dispatchEvent(new Event('app:open-folder'));
    expect(fns.handleCreateFile).toHaveBeenCalledTimes(1);
    expect(fns.handleOpenLocal).toHaveBeenCalledTimes(1);
  });

  it('mousedown 记录侧边栏焦点', () => {
    const { ctx, inside, sidebarFocusedRef } = createCtx();
    renderHook(() => useGlobalShortcuts(ctx));
    inside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(sidebarFocusedRef.current).toBe(true);
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(sidebarFocusedRef.current).toBe(false);
  });

  it('阻止默认的 dragover / drop 行为，卸载后恢复', () => {
    const { ctx } = createCtx();
    const { unmount } = renderHook(() => useGlobalShortcuts(ctx));
    const over = new Event('dragover', { cancelable: true, bubbles: true });
    document.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    const drop = new Event('drop', { cancelable: true, bubbles: true });
    document.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);

    unmount();
    const after = new Event('drop', { cancelable: true, bubbles: true });
    document.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});
