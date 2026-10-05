// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  requestOpenAboutDialog,
  useAboutDialogListener,
} from '@/render/hooks/useAboutDialogListener';
import { installElectronMock, uninstallElectronMock } from './electronMock';

afterEach(() => {
  uninstallElectronMock();
});

describe('useAboutDialogListener', () => {
  it('应用菜单 menu-open-about 与渲染进程事件都会打开关于对话框', () => {
    const mock = installElectronMock();
    const setShowAboutDialog = vi.fn();
    const { unmount } = renderHook(() => useAboutDialogListener({ setShowAboutDialog }));

    act(() => mock.emit('menu-open-about'));
    act(() => requestOpenAboutDialog());
    expect(setShowAboutDialog).toHaveBeenCalledTimes(2);
    expect(setShowAboutDialog).toHaveBeenCalledWith(true);

    // 卸载后不再响应
    unmount();
    act(() => mock.emit('menu-open-about'));
    act(() => requestOpenAboutDialog());
    expect(setShowAboutDialog).toHaveBeenCalledTimes(2);
  });

  it('没有 electron 桥时仍响应渲染进程事件', () => {
    const setShowAboutDialog = vi.fn();
    renderHook(() => useAboutDialogListener({ setShowAboutDialog }));
    act(() => requestOpenAboutDialog());
    expect(setShowAboutDialog).toHaveBeenCalledWith(true);
  });
});
