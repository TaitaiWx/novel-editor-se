// @vitest-environment happy-dom
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { FileNode } from '@/render/types';
import type { AssistantArtifactGenerationStatus } from '@/render/utils/assistantGeneration';
import { useExternalFileDrop } from '@/render/components/FilePanel/hooks/useExternalFileDrop';
import { useStoryDragReorder } from '@/render/components/FilePanel/hooks/useStoryDragReorder';
import { useFilePanelSearch } from '@/render/components/FilePanel/hooks/useFilePanelSearch';
import {
  REVEAL_HIGHLIGHT_DURATION,
  useStoryTreeReveal,
} from '@/render/components/FilePanel/hooks/useStoryTreeReveal';

/** 构造最小化的拖拽事件 */
function makeDragEvent(options: {
  types?: string[];
  files?: unknown[];
  clientY?: number;
  rect?: { top: number; height: number };
}) {
  const dataTransfer = {
    types: options.types ?? [],
    files: options.files ?? [],
    dropEffect: 'none',
    effectAllowed: 'all',
    setData: vi.fn(),
  };
  return {
    event: {
      dataTransfer,
      preventDefault: vi.fn(),
      clientY: options.clientY ?? 0,
      currentTarget: {
        getBoundingClientRect: () => options.rect ?? { top: 0, height: 20 },
      },
    } as unknown as React.DragEvent,
    dataTransfer,
  };
}

describe('useExternalFileDrop', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'electron');
  });

  it('仅响应外部文件拖拽，enter/leave 计数控制高亮', () => {
    const { result } = renderHook(() => useExternalFileDrop(vi.fn()));
    const internal = makeDragEvent({ types: ['text/plain'] });
    act(() => result.current.handleDragEnter(internal.event));
    expect(result.current.isDragOver).toBe(false);

    const external = makeDragEvent({ types: ['Files'] });
    act(() => result.current.handleDragEnter(external.event));
    act(() => result.current.handleDragEnter(external.event));
    expect(result.current.isDragOver).toBe(true);
    act(() => result.current.handleDragLeave());
    expect(result.current.isDragOver).toBe(true);
    act(() => result.current.handleDragLeave());
    expect(result.current.isDragOver).toBe(false);

    result.current.handleDragOver(external.event);
    expect(external.dataTransfer.dropEffect).toBe('copy');
  });

  it('drop 时取回 preload 提取的路径并回调', () => {
    const onDropFiles = vi.fn();
    Object.defineProperty(window, 'electron', {
      value: { getLastDroppedPaths: () => ['/tmp/a.docx'] },
      configurable: true,
    });
    const { result } = renderHook(() => useExternalFileDrop(onDropFiles));
    const external = makeDragEvent({ types: ['Files'], files: [{}] });
    act(() => result.current.handleDragEnter(external.event));
    act(() => result.current.handleDrop(external.event));
    expect(result.current.isDragOver).toBe(false);
    expect(onDropFiles).toHaveBeenCalledWith(['/tmp/a.docx']);
  });

  it('没有文件时不回调', () => {
    const onDropFiles = vi.fn();
    const { result } = renderHook(() => useExternalFileDrop(onDropFiles));
    act(() => result.current.handleDrop(makeDragEvent({ types: ['Files'] }).event));
    expect(onDropFiles).not.toHaveBeenCalled();
  });
});

describe('useStoryDragReorder', () => {
  it('同级拖拽：根据位置计算落点并在 drop 时回调排序', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useStoryDragReorder(onReorder));

    act(() => result.current.handleStoryDragStart(makeDragEvent({}).event, '/a.md', '/p'));
    const over = makeDragEvent({ clientY: 18, rect: { top: 0, height: 20 } });
    act(() => result.current.handleStoryDragOver(over.event, '/b.md', '/p', false));
    expect(result.current.storyDropTarget).toEqual({ path: '/b.md', mode: 'after' });
    expect(over.dataTransfer.dropEffect).toBe('move');

    act(() => result.current.handleStoryDrop(makeDragEvent({}).event, '/b.md', '/p', 'after'));
    expect(onReorder).toHaveBeenCalledWith('/a.md', '/b.md', 'after');
    expect(result.current.storyDropTarget).toBeNull();
  });

  it('跨父级的前后插入与拖到自身均被忽略，目录允许 inside', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useStoryDragReorder(onReorder));
    act(() => result.current.handleStoryDragStart(makeDragEvent({}).event, '/a.md', '/p'));

    const crossParent = makeDragEvent({});
    act(() => result.current.handleStoryDragOver(crossParent.event, '/q/b.md', '/q', false));
    expect(crossParent.event.preventDefault).not.toHaveBeenCalled();
    expect(result.current.storyDropTarget).toBeNull();

    act(() => result.current.handleStoryDragOver(makeDragEvent({}).event, '/a.md', '/p', false));
    expect(result.current.storyDropTarget).toBeNull();

    act(() => result.current.handleStoryDragOver(makeDragEvent({}).event, '/q', '/root', true));
    expect(result.current.storyDropTarget).toEqual({ path: '/q', mode: 'inside' });

    act(() => result.current.handleStoryDrop(makeDragEvent({}).event, '/q/b.md', '/q', 'before'));
    expect(onReorder).not.toHaveBeenCalled();

    act(() => result.current.handleStoryDragEnd());
    expect(result.current.storyDropTarget).toBeNull();
  });

  it('未开始拖拽时 dragOver 不生效', () => {
    const { result } = renderHook(() => useStoryDragReorder(vi.fn()));
    act(() => result.current.handleStoryDragOver(makeDragEvent({}).event, '/b.md', '/p', false));
    expect(result.current.storyDropTarget).toBeNull();
  });
});

describe('useFilePanelSearch', () => {
  it('切换显示，关闭时清空关键词', () => {
    const { result } = renderHook(() => useFilePanelSearch('Mod+P'));
    act(() => result.current.handleToggleSearch());
    expect(result.current.showSearch).toBe(true);
    act(() => result.current.setSearchQuery('abc'));
    act(() => result.current.handleToggleSearch());
    expect(result.current.showSearch).toBe(false);
    expect(result.current.searchQuery).toBe('');
  });

  it('closeSearch 清空并隐藏', () => {
    const { result } = renderHook(() => useFilePanelSearch('Mod+P'));
    act(() => {
      result.current.handleToggleSearch();
      result.current.setSearchQuery('x');
    });
    act(() => result.current.closeSearch());
    expect(result.current).toMatchObject({ showSearch: false, searchQuery: '' });
  });

  it('快捷键打开搜索，卸载后移除监听', () => {
    const { result, unmount } = renderHook(() => useFilePanelSearch('Mod+P'));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', metaKey: true }));
    });
    expect(result.current.showSearch).toBe(true);
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    removeSpy.mockRestore();
  });
});

describe('useStoryTreeReveal', () => {
  const nodes: FileNode[] = [
    {
      name: '第一卷',
      path: '/p/v1',
      type: 'directory',
      children: [
        {
          name: '支线',
          path: '/p/v1/side',
          type: 'directory',
          children: [{ name: '第一章.md', path: '/p/v1/side/c1.md', type: 'file' }],
        },
      ],
    },
  ];

  const baseOptions = {
    storyDisplayNodes: nodes,
    selectedFile: null as string | null,
    activeVolumePath: null as string | null,
    revealFileRequest: null as { path: string; id: string } | null,
    characterGenerationStatus: null as AssistantArtifactGenerationStatus | null,
    closeSearch: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('选中文件时展开祖先目录；可手动切换目录展开', () => {
    const { result, rerender } = renderHook((props) => useStoryTreeReveal(props), {
      initialProps: baseOptions,
    });
    expect(result.current.expandedStoryDirs.size).toBe(0);
    rerender({ ...baseOptions, selectedFile: '/p/v1/side/c1.md' });
    expect([...result.current.expandedStoryDirs]).toEqual(['/p/v1', '/p/v1/side']);

    act(() => result.current.toggleStoryDirectory('/p/v1'));
    expect(result.current.expandedStoryDirs.has('/p/v1')).toBe(false);
    act(() => result.current.toggleStoryDirectory('/p/v1'));
    expect(result.current.expandedStoryDirs.has('/p/v1')).toBe(true);
  });

  it('激活卷时展开该卷自身', () => {
    const { result } = renderHook(() =>
      useStoryTreeReveal({ ...baseOptions, activeVolumePath: '/p/v1' })
    );
    expect(result.current.expandedStoryDirs.has('/p/v1')).toBe(true);
  });

  it('toggleSection 切换分区折叠', () => {
    const { result } = renderHook(() => useStoryTreeReveal(baseOptions));
    act(() => result.current.toggleSection('lore'));
    expect(result.current.collapsedSections.lore).toBe(true);
    act(() => result.current.toggleSection('lore'));
    expect(result.current.collapsedSections.lore).toBe(false);
  });

  it('外部定位请求：关闭搜索、展开正文、短暂高亮后复位', () => {
    const closeSearch = vi.fn();
    const { result, rerender } = renderHook((props) => useStoryTreeReveal(props), {
      initialProps: { ...baseOptions, closeSearch },
    });
    act(() => result.current.toggleSection('story'));
    expect(result.current.collapsedSections.story).toBe(true);

    rerender({
      ...baseOptions,
      closeSearch,
      revealFileRequest: { path: '/p/v1/side/c1.md', id: '1' },
    });
    expect(closeSearch).toHaveBeenCalledTimes(1);
    expect(result.current.collapsedSections.story).toBe(false);
    expect(result.current.expandedStoryDirs.has('/p/v1/side')).toBe(true);
    expect(result.current.revealPath).toBe('/p/v1/side/c1.md');

    act(() => {
      vi.advanceTimersByTime(REVEAL_HIGHLIGHT_DURATION);
    });
    expect(result.current.revealPath).toBeNull();
  });

  it('定位时滚动并聚焦已登记的节点', () => {
    const { result } = renderHook(() => useStoryTreeReveal(baseOptions));
    const element = document.createElement('div');
    element.scrollIntoView = vi.fn();
    const focusSpy = vi.spyOn(element, 'focus');
    act(() => result.current.registerStoryNodeRef('/p/v1', element));
    act(() => result.current.triggerRevealPath('/p/v1'));
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(element.scrollIntoView).toHaveBeenCalled();
    expect(focusSpy).toHaveBeenCalled();
    act(() => result.current.registerStoryNodeRef('/p/v1', null));
  });

  it('角色生成状态运行中时自动展开角色分区', () => {
    const status = {
      scopePath: '/p',
      state: 'running',
      startedAt: 't1',
      finishedAt: null,
      message: '生成中',
    } as unknown as AssistantArtifactGenerationStatus;
    const { result, rerender } = renderHook((props) => useStoryTreeReveal(props), {
      initialProps: baseOptions,
    });
    act(() => result.current.toggleSection('characters'));
    expect(result.current.collapsedSections.characters).toBe(true);
    rerender({ ...baseOptions, characterGenerationStatus: status });
    expect(result.current.collapsedSections.characters).toBe(false);
  });
});
