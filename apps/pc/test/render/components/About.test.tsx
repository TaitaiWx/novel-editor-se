// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AboutDialog from '@/render/components/AboutDialog';
import AboutSection from '@/render/components/AppSettingsCenter/AboutSection';
import { getRevealLabel } from '@/render/components/AboutContent';
import { buildAboutLinks, formatAboutDiagnostics, type AboutInfo } from '@/shared/about';
import {
  installElectronMock,
  uninstallElectronMock,
  type ElectronMock,
} from '../hooks/electronMock';

const DEVICE_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

function makeInfo(overrides: Partial<AboutInfo> = {}): AboutInfo {
  return {
    appName: '小说编辑器',
    productName: 'Novel Editor',
    version: '1.1.0-beta.43',
    releaseChannel: 'beta',
    updateChannel: 'beta',
    rollout: { bucket: 12, percentage: null, eligible: null, canaryEnrolled: false },
    deviceId: DEVICE_ID,
    firstRunAt: '2026-01-02T03:04:00.000Z',
    runtime: {
      electron: '42.0.0',
      chrome: '140.0.0.0',
      node: '24.15.0',
      v8: '14.0',
      platform: 'darwin',
      arch: 'arm64',
      osRelease: '24.6.0',
      isPackaged: false,
    },
    directories: [
      { key: 'userData', label: '用户数据', path: '/u/data' },
      { key: 'logs', label: '日志', path: '/u/logs' },
      { key: 'sampleData', label: '示例项目', path: '/u/docs/sample-data' },
    ],
    links: buildAboutLinks('1.1.0-beta.43'),
    ...overrides,
  };
}

interface MockOptions {
  info?: AboutInfo;
  copyResult?: { success: boolean };
  openDirResult?: { success: boolean; error?: string };
}

function mockIpc(opts: MockOptions = {}): { mock: ElectronMock; state: { info: AboutInfo } } {
  const state = { info: opts.info ?? makeInfo() };
  const mock = installElectronMock((channel, ...args) => {
    switch (channel) {
      case 'get-about-info':
        return state.info;
      case 'about-copy-text':
        return opts.copyResult ?? { success: true };
      case 'about-open-directory':
        return opts.openDirResult ?? { success: true };
      case 'about-open-link':
        return { success: true };
      case 'update-set-channel': {
        const channel = args[0] as AboutInfo['updateChannel'];
        state.info = {
          ...state.info,
          updateChannel: channel,
          rollout: { ...state.info.rollout, canaryEnrolled: channel === 'canary' },
        };
        return {};
      }
      default:
        return undefined;
    }
  });
  return { mock, state };
}

function callsOf(mock: ElectronMock, channel: string): unknown[][] {
  return mock.invoke.mock.calls.filter((call) => call[0] === channel).map((call) => call.slice(1));
}

afterEach(() => {
  uninstallElectronMock();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AboutDialog', () => {
  it('显示版本、通道徽标、完整设备 ID 与运行环境', async () => {
    mockIpc();
    render(<AboutDialog visible onClose={vi.fn()} />);
    expect(await screen.findByTestId('about-device-id')).toHaveProperty('textContent', DEVICE_ID);
    expect(screen.getByTestId('about-version').textContent).toBe('版本 1.1.0-beta.43');
    expect(screen.getByText('测试版')).toBeTruthy();
    expect(screen.getByText('用于灰度更新分组与问题排查，不包含个人信息')).toBeTruthy();
    expect(screen.getByText('macOS 24.6.0 (arm64)')).toBeTruthy();
    expect(screen.getByText('42.0.0')).toBeTruthy();
    expect(screen.getByText('开发模式')).toBeTruthy();
    expect(screen.getByText('分桶 12 · 当前为全量发布')).toBeTruthy();
    expect(screen.getByText('未加入')).toBeTruthy();
  });

  it('复制设备 ID 与诊断信息走主进程剪贴板，并显示「已复制」', async () => {
    const { mock } = mockIpc();
    render(<AboutDialog visible onClose={vi.fn()} />);
    await screen.findByTestId('about-device-id');

    fireEvent.click(screen.getByRole('button', { name: '复制设备 ID' }));
    await waitFor(() => expect(callsOf(mock, 'about-copy-text')).toEqual([[DEVICE_ID]]));
    await screen.findByText('已复制');

    fireEvent.click(screen.getByRole('button', { name: '复制诊断信息' }));
    await screen.findByText('已复制诊断信息');
    const diagnostics = callsOf(mock, 'about-copy-text')[1][0] as string;
    expect(diagnostics).toBe(formatAboutDiagnostics(makeInfo()));
    expect(diagnostics).toContain(`设备 ID: ${DEVICE_ID}`);
    expect(diagnostics).toContain('Electron: 42.0.0');
  });

  it('主进程剪贴板失败时退回 navigator.clipboard；两者都失败时提示', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error());
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    mockIpc({ copyResult: { success: false } });
    render(<AboutDialog visible onClose={vi.fn()} />);
    await screen.findByTestId('about-device-id');

    fireEvent.click(screen.getByRole('button', { name: '复制设备 ID' }));
    await screen.findByText('已复制');
    expect(writeText).toHaveBeenCalledWith(DEVICE_ID);

    fireEvent.click(screen.getByRole('button', { name: '复制诊断信息' }));
    await screen.findByText('复制失败，请手动选择文本复制');
  });

  it('打开数据目录与外部链接，失败时显示原因', async () => {
    const { mock } = mockIpc({ openDirResult: { success: false, error: '示例项目尚未创建' } });
    const onClose = vi.fn();
    const onOpenChangelog = vi.fn();
    render(<AboutDialog visible onClose={onClose} onOpenChangelog={onOpenChangelog} />);
    await screen.findByTestId('about-device-id');

    fireEvent.click(screen.getByRole('button', { name: '在访达中打开：示例项目' }));
    await screen.findByText('示例项目尚未创建');
    expect(callsOf(mock, 'about-open-directory')).toEqual([['/u/docs/sample-data']]);

    fireEvent.click(screen.getByRole('button', { name: 'GitHub' }));
    fireEvent.click(screen.getByRole('button', { name: '问题反馈' }));
    await waitFor(() =>
      expect(callsOf(mock, 'about-open-link')).toEqual([['repository'], ['issues']])
    );

    fireEvent.click(screen.getByRole('button', { name: '更新日志' }));
    expect(onClose).toHaveBeenCalled();
    expect(onOpenChangelog).toHaveBeenCalled();
  });

  it('更新设置、关闭按钮、Esc 与遮罩点击', async () => {
    mockIpc();
    const onClose = vi.fn();
    const onOpenUpdateSettings = vi.fn();
    const { container, rerender } = render(
      <AboutDialog visible onClose={onClose} onOpenUpdateSettings={onOpenUpdateSettings} />
    );
    await screen.findByTestId('about-device-id');

    fireEvent.click(screen.getByRole('button', { name: '更新设置…' }));
    expect(onOpenUpdateSettings).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '关闭关于' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(container.firstChild as HTMLElement);
    // 点击对话框内部不关闭
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(4);

    rerender(<AboutDialog visible={false} onClose={onClose} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('读取失败时显示错误', async () => {
    installElectronMock((channel) => {
      if (channel === 'get-about-info') throw new Error('主进程未就绪');
      return undefined;
    });
    render(<AboutDialog visible onClose={vi.fn()} />);
    await screen.findByText('主进程未就绪');
  });
});

describe('AboutSection', () => {
  it('切换更新通道：加入金丝雀计划后刷新信息', async () => {
    const { mock } = mockIpc();
    render(<AboutSection active />);
    await screen.findByTestId('about-device-id');

    const canary = screen.getByRole('radio', { name: '金丝雀（canary）' });
    expect(screen.getByRole('radio', { name: '测试版（beta）' }).getAttribute('aria-checked')).toBe(
      'true'
    );
    fireEvent.click(canary);
    await waitFor(() => expect(canary.getAttribute('aria-checked')).toBe('true'));
    expect(callsOf(mock, 'update-set-channel')).toEqual([['canary']]);
    expect(screen.getByText(/加入金丝雀计划，第一时间获得新版本/)).toBeTruthy();

    // 点击当前通道不重复请求
    fireEvent.click(canary);
    expect(callsOf(mock, 'update-set-channel')).toHaveLength(1);
  });

  it('检查更新、复制诊断信息、打开目录、更新日志', async () => {
    const { mock } = mockIpc({
      info: makeInfo({
        runtime: { ...makeInfo().runtime, platform: 'win32' },
        rollout: { bucket: 3, percentage: 10, eligible: false, canaryEnrolled: false },
      }),
    });
    const onOpenChangelog = vi.fn();
    render(<AboutSection active onOpenChangelog={onOpenChangelog} />);
    await screen.findByTestId('about-device-id');

    expect(screen.getByText('分桶 3 · 灰度 10% · 未命中')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    expect(callsOf(mock, 'update-check')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '在资源管理器中打开：日志' }));
    await waitFor(() => expect(callsOf(mock, 'about-open-directory')).toEqual([['/u/logs']]));

    fireEvent.click(screen.getByRole('button', { name: '复制诊断信息' }));
    await screen.findByText('已复制诊断信息');
    expect(callsOf(mock, 'about-copy-text')[0][0]).toContain('操作系统: Windows 24.6.0 (arm64)');

    fireEvent.click(screen.getByRole('button', { name: '更新日志' }));
    expect(onOpenChangelog).toHaveBeenCalledOnce();
  });

  it('「已复制」提示在一段时间后复原', async () => {
    mockIpc();
    render(<AboutSection active />);
    await screen.findByTestId('about-device-id');
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '复制设备 ID' }));
    });
    expect(screen.getByText('已复制')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText('已复制')).toBeNull();
  });
});

describe('getRevealLabel', () => {
  it('按平台返回文件管理器名称', () => {
    expect(getRevealLabel('darwin')).toBe('在访达中打开');
    expect(getRevealLabel('win32')).toBe('在资源管理器中打开');
    expect(getRevealLabel('linux')).toBe('在文件管理器中打开');
  });
});
