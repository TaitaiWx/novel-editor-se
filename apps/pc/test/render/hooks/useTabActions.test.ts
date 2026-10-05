// @vitest-environment happy-dom
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTabActions, type UseTabActionsContext } from '@/render/hooks/useTabActions';

interface HarnessOptions {
  openTabs?: string[];
  activeTab?: string | null;
  untitled?: Record<string, string>;
  sidebarCollapsed?: boolean;
  rightPanelCollapsed?: boolean;
}

/** 用真实 useState 模拟 AppState 中与标签页相关的切片 */
function useHarness(options: HarnessOptions = {}) {
  const [openTabs, setOpenTabs] = useState<string[]>(options.openTabs ?? []);
  const [activeTab, setActiveTab] = useState<string | null>(options.activeTab ?? null);
  const [untitledTabContents, setUntitledTabContents] = useState<Record<string, string>>(
    options.untitled ?? {}
  );
  const [focusMode, setFocusMode] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(options.sidebarCollapsed ?? false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(
    options.rightPanelCollapsed ?? false
  );

  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;
  const sidebarCollapsedRef = useRef(sidebarCollapsed);
  sidebarCollapsedRef.current = sidebarCollapsed;
  const rightPanelCollapsedRef = useRef(rightPanelCollapsed);
  rightPanelCollapsedRef.current = rightPanelCollapsed;
  const preFocusStateRef = useRef({ sidebarCollapsed: false, rightPanelCollapsed: false });
  const untitledCounterRef = useRef(0);

  const ctx = {
    activeTabRef,
    openTabsRef,
    preFocusStateRef,
    rightPanelCollapsedRef,
    setActiveTab,
    setFocusMode,
    setOpenTabs,
    setRightPanelCollapsed,
    setSidebarCollapsed,
    setUntitledTabContents,
    sidebarCollapsedRef,
    untitledCounterRef,
  } as unknown as UseTabActionsContext;

  const actions = useTabActions(ctx);
  return {
    actions,
    openTabs,
    activeTab,
    untitledTabContents,
    focusMode,
    sidebarCollapsed,
    rightPanelCollapsed,
  };
}

describe('useTabActions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('openFileInTab 追加新标签并激活，重复打开不重复追加', () => {
    const { result } = renderHook(() => useHarness());
    act(() => result.current.actions.openFileInTab('/a.md'));
    act(() => result.current.actions.openFileInTab('/b.md'));
    act(() => result.current.actions.openFileInTab('/a.md'));
    expect(result.current.openTabs).toEqual(['/a.md', '/b.md']);
    expect(result.current.activeTab).toBe('/a.md');
  });

  it('closeTab 关闭活动标签时激活相邻标签', () => {
    const { result } = renderHook(() =>
      useHarness({ openTabs: ['/a', '/b', '/c'], activeTab: '/b' })
    );
    act(() => result.current.actions.closeTab('/b'));
    expect(result.current.openTabs).toEqual(['/a', '/c']);
    expect(result.current.activeTab).toBe('/c');
  });

  it('closeTab 关闭最后一个活动标签时激活前一个', () => {
    const { result } = renderHook(() => useHarness({ openTabs: ['/a', '/b'], activeTab: '/b' }));
    act(() => result.current.actions.closeTab('/b'));
    expect(result.current.activeTab).toBe('/a');
  });

  it('closeTab 关闭唯一标签后 activeTab 为 null', () => {
    const { result } = renderHook(() => useHarness({ openTabs: ['/a'], activeTab: '/a' }));
    act(() => result.current.actions.closeTab('/a'));
    expect(result.current.openTabs).toEqual([]);
    expect(result.current.activeTab).toBeNull();
  });

  it('closeTab 关闭非活动标签不影响活动标签', () => {
    const { result } = renderHook(() => useHarness({ openTabs: ['/a', '/b'], activeTab: '/a' }));
    act(() => result.current.actions.closeTab('/b'));
    expect(result.current.openTabs).toEqual(['/a']);
    expect(result.current.activeTab).toBe('/a');
  });

  it('closeTab 关闭未命名标签时清理其内容', () => {
    const u = '__untitled__:Untitled-1';
    const { result } = renderHook(() =>
      useHarness({ openTabs: [u, '/a'], activeTab: '/a', untitled: { [u]: 'hello', x: 'y' } })
    );
    act(() => result.current.actions.closeTab(u));
    expect(result.current.untitledTabContents).toEqual({ x: 'y' });
  });

  it('closeTab 关闭不存在内容的未命名标签时保持对象引用', () => {
    const u = '__untitled__:Untitled-9';
    const { result } = renderHook(() => useHarness({ openTabs: [u], untitled: { x: 'y' } }));
    const before = result.current.untitledTabContents;
    act(() => result.current.actions.closeTab(u));
    expect(result.current.untitledTabContents).toBe(before);
  });

  it('handleNewTab 创建递增编号的未命名标签', () => {
    const { result } = renderHook(() => useHarness());
    act(() => result.current.actions.handleNewTab());
    act(() => result.current.actions.handleNewTab());
    expect(result.current.openTabs).toEqual(['__untitled__:Untitled-1', '__untitled__:Untitled-2']);
    expect(result.current.activeTab).toBe('__untitled__:Untitled-2');
    expect(result.current.untitledTabContents).toEqual({
      '__untitled__:Untitled-1': '',
      '__untitled__:Untitled-2': '',
    });
  });

  it('toggleFocusMode 进入时折叠两侧面板，退出时恢复原状态', () => {
    const { result } = renderHook(() =>
      useHarness({ openTabs: ['/a'], activeTab: '/a', rightPanelCollapsed: true })
    );
    act(() => result.current.actions.toggleFocusMode());
    expect(result.current.focusMode).toBe(true);
    expect(result.current.sidebarCollapsed).toBe(true);
    expect(result.current.rightPanelCollapsed).toBe(true);
    expect(result.current.openTabs).toEqual(['/a']);

    act(() => result.current.actions.toggleFocusMode());
    expect(result.current.focusMode).toBe(false);
    expect(result.current.sidebarCollapsed).toBe(false);
    expect(result.current.rightPanelCollapsed).toBe(true);
  });

  it('toggleFocusMode 没有标签时自动新建未命名标签', () => {
    const { result } = renderHook(() => useHarness());
    act(() => result.current.actions.toggleFocusMode());
    // StrictMode 之外 updater 只执行一次，计数器应为 1
    expect(result.current.openTabs).toHaveLength(1);
    expect(result.current.openTabs[0]).toMatch(/^__untitled__:Untitled-\d+$/);
    expect(result.current.activeTab).toBe(result.current.openTabs[0]);
  });

  it('handleCloseOtherTabs 仅保留目标标签', () => {
    const { result } = renderHook(() =>
      useHarness({ openTabs: ['/a', '/b', '/c'], activeTab: '/a' })
    );
    act(() => result.current.actions.handleCloseOtherTabs('/b'));
    expect(result.current.openTabs).toEqual(['/b']);
    expect(result.current.activeTab).toBe('/b');
  });

  it('handleCloseAllTabs 清空所有标签与未命名内容', () => {
    const { result } = renderHook(() =>
      useHarness({ openTabs: ['/a'], activeTab: '/a', untitled: { u: '' } })
    );
    act(() => result.current.actions.handleCloseAllTabs());
    expect(result.current.openTabs).toEqual([]);
    expect(result.current.activeTab).toBeNull();
    expect(result.current.untitledTabContents).toEqual({});
  });

  it('closeTabsByPredicate 按条件关闭，并在活动标签被关闭时置空', () => {
    const { result } = renderHook(() =>
      useHarness({ openTabs: ['/dir/a', '/dir/b', '/other'], activeTab: '/dir/a' })
    );
    act(() => result.current.actions.closeTabsByPredicate((t) => t.startsWith('/dir/')));
    expect(result.current.openTabs).toEqual(['/other']);
    expect(result.current.activeTab).toBeNull();
  });

  it('closeTabsByPredicate 活动标签不匹配时保持不变', () => {
    const { result } = renderHook(() =>
      useHarness({ openTabs: ['/dir/a', '/other'], activeTab: '/other' })
    );
    act(() => result.current.actions.closeTabsByPredicate((t) => t.startsWith('/dir/')));
    expect(result.current.activeTab).toBe('/other');
  });

  it('handleCloseAllAndSave 先派发 Cmd+S，再延迟关闭所有标签', () => {
    const keydowns: KeyboardEvent[] = [];
    const listener = (e: KeyboardEvent) => keydowns.push(e);
    document.addEventListener('keydown', listener);
    const { result } = renderHook(() => useHarness({ openTabs: ['/a'], activeTab: '/a' }));
    act(() => result.current.actions.handleCloseAllAndSave());
    expect(keydowns).toHaveLength(1);
    expect(keydowns[0].key).toBe('s');
    expect(keydowns[0].metaKey).toBe(true);
    expect(result.current.openTabs).toEqual(['/a']);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.openTabs).toEqual([]);
    expect(result.current.activeTab).toBeNull();
    document.removeEventListener('keydown', listener);
  });
});
