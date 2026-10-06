// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useProjectLoader, type UseProjectLoaderContext } from '@/render/hooks/useProjectLoader';
import {
  DEFAULT_SETTINGS_DRAFT,
  SETTINGS_STORAGE_KEY,
  type SettingsDraft,
} from '@/render/utils/appSettings';
import type { FileNode } from '@/render/types';
import { installElectronMock, uninstallElectronMock, type InvokeHandler } from './electronMock';
import { deferred, makeToast, ref } from './hookCtx';

const FILES: FileNode[] = [{ name: 'a.md', path: '/p/a.md', type: 'file' }];

function setup(options: { handler?: InvokeHandler; noIpc?: boolean; folder?: string | null } = {}) {
  if (options.noIpc) uninstallElectronMock();
  const electron = options.noIpc ? null : installElectronMock(options.handler);
  const toast = makeToast();
  const ctx = {
    appSettingsRef: ref<SettingsDraft>(DEFAULT_SETTINGS_DRAFT),
    folderPathRef: ref<string | null>(options.folder ?? null),
    setUnassignedRecords: vi.fn(),
    openFileInTab: vi.fn(),
    refreshCurrentFolderRef: ref<(() => Promise<void>) | null>(null),
    setActiveTab: vi.fn(),
    setAppSettings: vi.fn(),
    setDbReady: vi.fn(),
    applyFolderTree: vi.fn(),
    setFolderPath: vi.fn(),
    setIsLoading: vi.fn(),
    setOpenTabs: vi.fn(),
    setRightPanelCollapsed: vi.fn(),
    setWorkspaceProjectName: vi.fn(),
    toast,
  };
  const hook = renderHook(() => useProjectLoader(ctx as unknown as UseProjectLoaderContext));
  return { ...hook, ctx, toast, electron };
}

async function flushStartup() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  uninstallElectronMock();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useProjectLoader · 启动恢复', () => {
  it('恢复上次工作区：初始化数据库、读取设置、刷新文件树、记录最近目录', async () => {
    const storedSettings = JSON.stringify({ general: { collapseRightPanelOnStartup: true } });
    const { ctx, electron } = setup({
      handler: (channel) => {
        switch (channel) {
          case 'get-last-folder':
            return '/p';
          case 'db-settings-get':
            return storedSettings;
          case 'db-novel-get-by-folder':
            return null;
          case 'refresh-folder':
            return { path: '/p', files: FILES };
          case 'check-just-updated':
            return { updated: true };
          default:
            return undefined;
        }
      },
    });
    expect(electron?.invoke).not.toHaveBeenCalled();
    await flushStartup();

    expect(electron?.invoke).toHaveBeenCalledWith('db-init-default');
    expect(electron?.invoke).toHaveBeenCalledWith('db-settings-get', SETTINGS_STORAGE_KEY);
    expect(ctx.setDbReady).toHaveBeenCalledWith(true);
    expect(ctx.setRightPanelCollapsed).toHaveBeenCalledWith(true);
    expect(ctx.appSettingsRef.current.general.collapseRightPanelOnStartup).toBe(true);
    expect(electron?.invoke).toHaveBeenCalledWith('db-init', '/p/.novel-editor');
    expect(electron?.invoke).toHaveBeenCalledWith('db-novel-create', 'p', '/p', '');
    expect(electron?.invoke).toHaveBeenCalledWith('add-recent-folder', '/p');
    expect(ctx.setFolderPath).toHaveBeenCalledWith('/p');
    expect(ctx.applyFolderTree).toHaveBeenCalledWith(expect.objectContaining({ files: FILES }));
    expect(ctx.setIsLoading).toHaveBeenLastCalledWith(false);
    // 默认设置 openChangelogAfterUpdate 决定是否打开更新日志
    if (DEFAULT_SETTINGS_DRAFT.general.openChangelogAfterUpdate) {
      expect(ctx.openFileInTab).toHaveBeenCalledWith('__changelog__:更新日志');
    }
  });

  it('关闭 openChangelogAfterUpdate 时不打开更新日志，检查失败也不抛出', async () => {
    const off = JSON.stringify({ general: { openChangelogAfterUpdate: false } });
    const a = setup({
      handler: (channel) =>
        channel === 'db-settings-get'
          ? off
          : channel === 'check-just-updated'
            ? { updated: true }
            : undefined,
    });
    await flushStartup();
    expect(a.ctx.openFileInTab).not.toHaveBeenCalled();
    a.unmount();

    const b = setup({
      handler: (channel) => {
        if (channel === 'check-just-updated') throw new Error('offline');
        return undefined;
      },
    });
    await flushStartup();
    expect(b.ctx.openFileInTab).not.toHaveBeenCalled();
  });

  it('无上次工作区时默认打开示例数据', async () => {
    const samplePath = '/docs/Novel Editor/sample-data';
    const { ctx, electron } = setup({
      handler: (channel) => {
        if (channel === 'check-just-updated') return { updated: false };
        if (channel === 'open-sample-data') return samplePath;
        if (channel === 'refresh-folder') return { path: samplePath, files: [] };
        return undefined;
      },
    });
    await flushStartup();
    expect(electron?.invoke).toHaveBeenCalledWith('open-sample-data');
    expect(electron?.invoke).toHaveBeenCalledWith('refresh-folder', samplePath);
    expect(electron?.invoke).toHaveBeenCalledWith('add-recent-folder', samplePath);
    expect(ctx.setFolderPath).toHaveBeenCalledWith(samplePath);
    expect(ctx.setWorkspaceProjectName).toHaveBeenCalledWith(null);
  });

  it('示例作品集刚升级到新版时提示一次旧版备份位置', async () => {
    const { toast } = setup({
      handler: (channel) => {
        if (channel === 'check-just-updated') return { updated: false };
        if (channel === 'sample-data-take-upgrade-notice') {
          return { backupPath: '/docs/Novel Editor/sample-data-旧版-20261007-093005' };
        }
        return undefined;
      },
    });
    await flushStartup();
    expect(toast.info).toHaveBeenCalledWith(
      '示例作品集已更新到新版，旧版已备份到：/docs/Novel Editor/sample-data-旧版-20261007-093005',
      8000
    );
  });

  it('没有升级时不提示', async () => {
    const { toast } = setup({
      handler: (channel) => (channel === 'check-just-updated' ? { updated: false } : undefined),
    });
    await flushStartup();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('示例数据刷新失败时清空工作区状态', async () => {
    const { ctx } = setup({
      handler: (channel) => {
        if (channel === 'check-just-updated') return { updated: false };
        if (channel === 'open-sample-data') return '/docs/sample-data';
        return undefined;
      },
    });
    await flushStartup();
    expect(ctx.setFolderPath).toHaveBeenCalledWith(null);
    expect(ctx.applyFolderTree).toHaveBeenCalledWith(null);
  });

  it('读取设置失败时回退默认设置', async () => {
    const { ctx } = setup({
      handler: (channel) => {
        if (channel === 'db-settings-get') throw new Error('corrupt');
        if (channel === 'check-just-updated') return { updated: false };
        return undefined;
      },
    });
    await flushStartup();
    expect(ctx.setAppSettings).toHaveBeenCalledWith(DEFAULT_SETTINGS_DRAFT);
    expect(ctx.appSettingsRef.current).toBe(DEFAULT_SETTINGS_DRAFT);
    expect(ctx.setRightPanelCollapsed).toHaveBeenCalledWith(
      DEFAULT_SETTINGS_DRAFT.general.collapseRightPanelOnStartup
    );
  });

  it('数据库初始化失败时吞掉错误并结束加载', async () => {
    const { ctx } = setup({
      handler: (channel) => {
        if (channel === 'db-init-default') throw new Error('locked');
        return undefined;
      },
    });
    await flushStartup();
    expect(ctx.setDbReady).not.toHaveBeenCalled();
    expect(ctx.setIsLoading).toHaveBeenLastCalledWith(false);
  });

  it('无 IPC 时跳过启动加载', async () => {
    const { ctx } = setup({ noIpc: true });
    await flushStartup();
    expect(ctx.setDbReady).not.toHaveBeenCalled();
    expect(ctx.setIsLoading).toHaveBeenLastCalledWith(false);
  });

  it('100ms 内卸载则不会触发启动加载', async () => {
    const { electron, unmount } = setup();
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(electron?.invoke).not.toHaveBeenCalled();
  });

  // BUG: useProjectLoader.ts loadDefaultPath 没有任何取消/版本校验。启动恢复的 refresh-folder
  // 尚未返回时用户已手动打开了另一个文件夹，旧的启动结果返回后会把工作区覆盖回上次目录。
  it('启动恢复返回较晚时不应覆盖用户已手动打开的文件夹', async () => {
    const lastRefresh = deferred<{ path: string; files: FileNode[] }>();
    const { result, ctx } = setup({
      handler: (channel, ...args) => {
        if (channel === 'get-last-folder') return '/old';
        if (channel === 'refresh-folder' && args[0] === '/old') return lastRefresh.promise;
        if (channel === 'open-local-folder') return { path: '/new', files: FILES };
        if (channel === 'check-just-updated') return { updated: false };
        return undefined;
      },
    });
    await flushStartup();
    await act(() => result.current.handleOpenLocal());
    expect(ctx.setFolderPath).toHaveBeenLastCalledWith('/new');
    await act(async () => {
      lastRefresh.resolve({ path: '/old', files: [] });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(ctx.setFolderPath).toHaveBeenLastCalledWith('/new');
  });
});

describe('useProjectLoader · 刷新', () => {
  it('刷新当前文件夹并同步 ref', async () => {
    const { result, ctx, electron } = setup({
      folder: '/p',
      handler: (channel) => (channel === 'refresh-folder' ? { path: '/p', files: FILES } : null),
    });
    expect(ctx.refreshCurrentFolderRef.current).toBe(result.current.refreshCurrentFolder);
    await act(() => result.current.refreshCurrentFolder());
    expect(electron?.invoke).toHaveBeenCalledWith('refresh-folder', '/p');
    expect(ctx.applyFolderTree).toHaveBeenCalledWith(expect.objectContaining({ files: FILES }));
  });

  it('没有工作区直接返回；IPC 不可用 / 失败时提示；空结果不覆盖', async () => {
    const a = setup();
    await act(() => a.result.current.refreshCurrentFolder());
    expect(a.ctx.setIsLoading).not.toHaveBeenCalledWith(true);
    a.unmount();

    const b = setup({ folder: '/p', noIpc: true });
    await act(() => b.result.current.refreshCurrentFolder());
    expect(b.toast.error).toHaveBeenCalledWith('Electron IPC 不可用');
    b.unmount();

    const c = setup({
      folder: '/p',
      handler: (channel) => {
        if (channel === 'refresh-folder') throw new Error('gone');
        return undefined;
      },
    });
    await act(() => c.result.current.refreshCurrentFolder());
    expect(c.toast.error).toHaveBeenCalledWith('刷新文件夹失败: gone');
    expect(c.ctx.setIsLoading).toHaveBeenLastCalledWith(false);
    c.unmount();

    const d = setup({ folder: '/p', handler: () => null });
    await act(() => d.result.current.refreshCurrentFolder());
    expect(d.ctx.applyFolderTree).not.toHaveBeenCalled();
  });
});

describe('useProjectLoader · 打开文件夹', () => {
  it('打开本地文件夹并重置标签', async () => {
    const { result, ctx, electron } = setup({
      handler: (channel) =>
        channel === 'open-local-folder'
          ? { path: '/n', files: FILES }
          : channel === 'db-novel-get-by-folder'
            ? { id: 1 }
            : undefined,
    });
    await act(() => result.current.handleOpenLocal());
    expect(electron?.invoke).toHaveBeenCalledWith('db-init', '/n/.novel-editor');
    expect(electron?.invoke).not.toHaveBeenCalledWith(
      'db-novel-create',
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    expect(electron?.invoke).toHaveBeenCalledWith('add-recent-folder', '/n');
    expect(ctx.setFolderPath).toHaveBeenCalledWith('/n');
    expect(ctx.setOpenTabs).toHaveBeenCalledWith([]);
    expect(ctx.setActiveTab).toHaveBeenCalledWith(null);
  });

  it('用户取消选择时不改状态；失败提示；无 IPC 提示', async () => {
    const a = setup({ handler: () => null });
    await act(() => a.result.current.handleOpenLocal());
    expect(a.ctx.setFolderPath).not.toHaveBeenCalled();
    a.unmount();

    const b = setup({
      handler: (channel) => {
        if (channel === 'open-local-folder') throw new Error('denied');
        return undefined;
      },
    });
    await act(() => b.result.current.handleOpenLocal());
    expect(b.toast.error).toHaveBeenCalledWith('打开文件夹失败: denied');
    b.unmount();

    const c = setup({ noIpc: true });
    await act(() => c.result.current.handleOpenLocal());
    expect(c.toast.error).toHaveBeenCalledWith('Electron IPC 不可用');
  });

  it('打开示例数据', async () => {
    const { result, ctx, electron } = setup({
      handler: (channel) =>
        channel === 'open-sample-data'
          ? '/sample'
          : channel === 'refresh-folder'
            ? { path: '/sample', files: FILES }
            : undefined,
    });
    await act(() => result.current.handleOpenSampleData());
    expect(electron?.invoke).toHaveBeenCalledWith('add-recent-folder', '/sample');
    expect(ctx.setFolderPath).toHaveBeenCalledWith('/sample');
    expect(ctx.applyFolderTree).toHaveBeenCalledWith(expect.objectContaining({ files: FILES }));
  });

  it('示例数据失败时只记录日志；无 IPC 时直接返回', async () => {
    const a = setup({
      handler: (channel) => {
        if (channel === 'open-sample-data') throw new Error('missing');
        return undefined;
      },
    });
    await act(() => a.result.current.handleOpenSampleData());
    expect(a.ctx.setFolderPath).not.toHaveBeenCalled();
    expect(a.ctx.setIsLoading).toHaveBeenLastCalledWith(false);
    a.unmount();

    const b = setup({ noIpc: true });
    await act(() => b.result.current.handleOpenSampleData());
    expect(b.ctx.setIsLoading).toHaveBeenLastCalledWith(false);
  });

  it('响应主进程的 open-folder-request 事件，卸载后取消订阅', async () => {
    const { ctx, electron, unmount } = setup({
      handler: (channel, ...args) =>
        channel === 'refresh-folder' ? { path: String(args[0]), files: FILES } : undefined,
    });
    expect(electron?.on).toHaveBeenCalledWith('open-folder-request', expect.any(Function));
    await act(async () => {
      electron?.emit('open-folder-request', '/cli');
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(ctx.setFolderPath).toHaveBeenCalledWith('/cli');
    expect(ctx.setOpenTabs).toHaveBeenCalledWith([]);

    unmount();
    ctx.setFolderPath.mockClear();
    electron?.emit('open-folder-request', '/again');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(ctx.setFolderPath).not.toHaveBeenCalled();
  });

  it('open-folder-request 处理失败时提示', async () => {
    const { toast, electron } = setup({
      handler: (channel) => {
        if (channel === 'db-init') throw new Error('bad path');
        return undefined;
      },
    });
    await act(async () => {
      electron?.emit('open-folder-request', '/bad');
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(toast.error).toHaveBeenCalledWith('打开文件夹失败: bad path');
  });
});
