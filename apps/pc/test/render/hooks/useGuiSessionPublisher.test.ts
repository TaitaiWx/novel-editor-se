// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  GUI_SESSION_HEARTBEAT_MS,
  GUI_SESSION_PUBLISH_DEBOUNCE_MS,
  buildGuiSessionSnapshot,
  useGuiSessionPublisher,
  type UseGuiSessionPublisherContext,
} from '@/render/hooks/useGuiSessionPublisher';
import {
  NOVEL_EDITOR_DIRTY_CHANGE_EVENT,
  emitDirtyChange,
  type NovelEditorDirtyChangeDetail,
} from '@/render/utils/editor-events';
import { useDirtyStateBroadcast } from '@/render/components/TextEditor/hooks/useDirtyStateBroadcast';
import { installElectronMock, uninstallElectronMock, type ElectronMock } from './electronMock';

let electron: ElectronMock;

function publishCalls(): unknown[] {
  return electron.invoke.mock.calls
    .filter(([channel]) => channel === 'gui-session-publish')
    .map(([, snapshot]) => snapshot);
}

const base: UseGuiSessionPublisherContext = {
  folderPath: '/book',
  openTabs: ['/book/a.md', '/book/b.md', '__workspace__:characters', '__changelog__:CHANGELOG'],
  activeTab: '/book/a.md',
  untitledTabContents: {},
};

beforeEach(() => {
  vi.useFakeTimers();
  electron = installElectronMock(() => ({ success: true }));
});

afterEach(() => {
  vi.useRealTimers();
  uninstallElectronMock();
});

describe('buildGuiSessionSnapshot', () => {
  it('过滤虚拟标签与工作区外文件，未命名标签有内容即未保存', () => {
    const snapshot = buildGuiSessionSnapshot(
      '/book',
      [
        '/book/a.md',
        '/other/x.md',
        '__workspace__:lore',
        '__untitled__:未命名-1',
        '__untitled__:空',
      ],
      '__workspace__:lore',
      { '__untitled__:未命名-1': '草稿', '__untitled__:空': '' },
      new Set(['/book/c.md'])
    );
    expect(snapshot).toEqual({
      workspaceRoot: '/book',
      activeFile: null,
      openFiles: [
        { path: '/book/a.md', dirty: false },
        { path: '__untitled__:未命名-1', dirty: true },
        { path: '__untitled__:空', dirty: false },
        { path: '/book/c.md', dirty: true },
      ],
    });
  });
});

describe('useGuiSessionPublisher', () => {
  it('防抖发布会话，并跟随编辑器未保存状态更新', async () => {
    renderHook(() => useGuiSessionPublisher(base));
    expect(publishCalls()).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(GUI_SESSION_PUBLISH_DEBOUNCE_MS);
    });
    expect(publishCalls()).toEqual([
      {
        workspaceRoot: '/book',
        activeFile: '/book/a.md',
        openFiles: [
          { path: '/book/a.md', dirty: false },
          { path: '/book/b.md', dirty: false },
        ],
      },
    ]);

    // 连续变化只发布一次
    await act(async () => {
      emitDirtyChange('/book/a.md', true);
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      emitDirtyChange('/book/b.md', true);
    });
    await act(async () => {
      vi.advanceTimersByTime(GUI_SESSION_PUBLISH_DEBOUNCE_MS);
    });
    expect(publishCalls()).toHaveLength(2);
    expect(publishCalls()[1]).toMatchObject({
      openFiles: [
        { path: '/book/a.md', dirty: true },
        { path: '/book/b.md', dirty: true },
      ],
    });

    await act(async () => {
      emitDirtyChange('/book/a.md', false);
    });
    await act(async () => {
      vi.advanceTimersByTime(GUI_SESSION_PUBLISH_DEBOUNCE_MS);
    });
    expect(publishCalls()[2]).toMatchObject({
      openFiles: [
        { path: '/book/a.md', dirty: false },
        { path: '/book/b.md', dirty: true },
      ],
    });
  });

  it('心跳定期重新发布；关闭文件夹或卸载时上报 null', async () => {
    const { rerender, unmount } = renderHook(
      (props: UseGuiSessionPublisherContext) => useGuiSessionPublisher(props),
      { initialProps: base }
    );
    await act(async () => {
      vi.advanceTimersByTime(GUI_SESSION_PUBLISH_DEBOUNCE_MS);
    });
    await act(async () => {
      vi.advanceTimersByTime(GUI_SESSION_HEARTBEAT_MS);
    });
    expect(publishCalls()).toHaveLength(2);
    expect(publishCalls()[1]).toEqual(publishCalls()[0]);

    rerender({ ...base, folderPath: null, openTabs: [], activeTab: null });
    expect(publishCalls().at(-1)).toBeNull();
    const count = publishCalls().length;
    await act(async () => {
      vi.advanceTimersByTime(GUI_SESSION_HEARTBEAT_MS * 2);
    });
    expect(publishCalls()).toHaveLength(count);

    rerender(base);
    await act(async () => {
      vi.advanceTimersByTime(GUI_SESSION_PUBLISH_DEBOUNCE_MS);
    });
    expect(publishCalls().at(-1)).toMatchObject({ workspaceRoot: '/book' });
    unmount();
    expect(publishCalls().at(-1)).toBeNull();
  });

  it('没有 electron 桥时静默跳过', async () => {
    uninstallElectronMock();
    renderHook(() => useGuiSessionPublisher(base));
    await act(async () => {
      vi.advanceTimersByTime(GUI_SESSION_PUBLISH_DEBOUNCE_MS);
    });
    expect(electron.invoke).not.toHaveBeenCalled();
  });
});

describe('useDirtyStateBroadcast', () => {
  it('广播未保存状态；切换文件时把旧文件标记为已保存', () => {
    const events: NovelEditorDirtyChangeDetail[] = [];
    const listener = (event: Event) =>
      events.push((event as CustomEvent<NovelEditorDirtyChangeDetail>).detail);
    document.addEventListener(NOVEL_EDITOR_DIRTY_CHANGE_EVENT, listener);
    try {
      const { rerender, unmount } = renderHook(
        ({ file, dirty }: { file: string | null; dirty: boolean }) =>
          useDirtyStateBroadcast(file, dirty),
        { initialProps: { file: '/book/a.md' as string | null, dirty: false } }
      );
      rerender({ file: '/book/a.md', dirty: true });
      rerender({ file: '/book/b.md', dirty: false });
      unmount();
      expect(events).toEqual([
        { filePath: '/book/a.md', dirty: false },
        { filePath: '/book/a.md', dirty: true },
        { filePath: '/book/a.md', dirty: false },
        { filePath: '/book/b.md', dirty: false },
      ]);
    } finally {
      document.removeEventListener(NOVEL_EDITOR_DIRTY_CHANGE_EVENT, listener);
    }
  });
});
