// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  APP_SAVE_AS_FILE_EVENT,
  APP_SAVE_FILE_EVENT,
  useAppMenu,
  type UseAppMenuContext,
} from '@/render/hooks/useAppMenu';
import {
  registerActiveEditor,
  type ActiveEditorHandle,
  type ActiveEditorRegistration,
} from '@/render/components/TextEditor/active-editor';
import { DEFAULT_SHORTCUT_SETTINGS } from '@/render/utils/appSettings';
import { APP_MENU_EVENTS } from '../../../src/shared/app-menu';
import { OPEN_INSPIRATION_EVENT } from '@/render/components/InspirationDialog/inspiration';
import {
  installElectronMock,
  uninstallElectronMock,
  type ElectronMock,
  type InvokeHandler,
} from './electronMock';
import { makeDialog, makeToast } from './hookCtx';

function createCtx(options: { prompts?: Array<string | null>; confirm?: boolean } = {}) {
  const fns = {
    setShowShortcuts: vi.fn(),
    setSettingsCenterTab: vi.fn(),
    setShowSettingsCenter: vi.fn(),
    handleToggleSidebar: vi.fn(),
    handleToggleRightPanel: vi.fn(),
    toggleFocusMode: vi.fn(),
    openFileInTab: vi.fn(),
    refreshCurrentFolder: vi.fn(async () => undefined),
    handleSaveUntitled: vi.fn(async () => undefined),
  };
  const toast = makeToast();
  const dialog = makeDialog(options);
  const ctx = {
    ...fns,
    toast,
    dialog,
    appSettings: { shortcuts: { ...DEFAULT_SHORTCUT_SETTINGS } },
  } as unknown as UseAppMenuContext;
  return { ctx, fns, toast, dialog };
}

function makeEditor(
  filePath: string | null,
  content = '正文'
): ActiveEditorHandle & {
  save: ReturnType<typeof vi.fn>;
  openSearch: ReturnType<typeof vi.fn>;
} {
  return {
    save: vi.fn(),
    openSearch: vi.fn(),
    getSnapshot: () => ({ filePath, content, readOnly: false }),
  };
}

describe('useAppMenu', () => {
  let mock: ElectronMock;
  const registrations: ActiveEditorRegistration[] = [];
  const register = (handle: ActiveEditorHandle) => {
    const registration = registerActiveEditor(handle);
    registrations.push(registration);
    return registration;
  };

  function install(handler?: InvokeHandler) {
    mock = installElectronMock(handler);
  }

  beforeEach(() => install());
  afterEach(() => {
    registrations.splice(0).forEach((r) => r.dispose());
    uninstallElectronMock();
  });

  it('菜单事件分发到对应动作，卸载后取消订阅', () => {
    const { ctx, fns } = createCtx();
    const { unmount } = renderHook(() => useAppMenu(ctx));

    act(() => mock.emit(APP_MENU_EVENTS.openSettings));
    expect(fns.setSettingsCenterTab).toHaveBeenCalledWith('general');
    expect(fns.setShowSettingsCenter).toHaveBeenCalledWith(true);

    act(() => mock.emit(APP_MENU_EVENTS.toggleSidebar));
    act(() => mock.emit(APP_MENU_EVENTS.toggleRightPanel));
    act(() => mock.emit(APP_MENU_EVENTS.toggleFocusMode));
    act(() => mock.emit(APP_MENU_EVENTS.showShortcuts));
    act(() => mock.emit(APP_MENU_EVENTS.openChangelog));
    expect(fns.handleToggleSidebar).toHaveBeenCalledOnce();
    expect(fns.handleToggleRightPanel).toHaveBeenCalledOnce();
    expect(fns.toggleFocusMode).toHaveBeenCalledOnce();
    expect(fns.setShowShortcuts).toHaveBeenCalledWith(true);
    expect(fns.openFileInTab).toHaveBeenCalledWith('__changelog__:更新日志');

    unmount();
    act(() => mock.emit(APP_MENU_EVENTS.toggleSidebar));
    expect(fns.handleToggleSidebar).toHaveBeenCalledOnce();
  });

  it('订阅的通道与 APP_MENU_EVENTS 一一对应', () => {
    const { ctx } = createCtx();
    renderHook(() => useAppMenu(ctx));
    const channels = mock.on.mock.calls.map(([channel]) => channel);
    expect(channels.sort()).toEqual(Object.values(APP_MENU_EVENTS).sort());
  });

  it('灵感抽签：菜单事件转成打开灵感弹窗的窗口事件', () => {
    const { ctx } = createCtx();
    renderHook(() => useAppMenu(ctx));
    const onOpen = vi.fn();
    window.addEventListener(OPEN_INSPIRATION_EVENT, onOpen);
    act(() => mock.emit(APP_MENU_EVENTS.openInspiration));
    window.removeEventListener(OPEN_INSPIRATION_EVENT, onOpen);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('查找：打开最近聚焦编辑器的查找面板；没有编辑器时给出提示', () => {
    const { ctx, toast } = createCtx();
    renderHook(() => useAppMenu(ctx));
    act(() => mock.emit(APP_MENU_EVENTS.find));
    expect(toast.info).toHaveBeenCalledWith('请先打开一个文件');

    const first = makeEditor('/w/a.md');
    const second = makeEditor('/w/b.md');
    const firstReg = register(first);
    register(second);
    firstReg.activate();
    act(() => mock.emit(APP_MENU_EVENTS.find));
    expect(first.openSearch).toHaveBeenCalledOnce();
    expect(second.openSearch).not.toHaveBeenCalled();
  });

  it('检查更新：调用 update-check 后按状态提示', async () => {
    install((channel) =>
      channel === 'update-status'
        ? { currentVersion: '1.0.0', lastError: null, availableVersion: null, checking: false }
        : undefined
    );
    const { ctx, toast } = createCtx();
    renderHook(() => useAppMenu(ctx));
    act(() => mock.emit(APP_MENU_EVENTS.checkUpdates));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('当前已是最新版本（1.0.0）'));
    expect(mock.invoke).toHaveBeenCalledWith('update-check');
  });

  it('检查更新失败时提示错误', async () => {
    install((channel) => {
      if (channel === 'update-check') throw new Error('网络错误');
      return undefined;
    });
    const { ctx, toast } = createCtx();
    renderHook(() => useAppMenu(ctx));
    act(() => mock.emit(APP_MENU_EVENTS.checkUpdates));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('检查更新失败：网络错误'));
  });

  it('上传日志：按结果提示，进行中不重复触发', async () => {
    let resolveRun: (value: unknown) => void = () => undefined;
    install((channel) =>
      channel === 'log-upload-run'
        ? new Promise((resolve) => {
            resolveRun = resolve;
          })
        : undefined
    );
    const { ctx, toast } = createCtx();
    renderHook(() => useAppMenu(ctx));
    act(() => mock.emit(APP_MENU_EVENTS.uploadLogs));
    act(() => mock.emit(APP_MENU_EVENTS.uploadLogs));
    expect(mock.invoke.mock.calls.filter(([c]) => c === 'log-upload-run')).toHaveLength(1);
    await act(async () => resolveRun({ status: 'saved', fileName: 'a.zip', filePath: '/d/a.zip' }));
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith('日志已打包到 下载/a.zip，可发送给我们')
    );
  });

  it('保存：作用于最近聚焦的编辑器', () => {
    const { ctx } = createCtx();
    renderHook(() => useAppMenu(ctx));
    const editor = makeEditor('/w/a.md');
    register(editor);
    window.dispatchEvent(new Event(APP_SAVE_FILE_EVENT));
    expect(editor.save).toHaveBeenCalledOnce();
  });

  it('另存为：写入同目录新文件并打开', async () => {
    install((channel) => (channel === 'get-file-info-batch' ? [] : undefined));
    const { ctx, fns, toast, dialog } = createCtx({ prompts: ['第一章 修订.md'] });
    renderHook(() => useAppMenu(ctx));
    register(makeEditor('/w/正文/第一章.md', '内容'));
    window.dispatchEvent(new Event(APP_SAVE_AS_FILE_EVENT));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('已另存为「第一章 修订.md」'));
    expect(dialog.prompt).toHaveBeenCalledWith('另存为', '请输入新文件名', '第一章 副本.md');
    expect(mock.invoke).toHaveBeenCalledWith('write-file', '/w/正文/第一章 修订.md', '内容');
    expect(fns.refreshCurrentFolder).toHaveBeenCalledOnce();
    expect(fns.openFileInTab).toHaveBeenCalledWith('/w/正文/第一章 修订.md');
  });

  it('另存为：目标已存在且取消覆盖时不写入；非法文件名提示错误', async () => {
    install((channel) =>
      channel === 'get-file-info-batch' ? [{ path: '/w/b.md', info: {} }] : undefined
    );
    const { ctx, toast } = createCtx({ prompts: ['b.md', 'x/y.md'], confirm: false });
    renderHook(() => useAppMenu(ctx));
    register(makeEditor('/w/a.md'));
    window.dispatchEvent(new Event(APP_SAVE_AS_FILE_EVENT));
    await waitFor(() =>
      expect(mock.invoke).toHaveBeenCalledWith('get-file-info-batch', ['/w/b.md'])
    );
    window.dispatchEvent(new Event(APP_SAVE_AS_FILE_EVENT));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('文件名不能包含路径分隔符'));
    expect(mock.invoke.mock.calls.some(([c]) => c === 'write-file')).toBe(false);
  });

  it('另存为：未命名标签走保存未命名流程；没有文件时提示', async () => {
    const { ctx, fns, toast } = createCtx();
    renderHook(() => useAppMenu(ctx));
    window.dispatchEvent(new Event(APP_SAVE_AS_FILE_EVENT));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('请先打开要另存为的文件'));

    register(makeEditor('__untitled__:Untitled-1', '草稿'));
    window.dispatchEvent(new Event(APP_SAVE_AS_FILE_EVENT));
    await waitFor(() =>
      expect(fns.handleSaveUntitled).toHaveBeenCalledWith('__untitled__:Untitled-1', '草稿')
    );
  });

  it('把自定义的侧边栏 / 专注模式 / 灵感抽签快捷键同步给主进程', () => {
    const { ctx } = createCtx();
    const { rerender } = renderHook((props: UseAppMenuContext) => useAppMenu(props), {
      initialProps: ctx,
    });
    expect(mock.invoke).toHaveBeenCalledWith('menu-sync-shortcuts', {
      toggleSidebar: 'Mod+B',
      toggleFocusMode: 'Mod+Shift+F',
      openInspiration: 'Mod+Shift+Y',
    });
    rerender({
      ...ctx,
      appSettings: {
        ...ctx.appSettings,
        shortcuts: { ...ctx.appSettings.shortcuts, toggleSidebar: 'Mod+Shift+B' },
      },
    });
    expect(mock.invoke).toHaveBeenLastCalledWith('menu-sync-shortcuts', {
      toggleSidebar: 'Mod+Shift+B',
      toggleFocusMode: 'Mod+Shift+F',
      openInspiration: 'Mod+Shift+Y',
    });
  });

  it('没有 electron 桥时不抛错', () => {
    uninstallElectronMock();
    const { ctx } = createCtx();
    expect(() => renderHook(() => useAppMenu(ctx))).not.toThrow();
  });
});
