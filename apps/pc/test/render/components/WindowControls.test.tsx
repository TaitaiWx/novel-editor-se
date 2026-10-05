// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import WindowControls from '@/render/components/WindowControls';
import { installElectronMock, uninstallElectronMock } from '../hooks/electronMock';

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua });
}

describe('WindowControls', () => {
  afterEach(() => {
    uninstallElectronMock();
    vi.restoreAllMocks();
  });

  it('按 userAgent 设置平台类名', () => {
    installElectronMock(() => false);
    setUserAgent('Mozilla/5.0 (Windows NT 10.0)');
    const { container, unmount } = render(<WindowControls />);
    expect((container.firstChild as HTMLElement).className).toContain('windows');
    unmount();

    setUserAgent('Mozilla/5.0 (X11; Linux x86_64)');
    const linux = render(<WindowControls />);
    expect((linux.container.firstChild as HTMLElement).className).toContain('linux');
    linux.unmount();

    setUserAgent('Mozilla/5.0 (Macintosh)');
    const mac = render(<WindowControls />);
    expect((mac.container.firstChild as HTMLElement).className).toContain('darwin');
  });

  it('挂载时查询是否最大化并显示“还原”', async () => {
    const mock = installElectronMock((c) => (c === 'window-is-maximized' ? true : undefined));
    render(<WindowControls />);
    await waitFor(() => expect(screen.getByLabelText('还原窗口')).toBeTruthy());
    expect(mock.invoke).toHaveBeenCalledWith('window-is-maximized');
  });

  it('点击按钮调用对应 IPC，最大化后切换图标状态', async () => {
    const mock = installElectronMock(() => false);
    render(<WindowControls />);
    fireEvent.click(screen.getByLabelText('最小化窗口'));
    expect(mock.invoke).toHaveBeenCalledWith('window-minimize');
    fireEvent.click(screen.getByLabelText('最大化窗口'));
    await waitFor(() => expect(screen.getByLabelText('还原窗口')).toBeTruthy());
    expect(mock.invoke).toHaveBeenCalledWith('window-maximize');
    fireEvent.click(screen.getByLabelText('关闭窗口'));
    expect(mock.invoke).toHaveBeenCalledWith('window-close');
  });

  it('IPC 失败时吞掉异常，最大化状态不变', async () => {
    const mock = installElectronMock((c) => {
      if (c === 'window-is-maximized') throw new Error('x');
      throw new Error('fail');
    });
    render(<WindowControls />);
    fireEvent.click(screen.getByLabelText('最小化窗口'));
    fireEvent.click(screen.getByLabelText('最大化窗口'));
    fireEvent.click(screen.getByLabelText('关闭窗口'));
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledTimes(4));
    expect(screen.getByLabelText('最大化窗口')).toBeTruthy();
  });

  it('没有 electron 时也能渲染', () => {
    render(<WindowControls />);
    expect(screen.getByLabelText('最大化窗口')).toBeTruthy();
  });
});
