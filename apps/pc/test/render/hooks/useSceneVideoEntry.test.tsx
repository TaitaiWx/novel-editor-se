// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { EditorSelection, EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { isSceneVideoShortcut, useSceneVideoEntry } from '@/render/hooks/useSceneVideoEntry';
import {
  getSceneVideoSeed,
  requestOpenSceneVideo,
} from '@/render/components/SceneVideoView/events';
import { installElectronMock, uninstallElectronMock } from './electronMock';

const CHAPTER = '/w/novels/星河旅人/第一卷-离乡/001-启程.md';
const OTHER = '/w/novels/星河旅人/第一卷-离乡/002-迷雾森林.md';
const DOC = [
  '# 启程',
  '',
  '第一场 清晨',
  '',
  '林舟回头看了一眼。',
  '',
  '第二场 夜',
  '',
  '炉火很暖。',
].join('\n');

function fakeView(anchor: number, head = anchor): { current: EditorView | null } {
  const state = EditorState.create({ doc: DOC, selection: EditorSelection.single(anchor, head) });
  return { current: { state } as unknown as EditorView };
}

function setup(options: { active?: string | null; view?: { current: EditorView | null } } = {}) {
  const openFileInTab = vi.fn();
  const toast = { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() };
  const hook = renderHook(() =>
    useSceneVideoEntry({
      activeDocumentTab: options.active === undefined ? CHAPTER : options.active,
      editorViewRef: options.view ?? { current: null },
      openFileInTab,
      toast: toast as never,
    })
  );
  return { ...hook, openFileInTab, toast };
}

afterEach(() => {
  cleanup();
  uninstallElectronMock();
});

describe('场景视频入口', () => {
  it('编辑器有选区：用选中的文字，场景名取所在的「第X场」', async () => {
    installElectronMock();
    const from = DOC.indexOf('林舟');
    const { openFileInTab } = setup({ view: fakeView(from, from + 4) });
    act(() => requestOpenSceneVideo());
    const tab = `__workspace__:scene-video:${CHAPTER}#第一场 清晨`;
    await waitFor(() => expect(openFileInTab).toHaveBeenCalledWith(tab));
    expect(getSceneVideoSeed(tab)).toEqual({ sourceText: '林舟回头', origin: 'selection' });
  });

  it('没有选区：取光标所在的场；卷纲指定场景时忽略选区', async () => {
    installElectronMock();
    const cursor = DOC.indexOf('炉火');
    const first = setup({ view: fakeView(cursor) });
    act(() => requestOpenSceneVideo());
    await waitFor(() =>
      expect(first.openFileInTab).toHaveBeenCalledWith(
        `__workspace__:scene-video:${CHAPTER}#第二场 夜`
      )
    );
    cleanup();
    const from = DOC.indexOf('林舟');
    const second = setup({ view: fakeView(from, from + 4) });
    act(() => requestOpenSceneVideo({ scene: '第二场 夜' }));
    await waitFor(() =>
      expect(second.openFileInTab).toHaveBeenCalledWith(
        `__workspace__:scene-video:${CHAPTER}#第二场 夜`
      )
    );
    expect(getSceneVideoSeed(`__workspace__:scene-video:${CHAPTER}#第二场 夜`)?.sourceText).toBe(
      '炉火很暖。'
    );
  });

  it('卷纲中其他章节的场景：读取该章正文', async () => {
    const electron = installElectronMock((channel) =>
      channel === 'read-file' ? '第三场 狼王\n\n狼王从雾中现身。' : null
    );
    const { openFileInTab } = setup({ view: fakeView(0) });
    act(() => requestOpenSceneVideo({ chapterPath: OTHER, scene: '第三场 狼王', line: 1 }));
    await waitFor(() =>
      expect(openFileInTab).toHaveBeenCalledWith(`__workspace__:scene-video:${OTHER}#第三场 狼王`)
    );
    expect(electron.invoke).toHaveBeenCalledWith('read-file', OTHER);
  });

  it('没有打开章节时提示，不打开标签', async () => {
    installElectronMock();
    const { openFileInTab, toast } = setup({ active: null });
    act(() => requestOpenSceneVideo());
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(openFileInTab).not.toHaveBeenCalled();
    const growth = setup({ active: '__workspace__:growth' });
    act(() => requestOpenSceneVideo());
    await waitFor(() => expect(growth.toast.info).toHaveBeenCalled());
  });

  it('快捷键（Mod+Alt+V，按物理键位）打开并阻止默认行为', async () => {
    installElectronMock();
    const { openFileInTab } = setup({ view: fakeView(DOC.indexOf('炉火')) });
    act(() => requestOpenSceneVideo());
    await waitFor(() => expect(openFileInTab).toHaveBeenCalledTimes(1));
    const event = new KeyboardEvent('keydown', {
      code: 'KeyV',
      key: '√',
      metaKey: true,
      altKey: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(event);
    });
    await waitFor(() => expect(openFileInTab).toHaveBeenCalledTimes(2));
    expect(event.defaultPrevented).toBe(true);
    expect(
      isSceneVideoShortcut(new KeyboardEvent('keydown', { code: 'KeyV', metaKey: true }))
    ).toBe(false);
  });
});
