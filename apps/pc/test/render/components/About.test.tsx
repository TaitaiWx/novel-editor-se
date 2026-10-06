// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AboutDialog from '@/render/components/AboutDialog';
import AboutSection from '@/render/components/AppSettingsCenter/AboutSection';
import UpdateGroup from '@/render/components/AppSettingsCenter/UpdateGroup';
import ToastProvider from '@/render/components/Toast';
import type { AboutInfo } from '@/shared/about';
import type { LogUploadResult, LogUploadSettingsState } from '@/shared/log-upload';
import {
  installElectronMock,
  uninstallElectronMock,
  type ElectronMock,
} from '../hooks/electronMock';

const DEVICE_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const MINUTE = 60_000;
const NOW = new Date(2026, 9, 6, 12, 0).getTime();

function makeInfo(overrides: Partial<AboutInfo> = {}): AboutInfo {
  return {
    appName: '小说编辑器',
    productName: 'Novel Editor',
    version: '1.1.0-beta.43',
    releaseChannel: 'beta',
    updateChannel: 'beta',
    rollout: { bucket: 12, percentage: null, eligible: null, canaryEnrolled: false },
    deviceId: DEVICE_ID,
    firstRunAt: new Date(2026, 2, 17, 10, 0).toISOString(),
    startedAt: new Date(NOW - (2 * 60 + 13) * MINUTE).toISOString(),
    ...overrides,
  };
}

interface MockOptions {
  info?: AboutInfo;
  copyResult?: { success: boolean };
  upload?: () => LogUploadResult | Promise<LogUploadResult>;
  settings?: LogUploadSettingsState;
  setSettingsFails?: boolean;
}

function mockIpc(opts: MockOptions = {}): { mock: ElectronMock; state: { info: AboutInfo } } {
  const state = { info: opts.info ?? makeInfo() };
  let settings: LogUploadSettingsState = opts.settings ?? {
    autoUploadOnCrash: true,
    endpointConfigured: false,
  };
  const mock = installElectronMock((channel, ...args) => {
    switch (channel) {
      case 'get-about-info':
        return state.info;
      case 'about-copy-text':
        return opts.copyResult ?? { success: true };
      case 'log-upload-run':
        return opts.upload
          ? opts.upload()
          : {
              status: 'saved',
              fileName: 'novel-editor-logs-20261006-120000-0f8fad5b.zip',
              filePath: '/u/Downloads/novel-editor-logs-20261006-120000-0f8fad5b.zip',
              uploadError: null,
              bytes: 1024,
            };
      case 'log-upload-get-settings':
        return settings;
      case 'log-upload-set-settings':
        if (opts.setSettingsFails) throw new Error('disk full');
        settings = { ...settings, ...(args[0] as Partial<LogUploadSettingsState>) };
        return settings;
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

function renderWithToast(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

afterEach(() => {
  uninstallElectronMock();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AboutDialog（精简小窗口）', () => {
  it('只显示名称、版本与通道、运行时间、完整设备 ID 与上传日志按钮', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
    mockIpc();
    renderWithToast(<AboutDialog visible onClose={vi.fn()} />);
    expect(await screen.findByTestId('about-device-id')).toHaveProperty('textContent', DEVICE_ID);
    expect(screen.getByText('小说编辑器')).toBeTruthy();
    expect(screen.getByTestId('about-version').textContent).toBe('版本 1.1.0-beta.43');
    expect(screen.getByText('测试版')).toBeTruthy();
    expect(screen.getByTestId('about-runtime').textContent).toBe(
      '首次运行 2026-03-17 · 本次已运行 2 小时 13 分'
    );
    expect(screen.getByTestId('about-device-id').getAttribute('title')).toBe('点击复制');
    expect(screen.getByText('点击复制')).toBeTruthy();
    expect(screen.getByRole('button', { name: '上传日志' })).toBeTruthy();

    // 诊断信息、目录、链接、更新通道都不再展示
    for (const text of ['Electron', '数据目录', 'GitHub', '更新日志', '问题反馈', '复制诊断信息']) {
      expect(screen.queryByText(text)).toBeNull();
    }
    expect(screen.queryByText(/更新通道|灰度分组|金丝雀计划/)).toBeNull();
    expect(screen.queryByRole('button', { name: '复制设备 ID' })).toBeNull();
  });

  it('「本次已运行」每分钟刷新', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
    mockIpc();
    renderWithToast(<AboutDialog visible onClose={vi.fn()} />);
    await screen.findByTestId('about-runtime');
    await act(async () => {
      vi.advanceTimersByTime(MINUTE);
    });
    expect(screen.getByTestId('about-runtime').textContent).toContain('本次已运行 2 小时 14 分');
  });

  it('点击设备 ID 复制并提示「设备 ID 已复制」', async () => {
    const { mock } = mockIpc();
    renderWithToast(<AboutDialog visible onClose={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('about-device-id'));
    await waitFor(() => expect(callsOf(mock, 'about-copy-text')).toEqual([[DEVICE_ID]]));
    await screen.findByText('设备 ID 已复制');
  });

  it('主进程剪贴板失败时退回 navigator.clipboard；两者都失败时提示', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mockIpc({ copyResult: { success: false } });
    renderWithToast(<AboutDialog visible onClose={vi.fn()} />);
    const id = await screen.findByTestId('about-device-id');

    fireEvent.click(id);
    await screen.findByText('设备 ID 已复制');
    expect(writeText).toHaveBeenCalledWith(DEVICE_ID);

    fireEvent.click(id);
    await screen.findByText('复制失败，请手动选择文本复制');
  });

  it('上传日志：未配置地址时提示已打包到下载目录，打包中按钮禁用', async () => {
    let resolve: (value: LogUploadResult) => void = () => undefined;
    const { mock } = mockIpc({
      upload: () =>
        new Promise<LogUploadResult>((r) => {
          resolve = r;
        }),
    });
    renderWithToast(<AboutDialog visible onClose={vi.fn()} />);
    await screen.findByTestId('about-device-id');

    fireEvent.click(screen.getByRole('button', { name: '上传日志' }));
    const busy = (await screen.findByRole('button', {
      name: '正在打包日志…',
    })) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    expect(callsOf(mock, 'log-upload-run')).toHaveLength(1);

    await act(async () => {
      resolve({
        status: 'saved',
        fileName: 'novel-editor-logs-x.zip',
        filePath: '/d/novel-editor-logs-x.zip',
        uploadError: '服务器返回 502',
        bytes: 1,
      });
    });
    expect(screen.getByTestId('about-upload-status').textContent).toContain(
      '日志已打包到 下载/novel-editor-logs-x.zip，可发送给我们'
    );
    expect(screen.getByText('上传失败（服务器返回 502），已改为本地保存')).toBeTruthy();
    expect(screen.getByRole('button', { name: '上传日志' })).toBeTruthy();
  });

  it('上传日志：成功显示编号，失败显示原因', async () => {
    const results: LogUploadResult[] = [
      { status: 'uploaded', ticketId: 'T-42', bytes: 1 },
      { status: 'failed', error: '磁盘已满' },
    ];
    mockIpc({ upload: () => results.shift() as LogUploadResult });
    renderWithToast(<AboutDialog visible onClose={vi.fn()} />);
    await screen.findByTestId('about-device-id');

    fireEvent.click(screen.getByRole('button', { name: '上传日志' }));
    await screen.findByText('日志已上传（编号 T-42）');
    fireEvent.click(screen.getByRole('button', { name: '上传日志' }));
    await screen.findByText('日志打包失败：磁盘已满');
  });

  it('IPC 异常时显示失败', async () => {
    mockIpc({
      upload: () => {
        throw new Error('主进程无响应');
      },
    });
    renderWithToast(<AboutDialog visible onClose={vi.fn()} />);
    await screen.findByTestId('about-device-id');
    fireEvent.click(screen.getByRole('button', { name: '上传日志' }));
    await screen.findByText('日志打包失败：主进程无响应');
  });

  it('关闭按钮、Esc 与遮罩点击', async () => {
    mockIpc();
    const onClose = vi.fn();
    const { container, rerender } = renderWithToast(<AboutDialog visible onClose={onClose} />);
    await screen.findByTestId('about-device-id');

    fireEvent.click(screen.getByRole('button', { name: '关闭关于' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(container.querySelector('[role="dialog"]')?.parentElement as HTMLElement);
    // 点击对话框内部不关闭
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(3);

    rerender(
      <ToastProvider>
        <AboutDialog visible={false} onClose={onClose} />
      </ToastProvider>
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('读取失败时显示错误', async () => {
    installElectronMock((channel) => {
      if (channel === 'get-about-info') throw new Error('主进程未就绪');
      return undefined;
    });
    renderWithToast(<AboutDialog visible onClose={vi.fn()} />);
    await screen.findByText('主进程未就绪');
  });
});

describe('AboutSection', () => {
  it('与关于窗口展示同样的精简内容，不再包含更新通道', async () => {
    mockIpc();
    renderWithToast(<AboutSection active />);
    await screen.findByTestId('about-device-id');
    expect(screen.getByTestId('about-runtime').textContent).toMatch(/^首次运行 2026-03-17 · /);
    expect(screen.getByRole('button', { name: '上传日志' })).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByText('运行环境')).toBeNull();
  });
});

describe('UpdateGroup（通用 → 更新与诊断）', () => {
  it('切换更新通道：加入金丝雀计划后刷新信息', async () => {
    const { mock } = mockIpc();
    renderWithToast(<UpdateGroup />);
    const canary = await screen.findByRole('radio', { name: '金丝雀（canary）' });
    expect(screen.getByRole('radio', { name: '测试版（beta）' }).getAttribute('aria-checked')).toBe(
      'true'
    );
    expect(screen.getByText('分桶 12 · 当前为全量发布')).toBeTruthy();
    fireEvent.click(canary);
    await waitFor(() => expect(canary.getAttribute('aria-checked')).toBe('true'));
    expect(callsOf(mock, 'update-set-channel')).toEqual([['canary']]);
    expect(screen.getByText(/加入金丝雀计划，第一时间获得新版本/)).toBeTruthy();

    // 点击当前通道不重复请求
    fireEvent.click(canary);
    expect(callsOf(mock, 'update-set-channel')).toHaveLength(1);
  });

  it('检查更新与灰度描述', async () => {
    const { mock } = mockIpc({
      info: makeInfo({
        rollout: { bucket: 3, percentage: 10, eligible: false, canaryEnrolled: false },
      }),
    });
    renderWithToast(<UpdateGroup />);
    await screen.findByText('分桶 3 · 灰度 10% · 未命中');
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    expect(callsOf(mock, 'update-check')).toHaveLength(1);
  });

  it('切换通道失败时提示', async () => {
    installElectronMock((channel) => {
      if (channel === 'get-about-info') return makeInfo();
      if (channel === 'update-set-channel') throw new Error('x');
      if (channel === 'log-upload-get-settings')
        return { autoUploadOnCrash: true, endpointConfigured: true };
      return undefined;
    });
    renderWithToast(<UpdateGroup />);
    fireEvent.click(await screen.findByRole('radio', { name: '正式版（stable）' }));
    await screen.findByText('切换更新通道失败');
  });

  it('「崩溃时自动上传日志」默认开启，可关闭并保存到主进程', async () => {
    const { mock } = mockIpc();
    renderWithToast(<UpdateGroup />);
    const toggle = await screen.findByRole('switch', { name: '崩溃时自动上传日志' });
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(/当前未配置上传服务，崩溃日志只保存在本机/)).toBeTruthy();

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
    expect(callsOf(mock, 'log-upload-set-settings')).toEqual([[{ autoUploadOnCrash: false }]]);
  });

  it('保存开关失败时回滚并提示', async () => {
    mockIpc({
      setSettingsFails: true,
      settings: { autoUploadOnCrash: true, endpointConfigured: true },
    });
    renderWithToast(<UpdateGroup />);
    const toggle = await screen.findByRole('switch', { name: '崩溃时自动上传日志' });
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText(/当前未配置上传服务/)).toBeNull();
    fireEvent.click(toggle);
    await screen.findByText('保存失败，请重试');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });
});
