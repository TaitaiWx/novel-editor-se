// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import StatusBar from '@/render/components/StatusBar';
import type { UpdateStatus } from '@/render/types/electron-api';
import {
  installElectronMock,
  uninstallElectronMock,
  type ElectronMock,
} from '../hooks/electronMock';

const baseStatus: UpdateStatus = {
  channel: 'stable',
  channelFile: 'latest',
  currentVersion: '1.2.3',
  checking: false,
  updateReady: false,
  availableVersion: null,
  downloadedVersion: null,
  downloadPercent: null,
  rollbackAvailable: false,
  rollbackVersion: null,
  preCaching: false,
  lastError: null,
};

type Props = React.ComponentProps<typeof StatusBar>;

function setup(
  status: Partial<UpdateStatus> | null = {},
  props: Partial<Props> = {},
  deviceId = 'device-1234567890'
): {
  mock: ElectronMock;
  onEncodingChange: ReturnType<typeof vi.fn>;
  rerender: (p: Partial<Props>) => void;
} {
  const mock = installElectronMock((channel) => {
    if (channel === 'update-status') return status ? { ...baseStatus, ...status } : null;
    if (channel === 'get-device-id') return deviceId;
    return undefined;
  });
  const onEncodingChange = vi.fn();
  const make = (p: Partial<Props>) => (
    <StatusBar
      content={'第一行\n第二行'}
      currentLine={2}
      currentColumn={5}
      filePath="/book/chapter-1.md"
      encoding="UTF-8"
      onEncodingChange={onEncodingChange}
      folderPath="/book"
      {...props}
      {...p}
    />
  );
  const utils = render(make({}));
  return { mock, onEncodingChange, rerender: (p) => utils.rerender(make(p)) };
}

describe('StatusBar', () => {
  afterEach(() => {
    uninstallElectronMock();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('显示光标位置、行数、字数、文件名与扩展名', async () => {
    setup();
    expect(screen.getByText('行 2, 列 5')).toBeTruthy();
    expect(screen.getByText('2 行')).toBeTruthy();
    expect(screen.getByText('chapter-1.md')).toBeTruthy();
    expect(screen.getByText('MD')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('v1.2.3')).toBeTruthy());
  });

  it('未命名与 changelog 文件的名称/扩展名', () => {
    const { rerender } = setup();
    rerender({ filePath: '__untitled__:Untitled-1' });
    expect(screen.getByText('Untitled-1')).toBeTruthy();
    expect(screen.getByText('TXT')).toBeTruthy();
    rerender({ filePath: '__changelog__:更新日志' });
    expect(screen.getByText('更新日志')).toBeTruthy();
    expect(screen.getByText('MD')).toBeTruthy();
  });

  it('文件名过长时截断', () => {
    setup({}, { filePath: '/book/a-very-long-chapter-name-indeed.txt' });
    expect(screen.getByText('a-very-long-chapter-...')).toBeTruthy();
  });

  it('没有文件时不显示光标信息', () => {
    setup({}, { filePath: null });
    expect(screen.queryByText(/行 \d+, 列/)).toBeNull();
  });

  // 回归：StatusBar/index.tsx:423 用 filePath.split('/').pop() || split('\\').pop() 取文件名，
  // Windows 路径不含 '/'，第一段 pop() 返回整个路径（非空），'\\' 分支永远不生效。
  it('Windows 路径只显示文件名', () => {
    setup({}, { filePath: 'C:\\b\\ch.md' });
    expect(screen.getByText('ch.md')).toBeTruthy();
  });

  it('版本历史按钮仅在有项目和回调时显示并可点击', () => {
    const onToggleVersionHistory = vi.fn();
    const { rerender } = setup({}, { onToggleVersionHistory });
    fireEvent.click(screen.getByTitle('版本历史'));
    expect(onToggleVersionHistory).toHaveBeenCalled();
    rerender({ folderPath: null });
    expect(screen.queryByTitle('版本历史')).toBeNull();
  });

  it('编码菜单：打开、选择编码、外部点击关闭', () => {
    const { onEncodingChange } = setup();
    fireEvent.click(screen.getByText('UTF-8'));
    expect(screen.getByText('GBK')).toBeTruthy();
    fireEvent.click(screen.getByText('GBK'));
    expect(onEncodingChange).toHaveBeenCalledWith('GBK');
    expect(screen.queryByText('Big5')).toBeNull();

    fireEvent.click(screen.getByText('UTF-8'));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('Big5')).toBeNull();
  });

  it('网络状态：在线显示正常，离线事件后显示离线', () => {
    setup();
    expect(screen.getByText('网络正常')).toBeTruthy();
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText('离线')).toBeTruthy();
    spy.mockRestore();
  });

  it('弱网：connection.effectiveType=2g', () => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: Object.assign(new EventTarget(), { effectiveType: '2g', downlink: 0.5, rtt: 800 }),
    });
    setup();
    expect(screen.getByText('弱网')).toBeTruthy();
    delete (navigator as unknown as { connection?: unknown }).connection;
  });

  it('更新面板：显示版本、设备 ID，点击检查更新', async () => {
    const { mock } = setup();
    await waitFor(() => expect(screen.getByText('v1.2.3')).toBeTruthy());
    fireEvent.click(screen.getByText('v1.2.3'));
    expect(screen.getByText('当前版本 1.2.3')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('设备 ID: device-1...')).toBeTruthy());
    fireEvent.click(screen.getByText('检查更新', { selector: 'button' }));
    expect(mock.invoke).toHaveBeenCalledWith('update-check');
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('当前版本 1.2.3')).toBeNull();
  });

  it('检查中：状态栏提示与面板按钮禁用', async () => {
    setup({ checking: true });
    await waitFor(() => expect(screen.getAllByText('检查更新中...').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('v1.2.3'));
    const btn = screen.getByText('检查中...') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('下载中显示进度', async () => {
    setup({ availableVersion: '2.0.0', downloadPercent: 42.4 });
    await waitFor(() => expect(screen.getByText('下载中 42%')).toBeTruthy());
    fireEvent.click(screen.getByText('v1.2.3'));
    expect(screen.getByText('下载 2.0.0 — 42%')).toBeTruthy();
  });

  it('预缓存回滚包状态', async () => {
    setup({ availableVersion: '2.0.0', downloadPercent: 100, preCaching: true });
    await waitFor(() => expect(screen.getByText('预缓存回滚包...')).toBeTruthy());
    fireEvent.click(screen.getByText('v1.2.3'));
    expect(screen.getByText('正在预缓存回滚包 2.0.0')).toBeTruthy();
  });

  it('发现新版本（未开始下载）', async () => {
    setup({ availableVersion: '2.0.0' });
    await waitFor(() => expect(screen.getByText('发现 2.0.0')).toBeTruthy());
    fireEvent.click(screen.getByText('v1.2.3'));
    expect(screen.getByText('发现新版本 2.0.0')).toBeTruthy();
  });

  it('更新失败显示错误', async () => {
    setup({ lastError: '网络错误' });
    await waitFor(() => expect(screen.getByText('更新失败')).toBeTruthy());
    fireEvent.click(screen.getByText('v1.2.3'));
    expect(screen.getByText('网络错误')).toBeTruthy();
  });

  it('更新就绪：点击“重启以更新”显示遮罩并调用 update-install', async () => {
    const { mock } = setup({ updateReady: true, downloadedVersion: '2.0.0' });
    await waitFor(() => expect(screen.getByText('重启以更新')).toBeTruthy());
    fireEvent.click(screen.getByText('v1.2.3'));
    expect(screen.getByText('已下载 2.0.0，点击重启安装')).toBeTruthy();
    vi.useFakeTimers();
    fireEvent.click(screen.getByText('重启以更新'));
    expect(screen.getByText('正在准备更新，即将重启...')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(mock.invoke).toHaveBeenCalledWith('update-install');
  });

  it('安装失败时移除重启遮罩', async () => {
    const mock = installElectronMock((channel) => {
      if (channel === 'update-status')
        return { ...baseStatus, updateReady: true, downloadedVersion: '2.0.0' };
      if (channel === 'update-install') throw new Error('nope');
      return 'id';
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <StatusBar
        content=""
        currentLine={1}
        currentColumn={1}
        filePath={null}
        encoding="UTF-8"
        onEncodingChange={() => {}}
        folderPath={null}
      />
    );
    await waitFor(() => expect(screen.getByText('重启以更新')).toBeTruthy());
    vi.useFakeTimers();
    fireEvent.click(screen.getByText('重启以更新'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(mock.invoke).toHaveBeenCalledWith('update-install');
    expect(screen.queryByText('正在准备更新，即将重启...')).toBeNull();
  });

  it('检查完成且无更新时短暂显示“已是最新版”，5 秒后消失', async () => {
    const { mock } = setup({ checking: true });
    await waitFor(() => expect(screen.getAllByText('检查更新中...').length).toBeGreaterThan(0));
    vi.useFakeTimers();
    act(() => mock.emit('update-state-changed', { ...baseStatus, checking: false }));
    expect(screen.getByText('已是最新版')).toBeTruthy();
    fireEvent.click(screen.getByText('v1.2.3'));
    expect(screen.getByText('已是最新版本')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText('已是最新版')).toBeNull();
  });

  it('获取更新状态失败时记录错误', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    installElectronMock(() => {
      throw new Error('ipc');
    });
    render(
      <StatusBar
        content=""
        currentLine={1}
        currentColumn={1}
        filePath={null}
        encoding="UTF-8"
        onEncodingChange={() => {}}
        folderPath={null}
      />
    );
    await waitFor(() => expect(err).toHaveBeenCalled());
    expect(screen.getByText('v')).toBeTruthy();
  });

  it('订阅主进程 update-state-changed 事件', () => {
    const { mock } = setup();
    expect(mock.on).toHaveBeenCalledWith('update-state-changed', expect.any(Function));
  });
});
