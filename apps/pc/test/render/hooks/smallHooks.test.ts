// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  useOpenSettingsTabListener,
  type UseOpenSettingsTabListenerContext,
} from '@/render/hooks/useOpenSettingsTabListener';
import { useRendererReadyReporting } from '@/render/hooks/useRendererReadyReporting';
import { useStoryOrderSync, type UseStoryOrderSyncContext } from '@/render/hooks/useStoryOrderSync';
import {
  useWorkspaceEntities,
  type UseWorkspaceEntitiesContext,
} from '@/render/hooks/useWorkspaceEntities';
import { installElectronMock, uninstallElectronMock } from './electronMock';

afterEach(() => {
  uninstallElectronMock();
  vi.useRealTimers();
});

describe('useOpenSettingsTabListener', () => {
  it('收到 open-settings-tab 事件时打开设置中心对应标签页', () => {
    const setSettingsCenterTab = vi.fn();
    const setShowSettingsCenter = vi.fn();
    const ctx = {
      setSettingsCenterTab,
      setShowSettingsCenter,
    } as unknown as UseOpenSettingsTabListenerContext;
    const { unmount } = renderHook(() => useOpenSettingsTabListener(ctx));
    window.dispatchEvent(new CustomEvent('open-settings-tab', { detail: 'ai' }));
    expect(setSettingsCenterTab).toHaveBeenCalledWith('ai');
    expect(setShowSettingsCenter).toHaveBeenCalledWith(true);

    unmount();
    window.dispatchEvent(new CustomEvent('open-settings-tab', { detail: 'general' }));
    expect(setSettingsCenterTab).toHaveBeenCalledTimes(1);
  });
});

describe('useRendererReadyReporting', () => {
  type IdleWindow = Omit<Window, 'requestIdleCallback' | 'cancelIdleCallback'> & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  const w = window as unknown as IdleWindow;
  let originalRic: IdleWindow['requestIdleCallback'];
  let originalCic: IdleWindow['cancelIdleCallback'];

  beforeEach(() => {
    originalRic = w.requestIdleCallback;
    originalCic = w.cancelIdleCallback;
  });
  afterEach(() => {
    w.requestIdleCallback = originalRic;
    w.cancelIdleCallback = originalCic;
  });

  it('首屏后上报 ready，并在 idle 回调中上报 health-ready', () => {
    const mock = installElectronMock();
    let idleCb: (() => void) | null = null;
    w.requestIdleCallback = vi.fn((cb: () => void) => {
      idleCb = cb;
      return 7;
    });
    w.cancelIdleCallback = vi.fn();
    const { rerender, unmount } = renderHook(() => useRendererReadyReporting());
    rerender();
    expect(mock.invoke.mock.calls.filter(([c]) => c === 'app-renderer-ready')).toHaveLength(1);
    expect(mock.invoke).not.toHaveBeenCalledWith('app-renderer-health-ready');
    (idleCb as unknown as () => void)();
    expect(mock.invoke).toHaveBeenCalledWith('app-renderer-health-ready');
    unmount();
    expect(w.cancelIdleCallback).toHaveBeenCalledWith(7);
  });

  it('没有 requestIdleCallback 时用双 rAF 兜底', async () => {
    const mock = installElectronMock();
    w.requestIdleCallback = undefined;
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    renderHook(() => useRendererReadyReporting());
    expect(raf).toHaveBeenCalledTimes(2);
    expect(mock.invoke).toHaveBeenCalledWith('app-renderer-health-ready');
    raf.mockRestore();
  });

  it('卸载后 idle 回调不再上报（已取消）', () => {
    const mock = installElectronMock();
    let idleCb: (() => void) | null = null;
    w.requestIdleCallback = vi.fn((cb: () => void) => {
      idleCb = cb;
      return 1;
    });
    w.cancelIdleCallback = vi.fn();
    const { unmount } = renderHook(() => useRendererReadyReporting());
    unmount();
    (idleCb as unknown as () => void)();
    expect(mock.invoke).not.toHaveBeenCalledWith('app-renderer-health-ready');
  });

  it('没有 electron 时不抛错', () => {
    uninstallElectronMock();
    expect(() => renderHook(() => useRendererReadyReporting())).not.toThrow();
  });
});

describe('useStoryOrderSync', () => {
  function createCtx(key: string | null, folder: string | null = '/book') {
    const setStoryOrderMap = vi.fn();
    const storyOrderMapRef = { current: { stale: ['x'] } as Record<string, string[]> };
    const ctx = {
      folderPathRef: { current: folder },
      setStoryOrderMap,
      storyOrderMapRef,
      storyOrderStorageKey: key,
    } as unknown as UseStoryOrderSyncContext;
    return { ctx, setStoryOrderMap, storyOrderMapRef };
  }

  it('从存储加载并解析排序映射', async () => {
    installElectronMock((channel) =>
      channel === 'db-settings-get' ? JSON.stringify({ '/book': ['/book/a', '/book/a', ''] }) : null
    );
    const c = createCtx('story-key');
    renderHook(() => useStoryOrderSync(c.ctx));
    await waitFor(() => expect(c.setStoryOrderMap).toHaveBeenCalledWith({ '/book': ['/book/a'] }));
    expect(c.storyOrderMapRef.current).toEqual({ '/book': ['/book/a'] });
  });

  it('没有存储 key 时重置为空映射', () => {
    installElectronMock();
    const c = createCtx(null);
    renderHook(() => useStoryOrderSync(c.ctx));
    expect(c.setStoryOrderMap).toHaveBeenCalledWith({});
    expect(c.storyOrderMapRef.current).toEqual({});
  });

  it('读取失败时重置为空映射', async () => {
    installElectronMock(() => {
      throw new Error('db down');
    });
    const c = createCtx('story-key');
    renderHook(() => useStoryOrderSync(c.ctx));
    await waitFor(() => expect(c.setStoryOrderMap).toHaveBeenCalledWith({}));
  });

  it('卸载后到达的结果被忽略', async () => {
    let resolve: (v: string) => void = () => {};
    const mock = installElectronMock(
      () =>
        new Promise<string>((r) => {
          resolve = r;
        })
    );
    const c = createCtx('story-key');
    const { unmount } = renderHook(() => useStoryOrderSync(c.ctx));
    expect(mock.invoke).toHaveBeenCalled();
    unmount();
    await act(async () => {
      resolve(JSON.stringify({ a: ['b'] }));
    });
    expect(c.setStoryOrderMap).not.toHaveBeenCalled();
  });

  it('persistStoryOrderMap 基于当前项目路径写入存储', async () => {
    const mock = installElectronMock();
    const c = createCtx('story-key', '/book');
    const { result } = renderHook(() => useStoryOrderSync(c.ctx));
    await act(async () => {
      await result.current.persistStoryOrderMap({ '/book': ['/book/b'] });
    });
    expect(mock.invoke).toHaveBeenCalledWith(
      'db-settings-set',
      'novel-editor:story-order:/book',
      JSON.stringify({ '/book': ['/book/b'] })
    );
  });

  it('persistStoryOrderMap 对虚拟/空项目路径不写入', async () => {
    const mock = installElectronMock();
    const c = createCtx(null, '__virtual__');
    const { result } = renderHook(() => useStoryOrderSync(c.ctx));
    await act(async () => {
      await result.current.persistStoryOrderMap({});
    });
    expect(mock.invoke).not.toHaveBeenCalledWith(
      'db-settings-set',
      expect.anything(),
      expect.anything()
    );
  });
});

describe('useWorkspaceEntities', () => {
  function createCtx(folderPath: string | null) {
    const setWorkspaceCharacters = vi.fn();
    const setWorkspaceLoreEntries = vi.fn();
    const setWorkspaceProjectName = vi.fn();
    const ctx = {
      folderPath,
      setWorkspaceCharacters,
      setWorkspaceLoreEntries,
      setWorkspaceProjectName,
    } as unknown as UseWorkspaceEntitiesContext;
    return { ctx, setWorkspaceCharacters, setWorkspaceLoreEntries, setWorkspaceProjectName };
  }

  it('没有项目时清空所有实体', () => {
    installElectronMock();
    const c = createCtx(null);
    renderHook(() => useWorkspaceEntities(c.ctx));
    expect(c.setWorkspaceCharacters).toHaveBeenCalledWith([]);
    expect(c.setWorkspaceLoreEntries).toHaveBeenCalledWith([]);
    expect(c.setWorkspaceProjectName).toHaveBeenCalledWith(null);
  });

  it('加载作品名、人物和设定', async () => {
    const mock = installElectronMock((channel) => {
      if (channel === 'db-novel-get-by-folder') return { id: 3, name: '长篇' };
      if (channel === 'db-character-list')
        return [{ id: 1, name: '林', role: '主角', description: 'd', attributes: '{}' }];
      if (channel === 'db-world-setting-list-by-folder')
        return [
          {
            id: 9,
            category: 'faction',
            title: '宗门',
            content: 'c',
            tags: '["t"]',
            created_at: '',
            updated_at: '',
          },
        ];
      return null;
    });
    const c = createCtx('/x/book');
    renderHook(() => useWorkspaceEntities(c.ctx));
    await waitFor(() => expect(c.setWorkspaceProjectName).toHaveBeenCalledWith('长篇'));
    expect(mock.invoke).toHaveBeenCalledWith('db-character-list', 3);
    const chars = c.setWorkspaceCharacters.mock.calls[0][0] as Array<{ id: number; name: string }>;
    expect(chars).toHaveLength(1);
    expect(chars[0]).toMatchObject({ id: 1, name: '林', role: '主角' });
    const lore = c.setWorkspaceLoreEntries.mock.calls[0][0] as Array<{ title: string }>;
    expect(lore[0]).toMatchObject({ id: 9, category: 'faction', title: '宗门', tags: ['t'] });
  });

  it('没有作品记录时用目录名作为作品名，且不查询人物', async () => {
    const mock = installElectronMock((channel) =>
      channel === 'db-world-setting-list-by-folder' ? [] : null
    );
    const c = createCtx('/x/my-book');
    renderHook(() => useWorkspaceEntities(c.ctx));
    await waitFor(() => expect(c.setWorkspaceProjectName).toHaveBeenCalledWith('my-book'));
    expect(mock.invoke).not.toHaveBeenCalledWith('db-character-list', expect.anything());
    expect(c.setWorkspaceCharacters).toHaveBeenCalledWith([]);
  });

  it('加载失败时回退为目录名并清空列表', async () => {
    installElectronMock(() => {
      throw new Error('fail');
    });
    const c = createCtx('/x/broken');
    renderHook(() => useWorkspaceEntities(c.ctx));
    await waitFor(() => expect(c.setWorkspaceProjectName).toHaveBeenCalledWith('broken'));
    expect(c.setWorkspaceCharacters).toHaveBeenCalledWith([]);
    expect(c.setWorkspaceLoreEntries).toHaveBeenCalledWith([]);
  });

  it('卸载后到达的结果被忽略', async () => {
    const pending: Array<(v: unknown) => void> = [];
    installElectronMock(
      (channel) =>
        new Promise((r) => {
          pending.push(() => r(channel === 'db-world-setting-list-by-folder' ? [] : null));
        })
    );
    const c = createCtx('/x/book');
    const { unmount } = renderHook(() => useWorkspaceEntities(c.ctx));
    unmount();
    // 逐个释放挂起的请求（包括后续触发的设定列表请求）
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        pending.splice(0).forEach((fn) => fn(undefined));
        await Promise.resolve();
      });
    }
    expect(c.setWorkspaceProjectName).not.toHaveBeenCalled();
    expect(c.setWorkspaceCharacters).not.toHaveBeenCalled();
  });
});
