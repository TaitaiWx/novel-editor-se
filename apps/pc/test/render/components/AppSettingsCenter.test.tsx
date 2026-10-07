// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AppSettingsCenter, { type SettingsTab } from '@/render/components/AppSettingsCenter';
import ToastProvider from '@/render/components/Toast';
import {
  DEFAULT_SETTINGS_DRAFT,
  SETTINGS_STORAGE_KEY,
  type SettingsDraft,
} from '@/render/utils/appSettings';
import {
  installElectronMock,
  uninstallElectronMock,
  type ElectronMock,
} from '../hooks/electronMock';

interface Options {
  stored?: SettingsDraft | null;
  getError?: boolean;
  setError?: boolean;
  clearError?: boolean;
  profile?: unknown;
}

function mockIpc(opts: Options = {}): ElectronMock {
  return installElectronMock((channel) => {
    switch (channel) {
      case 'db-settings-get':
        if (opts.getError) throw new Error('get fail');
        return opts.stored ? JSON.stringify(opts.stored) : null;
      case 'db-settings-set':
        if (opts.setError) throw new Error('set fail');
        return true;
      case 'get-system-profile':
        return opts.profile ?? null;
      case 'app-cache-clear':
        if (opts.clearError) throw new Error('磁盘被锁定');
        return { removedSettingRows: 1 };
      case 'ai-providers-set':
        return { ok: true, data: {} };
      default:
        return undefined;
    }
  });
}

function renderCenter(props: Partial<React.ComponentProps<typeof AppSettingsCenter>> = {}) {
  const onClose = vi.fn();
  const onSettingsChange = vi.fn();
  const onOpenShortcuts = vi.fn();
  const all: React.ComponentProps<typeof AppSettingsCenter> = {
    visible: true,
    onClose,
    onSettingsChange,
    onOpenShortcuts,
    ...props,
  };
  const utils = render(
    <ToastProvider>
      <AppSettingsCenter {...all} />
    </ToastProvider>
  );
  const rerenderWith = (next: Partial<React.ComponentProps<typeof AppSettingsCenter>>) =>
    utils.rerender(
      <ToastProvider>
        <AppSettingsCenter {...all} {...next} />
      </ToastProvider>
    );
  return { ...utils, onClose, onSettingsChange, onOpenShortcuts, rerenderWith };
}

/** 设置行中的开关按钮（无可访问名称，按行标签定位） */
function switchFor(label: string): HTMLButtonElement {
  const row = screen.getByText(label).closest('[class*="formRow"]') as HTMLElement;
  return row.querySelector('button') as HTMLButtonElement;
}

function inputFor(label: string, selector = 'input'): HTMLInputElement {
  const row = screen.getByText(label).closest('[class*="formRow"]') as HTMLElement;
  return row.querySelector(selector) as HTMLInputElement;
}

function lastSaved(mock: ElectronMock): SettingsDraft {
  const calls = mock.invoke.mock.calls.filter((c) => c[0] === 'db-settings-set');
  return JSON.parse(String(calls.at(-1)?.[2])) as SettingsDraft;
}

afterEach(() => {
  uninstallElectronMock();
  vi.useRealTimers();
});

describe('AppSettingsCenter', () => {
  it('不可见时不渲染', () => {
    mockIpc();
    const { container } = renderCenter({ visible: false });
    expect(container.textContent).toBe('');
  });

  it('加载设置、切换通用开关并持久化', async () => {
    const mock = mockIpc();
    const { onSettingsChange } = renderCenter();
    expect(screen.getByText('设置中心')).toBeTruthy();
    await waitFor(() => expect(onSettingsChange).toHaveBeenCalled());
    expect(mock.invoke).toHaveBeenCalledWith('db-settings-get', SETTINGS_STORAGE_KEY);

    const statusSwitch = switchFor('显示状态栏');
    expect(statusSwitch.className).toContain('enabled');
    fireEvent.click(statusSwitch);
    expect(switchFor('显示状态栏').className).not.toContain('enabled');
    await waitFor(() => expect(lastSaved(mock).general.showStatusBar).toBe(false));

    for (const label of [
      '启动时默认折叠右侧辅助面板',
      '显示千字进度标记',
      '显示文件大小',
      '更新后自动打开更新日志',
    ]) {
      fireEvent.click(switchFor(label));
    }
    fireEvent.change(inputFor('千字进度标记阈值', 'select'), { target: { value: '2000' } });
    await waitFor(() => {
      const saved = lastSaved(mock).general;
      expect(saved.thousandCharMarkerStep).toBe(2000);
      expect(saved.collapseRightPanelOnStartup).toBe(false);
      expect(saved.showThousandCharMarkers).toBe(false);
      expect(saved.showFileSizes).toBe(false);
      expect(saved.openChangelogAfterUpdate).toBe(false);
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ general: expect.objectContaining({ showStatusBar: false }) })
    );
  });

  it('读取已保存设置', async () => {
    mockIpc({
      stored: {
        ...DEFAULT_SETTINGS_DRAFT,
        general: { ...DEFAULT_SETTINGS_DRAFT.general, showStatusBar: false },
      },
    });
    renderCenter();
    await waitFor(() => expect(switchFor('显示状态栏').className).not.toContain('enabled'));
  });

  it('读取失败回退默认设置', async () => {
    const mock = mockIpc({ getError: true });
    renderCenter();
    await waitFor(() =>
      expect(mock.invoke.mock.calls.some((c) => c[0] === 'db-settings-set')).toBe(true)
    );
    expect(switchFor('显示状态栏').className).toContain('enabled');
  });

  it('无 electron 时使用默认设置', () => {
    uninstallElectronMock();
    renderCenter();
    expect(switchFor('显示状态栏').className).toContain('enabled');
  });

  it('显示系统性能信息（低配）', async () => {
    mockIpc({
      profile: {
        isLowSpec: true,
        totalMemoryGB: 4,
        cpuCount: 2,
        cpuSpeedMHz: 1600,
        reasons: ['内存不足', 'CPU 核数少'],
      },
    });
    renderCenter();
    expect(await screen.findByText('低配模式')).toBeTruthy();
    expect(screen.getByText(/低配自动适配中/)).toBeTruthy();
    expect(screen.getByText('2 逻辑核 · 1.6GHz')).toBeTruthy();
    expect(screen.getByText('4 GB')).toBeTruthy();
    expect(screen.getByText('内存不足；CPU 核数少')).toBeTruthy();
  });

  it('显示系统性能信息（标准）', async () => {
    mockIpc({
      profile: { isLowSpec: false, totalMemoryGB: 0, cpuCount: 8, cpuSpeedMHz: 0, reasons: [] },
    });
    renderCenter();
    expect(await screen.findByText('标准')).toBeTruthy();
    expect(screen.getByText('8 逻辑核')).toBeTruthy();
    expect(screen.getByText('未知')).toBeTruthy();
  });

  it('Escape / 遮罩 / 关闭按钮关闭；IME 组字中 Escape 忽略；点击弹窗内部不关闭', () => {
    mockIpc();
    const { onClose, container } = renderCenter();
    fireEvent.keyDown(document, { key: 'Escape', isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('设置中心'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '关闭设置' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(container.querySelector('[class*="overlay"]') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('initialTab 生效，非法值回退为通用；点击侧栏切换', () => {
    mockIpc();
    const { rerenderWith } = renderCenter({ initialTab: 'data' });
    expect(screen.getByText('文档数据')).toBeTruthy();
    rerenderWith({ initialTab: 'bogus' as SettingsTab });
    expect(screen.getByText('通用设置')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '快捷键' }));
    expect(screen.getByText('打开快捷键总览')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'AI' }));
    expect(screen.getByText('AI 设置')).toBeTruthy();
  });

  it('快捷键：编辑、空值保留原值、恢复默认、打开总览', async () => {
    const mock = mockIpc();
    const { onClose, onOpenShortcuts, onSettingsChange } = renderCenter({
      initialTab: 'shortcuts',
    });
    await waitFor(() => expect(onSettingsChange).toHaveBeenCalled());
    const input = inputFor('搜索并打开文件');
    expect(input.value).toBe('Mod+P');
    fireEvent.change(input, { target: { value: 'ctrl+shift+k' } });
    await waitFor(() => expect(lastSaved(mock).shortcuts.quickOpen).not.toBe('Mod+P'));
    const edited = inputFor('搜索并打开文件').value;
    expect(edited).toMatch(/Mod\+Shift\+K/i);

    fireEvent.change(inputFor('搜索并打开文件'), { target: { value: '   ' } });
    expect(inputFor('搜索并打开文件').value).toBe(edited);
    fireEvent.blur(inputFor('搜索并打开文件'), { target: { value: edited } });

    const row = screen.getByText('搜索并打开文件').closest('[class*="formRow"]') as HTMLElement;
    fireEvent.click(row.querySelector('button') as HTMLButtonElement);
    expect(inputFor('搜索并打开文件').value).toBe('Mod+P');

    expect(screen.getByText('切换专注模式（备用键）')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '打开快捷键总览' }));
    expect(onClose).toHaveBeenCalled();
    expect(onOpenShortcuts).toHaveBeenCalled();
  });

  it('数据：清除文档数据（确认/取消）', async () => {
    const mock = mockIpc();
    renderCenter({ initialTab: 'data' });
    fireEvent.click(screen.getByRole('button', { name: '清除文档数据' }));
    expect(screen.getByText(/将清理本地缓存与最近项目记录/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByText(/将清理本地缓存与最近项目记录/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '清除文档数据' }));
    fireEvent.click(screen.getByRole('button', { name: '清除文档数据' }));
    expect(screen.queryByText(/将清理本地缓存与最近项目记录/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '清除文档数据' }));
    fireEvent.click(screen.getByRole('button', { name: '确认清除' }));
    expect(await screen.findByText('已清理本地缓存与最近项目记录')).toBeTruthy();
    expect(mock.invoke).toHaveBeenCalledWith('app-cache-clear', 'document-data');
  });

  it('数据：清除 AI 设置恢复默认', async () => {
    const stored: SettingsDraft = {
      ...DEFAULT_SETTINGS_DRAFT,
      ai: { ...DEFAULT_SETTINGS_DRAFT.ai, apiKey: 'sk-secret' },
    };
    const mock = mockIpc({ stored });
    const { onSettingsChange } = renderCenter({ initialTab: 'data' });
    await waitFor(() => expect(onSettingsChange).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '清除 AI 设置' }));
    expect(screen.getByText(/将恢复 AI 设置到默认值/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '清除 AI 设置' }));
    fireEvent.click(screen.getByRole('button', { name: '清除 AI 设置' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '清除 AI 设置' }));
    fireEvent.click(screen.getByRole('button', { name: '确认清除' }));
    expect(await screen.findByText('AI 设置已恢复默认')).toBeTruthy();
    await waitFor(() => expect(lastSaved(mock).ai.apiKey).toBe(''));
    // 安全存储中的 Key 一并清除
    expect(mock.invoke).toHaveBeenCalledWith('ai-providers-set', 'openai-compatible', {
      clearKey: true,
    });
  });

  it('数据：全部清空', async () => {
    const mock = mockIpc();
    renderCenter({ initialTab: 'data' });
    fireEvent.click(screen.getByRole('button', { name: '全部清空' }));
    fireEvent.click(screen.getByRole('button', { name: '全部清空' }));
    expect(screen.queryByRole('button', { name: '确认全部清空' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '全部清空' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '全部清空' }));
    fireEvent.click(screen.getByRole('button', { name: '确认全部清空' }));
    expect(await screen.findByText('本地缓存与设置已清理')).toBeTruthy();
    expect(mock.invoke).toHaveBeenCalledWith('app-cache-clear', 'document-data');
  });

  it('数据：清除失败提示错误', async () => {
    mockIpc({ clearError: true });
    renderCenter({ initialTab: 'data' });
    fireEvent.click(screen.getByRole('button', { name: '全部清空' }));
    fireEvent.click(screen.getByRole('button', { name: '确认全部清空' }));
    expect(await screen.findByText('清除失败: 磁盘被锁定')).toBeTruthy();
  });

  it('AI：开关、预设、服务类型、地址、模型、密钥、数值', async () => {
    const mock = mockIpc();
    renderCenter({ initialTab: 'ai' });
    await waitFor(() =>
      expect(mock.invoke.mock.calls.some((c) => c[0] === 'db-settings-set')).toBe(true)
    );

    fireEvent.click(switchFor('启用 AI 功能'));
    await waitFor(() => expect(lastSaved(mock).ai.enabled).toBe(true));
    expect(lastSaved(mock).ai.enabledExplicitlySet).toBe(true);

    fireEvent.change(inputFor('服务预设', 'select'), { target: { value: 'deepseek-official' } });
    await waitFor(() => expect(lastSaved(mock).ai.baseUrl).toBe('https://api.deepseek.com/v1'));
    expect(lastSaved(mock).ai.model).toBe('deepseek-chat');
    expect(inputFor('模型名称').disabled).toBe(true);
    expect(screen.queryByRole('option', { name: '手动输入' })).toBeNull();

    fireEvent.change(inputFor('模型名称', 'select'), { target: { value: 'deepseek-reasoner' } });
    await waitFor(() => expect(lastSaved(mock).ai.maxTokens).toBe(65536));
    fireEvent.change(inputFor('模型名称', 'select'), { target: { value: 'deepseek-chat' } });
    await waitFor(() => expect(lastSaved(mock).ai.maxTokens).toBe(8192));

    // 自定义预设：保留原 baseUrl/model
    fireEvent.change(inputFor('服务预设', 'select'), { target: { value: 'custom' } });
    await waitFor(() => expect(lastSaved(mock).ai.preset).toBe('custom'));
    expect(lastSaved(mock).ai.baseUrl).toBe('https://api.deepseek.com/v1');
    expect((inputFor('模型名称', 'select') as unknown as HTMLSelectElement).value).toBe(
      '__custom__'
    );
    fireEvent.change(inputFor('模型名称', 'select'), { target: { value: '__custom__' } });

    fireEvent.change(inputFor('服务类型', 'select'), { target: { value: 'openai' } });
    fireEvent.change(inputFor('接口地址'), { target: { value: 'https://x.test/v1' } });
    fireEvent.change(inputFor('模型名称'), { target: { value: 'my-model' } });
    // Key 只写不读：输入后点「保存 Key」交给主进程加密保存，草稿里只记录 hasApiKey
    fireEvent.change(inputFor('API Key'), { target: { value: 'sk-1' } });
    fireEvent.click(screen.getByRole('button', { name: '保存 Key' }));
    expect(await screen.findByText('Key 已安全保存')).toBeTruthy();
    expect(mock.invoke).toHaveBeenCalledWith('ai-providers-set', 'openai-compatible', {
      apiKey: 'sk-1',
    });
    expect(inputFor('API Key').value).toBe('');
    fireEvent.change(inputFor('温度'), { target: { value: '0.7' } });
    fireEvent.change(inputFor('上下文长度'), { target: { value: '10' } });
    fireEvent.change(inputFor('单次回复长度'), { target: { value: '100' } });
    await waitFor(() => {
      const ai = lastSaved(mock).ai;
      expect(ai.provider).toBe('openai');
      expect(ai.baseUrl).toBe('https://x.test/v1');
      expect(ai.model).toBe('my-model');
      expect(ai.apiKey).toBe('');
      expect(ai.hasApiKey).toBe(true);
      expect(ai.temperature).toBe(0.7);
      expect(ai.contextTokens).toBe(128000);
      expect(ai.maxTokens).toBe(512);
    });
    fireEvent.change(inputFor('温度'), { target: { value: '' } });
    fireEvent.change(inputFor('上下文长度'), { target: { value: '' } });
    fireEvent.change(inputFor('单次回复长度'), { target: { value: '' } });
    await waitFor(() => expect(lastSaved(mock).ai.maxTokens).toBe(8192));
    expect(lastSaved(mock).ai.temperature).toBe(1.3);
  });

  it('AI：保存成功提示后自动消失；保存失败提示', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let fail = false;
    installElectronMock((channel) => {
      if (channel === 'db-settings-set' && fail) throw new Error('x');
      return null;
    });
    renderCenter({ initialTab: 'ai' });
    fireEvent.click(screen.getByRole('button', { name: '保存 AI 配置' }));
    expect(await screen.findByText('AI 配置已保存')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText('AI 配置已保存')).toBeNull();

    fail = true;
    fireEvent.click(screen.getByRole('button', { name: '保存 AI 配置' }));
    expect(await screen.findByText('保存失败，请重试')).toBeTruthy();
  });

  // BUG: AppSettingsCenter/index.tsx 温度输入 `Number(e.target.value) || 1.3`，
  // 输入框允许 min="0"，但 0 是 falsy，会被强制改回 1.3，用户无法把温度设为 0。
  it('AI：温度允许设置为 0', async () => {
    const mock = mockIpc();
    const { onSettingsChange } = renderCenter({ initialTab: 'ai' });
    await waitFor(() => expect(onSettingsChange).toHaveBeenCalled());
    fireEvent.change(inputFor('温度'), { target: { value: '0' } });
    await waitFor(() => expect(lastSaved(mock).ai.temperature).toBe(0));
  });
  // BUG: AppSettingsCenter/index.tsx 的加载 effect 在 db-settings-get 返回后无条件 setSettings(next)，
  // 若用户在加载完成前已修改设置，修改会被存储中的旧值覆盖（静默丢失）。
  it('加载完成前的修改不应被覆盖', async () => {
    let resolveGet: (v: string | null) => void = () => undefined;
    installElectronMock((channel) => {
      if (channel === 'db-settings-get') {
        return new Promise<string | null>((resolve) => {
          resolveGet = resolve;
        });
      }
      return null;
    });
    renderCenter();
    fireEvent.click(switchFor('显示状态栏'));
    expect(switchFor('显示状态栏').className).not.toContain('enabled');
    await act(async () => {
      resolveGet(null);
    });
    expect(switchFor('显示状态栏').className).not.toContain('enabled');
  });
});

describe('AppSettingsCenter「通用」不展示更新与诊断', () => {
  it('没有更新通道、灰度分组与崩溃时自动上传日志开关', async () => {
    const mock = mockIpc();
    const { onSettingsChange } = renderCenter();
    await waitFor(() => expect(onSettingsChange).toHaveBeenCalled());
    expect(screen.queryByText('更新与诊断')).toBeNull();
    expect(screen.queryByText(/更新通道|灰度分组|金丝雀|崩溃时自动上传日志/)).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: '更新通道' })).toBeNull();
    const channels = mock.invoke.mock.calls.map((call) => call[0]);
    expect(channels).not.toContain('log-upload-get-settings');
    expect(channels).not.toContain('get-about-info');
  });
});
