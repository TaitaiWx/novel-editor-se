// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  useWorkspaceEntityActions,
  type UseWorkspaceEntityActionsContext,
} from '@/render/hooks/useWorkspaceEntityActions';
import {
  useEditorInteractions,
  type UseEditorInteractionsContext,
} from '@/render/hooks/useEditorInteractions';
import { requestRevealInFilePanel } from '@/render/utils/workspaceFiles';
import { installElectronMock, uninstallElectronMock } from './electronMock';
import { ref } from './hookCtx';

afterEach(() => {
  uninstallElectronMock();
});

const STORYBOARD = '/w/novels/星河旅人/资料/视频/001-启程/第一场 清晨的青石镇/分镜.json';

describe('从资料打开场景视频的 分镜.json', () => {
  function setup(fileContent: unknown) {
    const electron = installElectronMock((channel) =>
      channel === 'read-file' ? fileContent : undefined
    );
    const openFileInTab = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceEntityActions({
        openFileInTab,
        workspaceCharacters: [],
        workspaceLoreEntries: [],
      } as unknown as UseWorkspaceEntityActionsContext)
    );
    return { electron, openFileInTab, select: result.current.handleFileSelect };
  }

  it('分镜.json → 打开这一场的画布标签（而不是显示 JSON）', async () => {
    const { electron, openFileInTab, select } = setup(
      JSON.stringify({
        chapterPath: '/w/novels/星河旅人/第一卷-离乡/001-启程.md',
        scene: '第一场 清晨的青石镇',
      })
    );
    act(() => select(STORYBOARD));
    await waitFor(() =>
      expect(openFileInTab).toHaveBeenCalledWith(
        '__workspace__:scene-video:/w/novels/星河旅人/第一卷-离乡/001-启程.md#第一场 清晨的青石镇'
      )
    );
    expect(electron.invoke).toHaveBeenCalledWith('read-file', STORYBOARD);
  });

  it('内容损坏时按普通文件打开；其他文件直接打开', async () => {
    const { openFileInTab, select } = setup('{broken');
    act(() => select(STORYBOARD));
    await waitFor(() => expect(openFileInTab).toHaveBeenCalledWith(STORYBOARD));
    act(() => select('/w/资料/视频/001-启程/第一场/分镜.md'));
    expect(openFileInTab).toHaveBeenLastCalledWith('/w/资料/视频/001-启程/第一场/分镜.md');
  });
});

describe('在资料中定位（REVEAL_IN_FILE_PANEL_EVENT）', () => {
  it('退出专注模式、展开侧边栏，并向文件面板发出定位请求', () => {
    const ctx = {
      focusMode: true,
      setFocusMode: vi.fn(),
      sidebarCollapsedRef: ref(true),
      handleExpandSidebar: vi.fn(),
      setFilePanelRevealRequest: vi.fn(),
      filePanelRevealCounterRef: ref(0),
    };
    const { unmount } = renderHook(() =>
      useEditorInteractions(ctx as unknown as UseEditorInteractionsContext)
    );
    act(() => requestRevealInFilePanel('/w/资料/视频/001-启程/第一场'));
    expect(ctx.setFocusMode).toHaveBeenCalledWith(false);
    expect(ctx.handleExpandSidebar).toHaveBeenCalled();
    expect(ctx.setFilePanelRevealRequest).toHaveBeenCalledWith({
      path: '/w/资料/视频/001-启程/第一场',
      id: 'reveal-1',
    });
    unmount();
    act(() => requestRevealInFilePanel('/x'));
    expect(ctx.setFilePanelRevealRequest).toHaveBeenCalledTimes(1);
  });

  it('文件属于其他作品时先切换作品（selectWorkForPath），再请求定位', () => {
    const selectWorkForPath = vi.fn();
    const ctx = {
      focusMode: false,
      setFocusMode: vi.fn(),
      sidebarCollapsedRef: ref(false),
      handleExpandSidebar: vi.fn(),
      setFilePanelRevealRequest: vi.fn(),
      filePanelRevealCounterRef: ref(0),
      selectWorkForPath,
    };
    const { unmount } = renderHook(() =>
      useEditorInteractions(ctx as unknown as UseEditorInteractionsContext)
    );
    const target = '/w/novels/剑与诗/资料/图集/人物/沈砚/三视图.webp';
    act(() => requestRevealInFilePanel(target));
    expect(selectWorkForPath).toHaveBeenCalledWith(target);
    expect(ctx.setFocusMode).not.toHaveBeenCalled();
    expect(ctx.handleExpandSidebar).not.toHaveBeenCalled();
    expect(ctx.setFilePanelRevealRequest).toHaveBeenCalledWith({ path: target, id: 'reveal-1' });
    unmount();
  });
});
