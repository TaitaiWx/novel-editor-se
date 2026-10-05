// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useDebounce } from '@/render/components/RightPanel/useDebounce';
import {
  formatTimestamp,
  useAiHistory,
  type HistoryRecord,
} from '@/render/components/RightPanel/useAiHistory';
import { useLoreEntries } from '@/render/components/RightPanel/useLoreEntries';
import { installElectronMock, uninstallElectronMock } from './electronMock';

afterEach(() => {
  uninstallElectronMock();
  vi.useRealTimers();
});

describe('useDebounce', () => {
  it('延迟后才更新值，期间多次变化只取最后一次', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v, d }) => useDebounce(v, d), {
      initialProps: { v: 'a', d: 200 },
    });
    expect(result.current).toBe('a');
    rerender({ v: 'b', d: 200 });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    rerender({ v: 'c', d: 200 });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current).toBe('a');
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(result.current).toBe('c');
  });

  it('卸载时清除定时器', () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    const { rerender, unmount } = renderHook(({ v }) => useDebounce(v, 100), {
      initialProps: { v: 1 },
    });
    rerender({ v: 2 });
    unmount();
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });
});

const rec = (id: string, ts = 0): HistoryRecord => ({
  id,
  workflow: 'wf',
  prompt: 'p',
  result: 'r',
  timestamp: ts,
});

describe('formatTimestamp', () => {
  it('格式化为 M/D HH:mm', () => {
    const ts = new Date(2024, 0, 5, 3, 7).getTime();
    expect(formatTimestamp(ts)).toBe('1/5 03:07');
  });
});

describe('useAiHistory', () => {
  it('没有项目时历史为空且不访问存储', async () => {
    const mock = installElectronMock();
    const { result } = renderHook(() => useAiHistory(null));
    await act(async () => {});
    expect(result.current.history).toEqual([]);
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it('从存储加载历史', async () => {
    const mock = installElectronMock((channel) =>
      channel === 'db-settings-get' ? JSON.stringify([rec('1')]) : null
    );
    const { result } = renderHook(() => useAiHistory('/book'));
    await waitFor(() => expect(result.current.history).toEqual([rec('1')]));
    expect(mock.invoke).toHaveBeenCalledWith('db-settings-get', 'novel-editor:ai-history:/book');
  });

  it('存储为空或 JSON 损坏时历史为空', async () => {
    installElectronMock(() => 'not-json');
    const { result } = renderHook(() => useAiHistory('/book'));
    await act(async () => {});
    expect(result.current.history).toEqual([]);
  });

  it('addRecord 插到最前、设为活动记录并持久化', async () => {
    const mock = installElectronMock((channel) =>
      channel === 'db-settings-get' ? JSON.stringify([rec('1')]) : undefined
    );
    const { result } = renderHook(() => useAiHistory('/book'));
    await waitFor(() => expect(result.current.history).toHaveLength(1));
    act(() => result.current.addRecord(rec('2')));
    expect(result.current.history.map((r) => r.id)).toEqual(['2', '1']);
    expect(result.current.activeHistoryId).toBe('2');
    expect(mock.invoke).toHaveBeenCalledWith(
      'db-settings-set',
      'novel-editor:ai-history:/book',
      JSON.stringify([rec('2'), rec('1')])
    );
  });

  it('持久化时只保留最近 50 条', async () => {
    const many = Array.from({ length: 50 }, (_, i) => rec(String(i)));
    const mock = installElectronMock((channel) =>
      channel === 'db-settings-get' ? JSON.stringify(many) : undefined
    );
    const { result } = renderHook(() => useAiHistory('/book'));
    await waitFor(() => expect(result.current.history).toHaveLength(50));
    act(() => result.current.addRecord(rec('new')));
    const setCall = mock.invoke.mock.calls.find(([c]) => c === 'db-settings-set');
    const saved = JSON.parse(setCall?.[2] as string) as HistoryRecord[];
    expect(saved).toHaveLength(50);
    expect(saved[0].id).toBe('new');
  });

  it('deleteRecord 删除记录，删除活动记录时清空活动 id', async () => {
    installElectronMock((channel) =>
      channel === 'db-settings-get' ? JSON.stringify([rec('1'), rec('2')]) : undefined
    );
    const { result } = renderHook(() => useAiHistory('/book'));
    await waitFor(() => expect(result.current.history).toHaveLength(2));
    act(() => result.current.setActiveHistoryId('1'));
    act(() => result.current.deleteRecord('2'));
    expect(result.current.activeHistoryId).toBe('1');
    act(() => result.current.deleteRecord('1'));
    expect(result.current.history).toEqual([]);
    expect(result.current.activeHistoryId).toBeNull();
  });

  it('toggleHistory 切换历史抽屉显示', () => {
    installElectronMock();
    const { result } = renderHook(() => useAiHistory(null));
    act(() => result.current.toggleHistory());
    expect(result.current.showHistory).toBe(true);
    act(() => result.current.toggleHistory());
    expect(result.current.showHistory).toBe(false);
  });

  // 回归：useAiHistory.ts 加载 effect 曾没有取消标记。快速切换项目时，
  // 旧项目较慢返回的历史会覆盖新项目的历史（随后 addRecord 还会把旧项目记录写入新项目的 key）。
  it('切换项目时，旧项目迟到的加载结果不应覆盖新项目历史', async () => {
    const resolvers = new Map<string, (v: string) => void>();
    installElectronMock(
      (_channel, key) =>
        new Promise<string>((r) => {
          resolvers.set(String(key), r);
        })
    );
    const { result, rerender } = renderHook(({ folder }) => useAiHistory(folder), {
      initialProps: { folder: '/a' },
    });
    rerender({ folder: '/b' });
    await act(async () => {
      resolvers.get('novel-editor:ai-history:/b')?.(JSON.stringify([rec('b')]));
    });
    await act(async () => {
      resolvers.get('novel-editor:ai-history:/a')?.(JSON.stringify([rec('a')]));
    });
    expect(result.current.history.map((r) => r.id)).toEqual(['b']);
  });
});

describe('useLoreEntries', () => {
  interface Row {
    id: number;
    category: string;
    title: string;
    content: string;
    tags: string;
    created_at: string;
    updated_at: string;
  }
  const row = (id: number, title: string, category = 'world'): Row => ({
    id,
    category,
    title,
    content: `c${id}`,
    tags: '[]',
    created_at: '',
    updated_at: '',
  });

  function setup(initialRows: Row[] = [], legacy: string | null = null) {
    let rows = [...initialRows];
    const mock = installElectronMock((channel, ...args) => {
      switch (channel) {
        case 'db-world-setting-list-by-folder':
          return rows;
        case 'db-settings-get':
          return legacy;
        case 'db-world-setting-bulk-create-by-folder': {
          const items = args[1] as Array<{ category: string; title: string; content: string }>;
          rows = [
            ...rows,
            ...items.map((it, i) => ({ ...row(100 + rows.length + i, it.title, it.category) })),
          ];
          return undefined;
        }
        case 'db-world-setting-create-by-folder':
          rows = [...rows, row(200 + rows.length, args[2] as string, args[1] as string)];
          return undefined;
        case 'db-world-setting-delete':
          rows = rows.filter((r) => r.id !== args[0]);
          return undefined;
        default:
          return undefined;
      }
    });
    return { mock };
  }

  it('没有项目时条目为空', async () => {
    const { mock } = setup();
    const { result } = renderHook(() => useLoreEntries(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toEqual([]);
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it('加载项目的设定条目', async () => {
    setup([row(1, '世界')]);
    const { result } = renderHook(() => useLoreEntries('/book'));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(result.current.entries[0]).toMatchObject({ id: 1, title: '世界', summary: 'c1' });
    expect(result.current.loading).toBe(false);
  });

  it('没有条目时迁移旧版 localStorage 设定并重新加载', async () => {
    const legacy = JSON.stringify([
      { category: 'faction', title: ' 宗门 ', summary: ' s ' },
      { title: '   ' },
      { title: '无分类' },
    ]);
    const { mock } = setup([], legacy);
    const { result } = renderHook(() => useLoreEntries('/book'));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(mock.invoke).toHaveBeenCalledWith('db-world-setting-bulk-create-by-folder', '/book', [
      { category: 'faction', title: '宗门', content: 's', tags: '[]' },
      { category: 'world', title: '无分类', content: '', tags: '[]' },
    ]);
  });

  it('旧版数据损坏或为空时不迁移', async () => {
    const { mock } = setup([], '{bad');
    const { result } = renderHook(() => useLoreEntries('/book'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {});
    expect(mock.invoke).not.toHaveBeenCalledWith(
      'db-world-setting-bulk-create-by-folder',
      expect.anything(),
      expect.anything()
    );
  });

  it('createEntry 创建后重新加载', async () => {
    const { mock } = setup([row(1, 'A')]);
    const { result } = renderHook(() => useLoreEntries('/book'));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    await act(async () => {
      await result.current.createEntry({
        category: 'term',
        title: 'B',
        summary: 'sb',
        tags: ['x'],
      });
    });
    expect(mock.invoke).toHaveBeenCalledWith(
      'db-world-setting-create-by-folder',
      '/book',
      'term',
      'B',
      'sb',
      '["x"]'
    );
    expect(result.current.entries.map((e) => e.title)).toEqual(['A', 'B']);
  });

  it('updateEntry 映射字段名后调用更新', async () => {
    const { mock } = setup([row(1, 'A')]);
    const { result } = renderHook(() => useLoreEntries('/book'));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    await act(async () => {
      await result.current.updateEntry(1, { summary: 'new', tags: ['t'] });
    });
    expect(mock.invoke).toHaveBeenCalledWith('db-world-setting-update', 1, {
      category: undefined,
      title: undefined,
      content: 'new',
      tags: '["t"]',
    });
    await act(async () => {
      await result.current.updateEntry(1, { title: 'T' });
    });
    expect(mock.invoke).toHaveBeenLastCalledWith('db-world-setting-list-by-folder', '/book');
  });

  it('deleteEntry 删除后重新加载', async () => {
    setup([row(1, 'A'), row(2, 'B')]);
    const { result } = renderHook(() => useLoreEntries('/book'));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    await act(async () => {
      await result.current.deleteEntry(1);
    });
    expect(result.current.entries.map((e) => e.id)).toEqual([2]);
  });

  it('importEntries 按分类+标题去重（含批内去重）', async () => {
    const { mock } = setup([row(1, 'Alpha', 'world')]);
    const { result } = renderHook(() => useLoreEntries('/book'));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    let outcome: { imported: number; skipped: number } | undefined;
    await act(async () => {
      outcome = await result.current.importEntries([
        { category: 'world', title: ' alpha ', summary: '' },
        { category: 'faction', title: 'Alpha', summary: '' },
        { category: 'term', title: 'Beta', summary: 'b' },
        { category: 'term', title: 'beta', summary: 'dup' },
      ]);
    });
    expect(outcome).toEqual({ imported: 2, skipped: 2 });
    const call = mock.invoke.mock.calls.find(
      ([c]) => c === 'db-world-setting-bulk-create-by-folder'
    );
    expect((call?.[2] as Array<{ title: string }>).map((i) => i.title)).toEqual(['Alpha', 'Beta']);
  });

  it('importEntries 全部重复时不写入；空数组或无项目时直接返回', async () => {
    const { mock } = setup([row(1, 'A')]);
    const { result } = renderHook(() => useLoreEntries('/book'));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    let outcome: { imported: number; skipped: number } | undefined;
    await act(async () => {
      outcome = await result.current.importEntries([
        { category: 'world', title: 'a', summary: '' },
      ]);
    });
    expect(outcome).toEqual({ imported: 0, skipped: 1 });
    await act(async () => {
      outcome = await result.current.importEntries([]);
    });
    expect(outcome).toEqual({ imported: 0, skipped: 0 });
    expect(mock.invoke).not.toHaveBeenCalledWith(
      'db-world-setting-bulk-create-by-folder',
      expect.anything(),
      expect.anything()
    );

    const noFolder = renderHook(() => useLoreEntries(null));
    await act(async () => {
      outcome = await noFolder.result.current.importEntries([
        { category: 'world', title: 'z', summary: '' },
      ]);
    });
    expect(outcome).toEqual({ imported: 0, skipped: 1 });
  });

  it('reload 时数据库报错：记录日志、保留已有条目、不产生未处理的拒绝', async () => {
    let fail = false;
    installElectronMock((channel) => {
      if (channel === 'db-world-setting-list-by-folder') {
        if (fail) throw new Error('db locked');
        return [row(1, 'A')];
      }
      return undefined;
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useLoreEntries('/book'));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    fail = true;
    await act(async () => {
      await expect(result.current.reload()).resolves.toBeUndefined();
    });
    expect(result.current.entries.map((e) => e.title)).toEqual(['A']);
    expect(result.current.loading).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith('[lore] 加载设定条目失败:', expect.any(Error));
    errorSpy.mockRestore();
  });

  it('没有 electron 时增删改为空操作', async () => {
    uninstallElectronMock();
    const { result } = renderHook(() => useLoreEntries('/book'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.createEntry({ category: 'world', title: 'x', summary: '' });
      await result.current.updateEntry(1, {});
      await result.current.deleteEntry(1);
    });
    expect(result.current.entries).toEqual([]);
  });
});
