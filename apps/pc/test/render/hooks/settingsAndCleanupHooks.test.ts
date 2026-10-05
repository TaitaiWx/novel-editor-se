// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useAppSettingsActions,
  type UseAppSettingsActionsContext,
} from '@/render/hooks/useAppSettingsActions';
import {
  useGeneratedMaterialCleanup,
  type UseGeneratedMaterialCleanupContext,
} from '@/render/hooks/useGeneratedMaterialCleanup';
import {
  DEFAULT_SETTINGS_DRAFT,
  SETTINGS_STORAGE_KEY,
  type SettingsDraft,
} from '@/render/utils/appSettings';
import { installElectronMock, uninstallElectronMock } from './electronMock';

afterEach(() => {
  uninstallElectronMock();
  vi.useRealTimers();
});

describe('useAppSettingsActions', () => {
  function createCtx() {
    const appSettingsRef = { current: DEFAULT_SETTINGS_DRAFT };
    const setAppSettings = vi.fn();
    const toast = { warning: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn() };
    const ctx = {
      appSettingsRef,
      setAppSettings,
      toast,
    } as unknown as UseAppSettingsActionsContext;
    return { ctx, appSettingsRef, setAppSettings, toast };
  }

  it('没有 electron 时 load 返回默认设置，persist 为空操作', async () => {
    const c = createCtx();
    const { result } = renderHook(() => useAppSettingsActions(c.ctx));
    await expect(result.current.loadPersistedSettingsDraft()).resolves.toBe(DEFAULT_SETTINGS_DRAFT);
    await expect(result.current.persistSettingsDraft(DEFAULT_SETTINGS_DRAFT)).resolves.toBe(
      undefined
    );
  });

  it('handleAppSettingsChange 同步 ref 与 state', () => {
    const c = createCtx();
    const { result } = renderHook(() => useAppSettingsActions(c.ctx));
    const next = { ...DEFAULT_SETTINGS_DRAFT } as SettingsDraft;
    act(() => result.current.handleAppSettingsChange(next));
    expect(c.appSettingsRef.current).toBe(next);
    expect(c.setAppSettings).toHaveBeenCalledWith(next);
  });

  it('handleToggleThousandCharMarkers 翻转开关并持久化', () => {
    const mock = installElectronMock();
    const c = createCtx();
    const before = c.appSettingsRef.current.general.showThousandCharMarkers;
    const { result } = renderHook(() => useAppSettingsActions(c.ctx));
    act(() => result.current.handleToggleThousandCharMarkers());
    expect(c.appSettingsRef.current.general.showThousandCharMarkers).toBe(!before);
    expect(c.setAppSettings).toHaveBeenCalledWith(c.appSettingsRef.current);
    expect(mock.invoke).toHaveBeenCalledWith(
      'db-settings-set',
      SETTINGS_STORAGE_KEY,
      JSON.stringify(c.appSettingsRef.current)
    );
  });

  it('ensurePersistedAiReady：未启用 AI 时提示并返回 null', async () => {
    installElectronMock(() => null);
    const c = createCtx();
    const { result } = renderHook(() => useAppSettingsActions(c.ctx));
    await expect(result.current.ensurePersistedAiReady()).resolves.toBeNull();
    expect(c.toast.warning).toHaveBeenCalledWith('请先在设置中心启用 AI');
  });

  it('ensurePersistedAiReady：配置完整时返回持久化的设置', async () => {
    installElectronMock(() =>
      JSON.stringify({
        ai: {
          enabled: true,
          enabledExplicitlySet: true,
          apiKey: 'sk-test',
          baseUrl: 'https://x',
          model: 'm',
        },
      })
    );
    const c = createCtx();
    const { result } = renderHook(() => useAppSettingsActions(c.ctx));
    const settings = await result.current.ensurePersistedAiReady();
    expect(settings?.ai.apiKey).toBe('sk-test');
    expect(c.toast.warning).not.toHaveBeenCalled();
  });
});

describe('useGeneratedMaterialCleanup', () => {
  type IdleWindow = Omit<Window, 'requestIdleCallback' | 'cancelIdleCallback'> & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  const w = window as unknown as IdleWindow;
  let ric: IdleWindow['requestIdleCallback'];
  let cic: IdleWindow['cancelIdleCallback'];

  beforeEach(() => {
    ric = w.requestIdleCallback;
    cic = w.cancelIdleCallback;
    w.requestIdleCallback = undefined;
    vi.useFakeTimers();
  });
  afterEach(() => {
    w.requestIdleCallback = ric;
    w.cancelIdleCallback = cic;
  });

  function createCtx(folderPath: string | null, cleaned = new Set<string>()) {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const toast = { info: vi.fn() };
    const ctx = {
      cleanedGeneratedMaterialFoldersRef: { current: cleaned },
      folderPath,
      refreshCurrentFolderRef: { current: refresh },
      toast,
    } as unknown as UseGeneratedMaterialCleanupContext;
    return { ctx, refresh, toast, cleaned };
  }

  it('延迟后清理空目录，有删除时刷新并提示', async () => {
    const mock = installElectronMock(() => ({ success: true, removed: ['a', 'b'] }));
    const c = createCtx('/book');
    renderHook(() => useGeneratedMaterialCleanup(c.ctx));
    expect(mock.invoke).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(mock.invoke).toHaveBeenCalledWith(
      'cleanup-empty-generated-material-directories',
      '/book'
    );
    expect(c.refresh).toHaveBeenCalled();
    expect(c.toast.info).toHaveBeenCalledWith('已安全清理 2 个历史空资料目录');
    expect(c.cleaned.has('/book')).toBe(true);
  });

  it('没有删除任何目录或失败时不提示', async () => {
    installElectronMock(() => ({ success: true, removed: [] }));
    const a = createCtx('/a');
    renderHook(() => useGeneratedMaterialCleanup(a.ctx));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(a.toast.info).not.toHaveBeenCalled();

    installElectronMock(() => {
      throw new Error('x');
    });
    const b = createCtx('/b');
    renderHook(() => useGeneratedMaterialCleanup(b.ctx));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(b.toast.info).not.toHaveBeenCalled();
  });

  it('同一项目只清理一次；无项目时跳过', async () => {
    const mock = installElectronMock(() => ({ success: true }));
    const c = createCtx('/book', new Set(['/book']));
    renderHook(() => useGeneratedMaterialCleanup(c.ctx));
    const n = createCtx(null);
    renderHook(() => useGeneratedMaterialCleanup(n.ctx));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it('卸载时取消计划中的清理', async () => {
    const mock = installElectronMock(() => ({ success: true, removed: ['a'] }));
    const c = createCtx('/book');
    const { unmount } = renderHook(() => useGeneratedMaterialCleanup(c.ctx));
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it('支持 requestIdleCallback 调度', async () => {
    let cb: (() => void) | null = null;
    w.requestIdleCallback = vi.fn((fn: () => void) => {
      cb = fn;
      return 3;
    });
    w.cancelIdleCallback = vi.fn();
    const mock = installElectronMock(() => ({ success: false }));
    const c = createCtx('/book');
    const { unmount } = renderHook(() => useGeneratedMaterialCleanup(c.ctx));
    await act(async () => {
      (cb as unknown as () => void)();
    });
    expect(mock.invoke).toHaveBeenCalled();
    expect(c.refresh).not.toHaveBeenCalled();
    unmount();
    expect(w.cancelIdleCallback).toHaveBeenCalledWith(3);
  });
});
