// @vitest-environment happy-dom
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useEditorSession, type UseEditorSessionContext } from '@/render/hooks/useEditorSession';
import type { FileNode } from '@/render/types/File';
import type { EditorViewportSnapshot } from '@/render/components/TextEditor';
import { createVolumeWorkspaceTab } from '@/render/utils/workspace';
import { installElectronMock, uninstallElectronMock, type ElectronMock } from './electronMock';

const files: FileNode[] = [
  {
    name: 'book',
    path: '/book',
    type: 'directory',
    children: [
      { name: 'a.md', path: '/book/a.md', type: 'file' },
      { name: 'b.md', path: '/book/b.md', type: 'file' },
      { name: 'sub', path: '/book/sub', type: 'directory', children: [] },
    ],
  },
];

const snap = (n: number): EditorViewportSnapshot => ({
  anchor: n,
  head: n,
  scrollTop: n * 10,
  scrollLeft: 0,
});

interface Props {
  sessionKey: string | null;
  files: FileNode[];
  initialTabs?: string[];
  initialActive?: string | null;
}

function useHarness({ sessionKey, files: nodes, initialTabs = [], initialActive = null }: Props) {
  const [openTabs, setOpenTabs] = useState<string[]>(initialTabs);
  const [activeTab, setActiveTab] = useState<string | null>(initialActive);
  const [initialViewportSnapshots, setInitialViewportSnapshots] = useState<
    Record<string, EditorViewportSnapshot>
  >({});
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;
  const filesRef = useRef(nodes);
  filesRef.current = nodes;
  const editorViewportSnapshotsRef = useRef<Record<string, EditorViewportSnapshot>>({});
  const restoredEditorSessionKeyRef = useRef<string | null>(null);
  const editorSessionHydratedRef = useRef(false);
  const persistEditorSessionTimerRef = useRef<number | null>(null);

  const ctx = {
    activeTab,
    activeTabRef,
    editorSessionHydratedRef,
    editorSessionKey: sessionKey,
    editorViewportSnapshotsRef,
    files: nodes,
    filesRef,
    openTabs,
    openTabsRef,
    persistEditorSessionTimerRef,
    restoredEditorSessionKeyRef,
    setActiveTab,
    setInitialViewportSnapshots,
    setOpenTabs,
  } as unknown as UseEditorSessionContext;

  const api = useEditorSession(ctx);
  return {
    api,
    openTabs,
    activeTab,
    initialViewportSnapshots,
    setOpenTabs,
    setActiveTab,
    editorViewportSnapshotsRef,
    editorSessionHydratedRef,
  };
}

function setCalls(mock: ElectronMock) {
  return mock.invoke.mock.calls.filter(([channel]) => channel === 'db-settings-set');
}

function lastPersisted(mock: ElectronMock) {
  const calls = setCalls(mock);
  const last = calls[calls.length - 1];
  return JSON.parse(last[2] as string) as {
    openTabs: string[];
    activeTab: string | null;
    viewportSnapshots: Record<string, EditorViewportSnapshot>;
  };
}

describe('useEditorSession', () => {
  let stored: string | null;
  let mock: ElectronMock;

  beforeEach(() => {
    stored = null;
    mock = installElectronMock((channel) => {
      if (channel === 'db-settings-get') return stored;
      return undefined;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    uninstallElectronMock();
  });

  it('isPersistableTabPath 仅接受文件节点与 changelog 标签', () => {
    const { result } = renderHook(() => useHarness({ sessionKey: null, files }));
    const fn = result.current.api.isPersistableTabPath;
    expect(fn(null, files)).toBe(false);
    expect(fn('__untitled__:Untitled-1', files)).toBe(false);
    expect(fn('__changelog__:CHANGELOG', files)).toBe(true);
    expect(fn('/book/a.md', files)).toBe(true);
    expect(fn('/book/sub', files)).toBe(false);
    expect(fn('/missing.md', files)).toBe(false);
  });

  it('从存储中恢复会话，过滤掉不存在/不可持久化的标签与快照', async () => {
    stored = JSON.stringify({
      openTabs: ['/book/a.md', '/gone.md', '__untitled__:Untitled-1'],
      activeTab: '/book/b.md',
      viewportSnapshots: { '/book/a.md': snap(1), '/gone.md': snap(2) },
    });
    const { result } = renderHook(() => useHarness({ sessionKey: 'k1', files }));
    await waitFor(() => expect(result.current.openTabs).toEqual(['/book/a.md', '/book/b.md']));
    expect(result.current.activeTab).toBe('/book/b.md');
    expect(result.current.initialViewportSnapshots).toEqual({ '/book/a.md': snap(1) });
    expect(mock.invoke).toHaveBeenCalledWith('db-settings-get', 'k1');
    expect(result.current.editorSessionHydratedRef.current).toBe(true);
  });

  it('恢复时丢弃内部数据标签（旧会话里打开过的 分镜.json / 成长档案 JSON）', async () => {
    const withInternal: FileNode[] = [
      {
        name: 'book',
        path: '/book',
        type: 'directory',
        children: [
          { name: 'a.md', path: '/book/a.md', type: 'file' },
          { name: '规则.json', path: '/book/资料/记忆/规则.json', type: 'file' },
          { name: '分镜.json', path: '/book/资料/视频/章/场/分镜.json', type: 'file' },
        ],
      },
    ];
    stored = JSON.stringify({
      openTabs: ['/book/a.md', '/book/资料/记忆/规则.json'],
      activeTab: '/book/资料/视频/章/场/分镜.json',
      viewportSnapshots: { '/book/资料/记忆/规则.json': snap(1) },
    });
    const { result } = renderHook(() => useHarness({ sessionKey: 'k1', files: withInternal }));
    await waitFor(() => expect(result.current.openTabs).toEqual(['/book/a.md']));
    expect(result.current.activeTab).toBe('/book/a.md');
    expect(result.current.initialViewportSnapshots).toEqual({});
  });

  it('恢复时 activeTab 无效则回退到最后一个打开的标签', async () => {
    stored = JSON.stringify({ openTabs: ['/book/a.md', '/book/b.md'], activeTab: '/gone.md' });
    const { result } = renderHook(() => useHarness({ sessionKey: 'k1', files }));
    await waitFor(() => expect(result.current.activeTab).toBe('/book/b.md'));
  });

  it('存储为空时不改变标签，但仍标记为已水合', async () => {
    const { result } = renderHook(() =>
      useHarness({ sessionKey: 'k1', files, initialTabs: ['/book/a.md'] })
    );
    await waitFor(() => expect(result.current.editorSessionHydratedRef.current).toBe(true));
    expect(result.current.openTabs).toEqual(['/book/a.md']);
  });

  it('读取失败时吞掉异常并标记为已水合', async () => {
    mock.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db-settings-get') throw new Error('boom');
      return undefined;
    });
    const { result } = renderHook(() => useHarness({ sessionKey: 'k1', files }));
    await waitFor(() => expect(result.current.editorSessionHydratedRef.current).toBe(true));
  });

  it('没有 session key 时不读取存储，也不持久化', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useHarness({ sessionKey: null, files }));
    act(() => result.current.setOpenTabs(['/book/a.md']));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it('水合后标签变化会在 180ms 防抖后持久化', async () => {
    const { result } = renderHook(() => useHarness({ sessionKey: 'k1', files }));
    await waitFor(() => expect(result.current.editorSessionHydratedRef.current).toBe(true));
    vi.useFakeTimers();
    mock.invoke.mockClear();

    act(() => {
      result.current.setOpenTabs(['/book/a.md', '__untitled__:Untitled-1']);
      result.current.setActiveTab('/book/b.md');
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(setCalls(mock)).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(setCalls(mock)).toHaveLength(1);
    expect(setCalls(mock)[0][1]).toBe('k1');
    expect(lastPersisted(mock)).toEqual({
      openTabs: ['/book/a.md', '/book/b.md'],
      activeTab: '/book/b.md',
      viewportSnapshots: {},
    });
  });

  it('handleViewportSnapshotChange 相同快照不触发持久化，不同快照触发', async () => {
    const { result } = renderHook(() =>
      useHarness({ sessionKey: 'k1', files, initialTabs: ['/book/a.md'] })
    );
    await waitFor(() => expect(result.current.editorSessionHydratedRef.current).toBe(true));
    vi.useFakeTimers();
    mock.invoke.mockClear();

    act(() => result.current.api.handleViewportSnapshotChange('/book/a.md', snap(3)));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(setCalls(mock)).toHaveLength(1);
    expect(lastPersisted(mock).viewportSnapshots).toEqual({ '/book/a.md': snap(3) });

    act(() => result.current.api.handleViewportSnapshotChange('/book/a.md', snap(3)));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(setCalls(mock)).toHaveLength(1);
  });

  it('moveViewportSnapshot 迁移快照；源不存在或路径相同时无操作', async () => {
    const { result } = renderHook(() => useHarness({ sessionKey: 'k1', files }));
    await waitFor(() => expect(result.current.editorSessionHydratedRef.current).toBe(true));
    act(() => {
      result.current.editorViewportSnapshotsRef.current = { '/book/a.md': snap(1) };
    });
    act(() => result.current.api.moveViewportSnapshot('/book/a.md', '/book/a.md'));
    act(() => result.current.api.moveViewportSnapshot('/none', '/book/b.md'));
    expect(result.current.initialViewportSnapshots).toEqual({});

    act(() => result.current.api.moveViewportSnapshot('/book/a.md', '/book/b.md'));
    expect(result.current.initialViewportSnapshots).toEqual({ '/book/b.md': snap(1) });
    expect(result.current.editorViewportSnapshotsRef.current).toEqual({ '/book/b.md': snap(1) });
  });

  it('removeViewportSnapshots 按条件删除快照', async () => {
    const { result } = renderHook(() => useHarness({ sessionKey: 'k1', files }));
    await waitFor(() => expect(result.current.editorSessionHydratedRef.current).toBe(true));
    act(() => {
      result.current.editorViewportSnapshotsRef.current = {
        '/book/a.md': snap(1),
        '/book/b.md': snap(2),
      };
    });
    act(() => result.current.api.removeViewportSnapshots((p) => p === '/nothing'));
    expect(result.current.initialViewportSnapshots).toEqual({});

    act(() => result.current.api.removeViewportSnapshots((p) => p.endsWith('a.md')));
    expect(result.current.initialViewportSnapshots).toEqual({ '/book/b.md': snap(2) });
  });

  it('remapPathReferences 重命名目录时重映射标签、活动标签和快照', async () => {
    const volumeTab = createVolumeWorkspaceTab('/book');
    const { result } = renderHook(() =>
      useHarness({
        sessionKey: 'k1',
        files,
        initialTabs: ['/book/a.md', '/other.md', volumeTab],
        initialActive: '/book/a.md',
      })
    );
    await waitFor(() => expect(result.current.editorSessionHydratedRef.current).toBe(true));
    act(() => {
      result.current.editorViewportSnapshotsRef.current = { '/book/a.md': snap(1) };
    });
    act(() => result.current.api.remapPathReferences('/book', '/novel'));
    expect(result.current.openTabs).toEqual([
      '/novel/a.md',
      '/other.md',
      createVolumeWorkspaceTab('/novel'),
    ]);
    expect(result.current.activeTab).toBe('/novel/a.md');
    expect(result.current.initialViewportSnapshots).toEqual({ '/novel/a.md': snap(1) });
  });

  it('remapPathReferences 新旧路径相同时不做任何事', async () => {
    const { result } = renderHook(() =>
      useHarness({ sessionKey: null, files, initialTabs: ['/book/a.md'] })
    );
    const before = result.current.openTabs;
    act(() => result.current.api.remapPathReferences('/book', '/book'));
    expect(result.current.openTabs).toBe(before);
  });

  it('切换 session key 时重置快照并重新读取', async () => {
    stored = JSON.stringify({ openTabs: ['/book/a.md'], activeTab: '/book/a.md' });
    const { result, rerender } = renderHook((p: Props) => useHarness(p), {
      initialProps: { sessionKey: 'k1', files },
    });
    await waitFor(() => expect(result.current.activeTab).toBe('/book/a.md'));
    stored = JSON.stringify({ openTabs: ['/book/b.md'], activeTab: '/book/b.md' });
    rerender({ sessionKey: 'k2', files });
    await waitFor(() => expect(result.current.activeTab).toBe('/book/b.md'));
    expect(mock.invoke).toHaveBeenCalledWith('db-settings-get', 'k2');
  });

  it('卸载时清除尚未触发的持久化定时器', async () => {
    const { result, unmount } = renderHook(() => useHarness({ sessionKey: 'k1', files }));
    await waitFor(() => expect(result.current.editorSessionHydratedRef.current).toBe(true));
    vi.useFakeTimers();
    mock.invoke.mockClear();
    act(() => result.current.setOpenTabs(['/book/a.md']));
    unmount();
    vi.advanceTimersByTime(500);
    expect(setCalls(mock)).toHaveLength(0);
  });
});
