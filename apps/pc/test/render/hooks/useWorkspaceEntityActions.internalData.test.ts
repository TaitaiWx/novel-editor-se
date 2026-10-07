// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  useWorkspaceEntityActions,
  type UseWorkspaceEntityActionsContext,
} from '@/render/hooks/useWorkspaceEntityActions';
import type { FileNode } from '@/render/types';
import { createGrowthWorkspaceTab, createSceneVideoWorkspaceTab } from '@/render/utils/workspace';
import { installElectronMock, uninstallElectronMock } from './electronMock';
import { makeToast, ref } from './hookCtx';

const ROOT = '/w';
const SCENE_DIR = '/w/novels/星河旅人/资料/视频/001-启程/第一场';
const CHAPTER = '/w/novels/星河旅人/第一卷/001-启程.md';

const files: FileNode[] = [
  {
    name: '第一场',
    path: SCENE_DIR,
    type: 'directory',
    sceneVideo: true,
    children: [],
  },
  { name: '普通目录', path: '/w/资料/视频/001-启程/普通', type: 'directory', children: [] },
];

function setup() {
  const openFileInTab = vi.fn();
  const toast = makeToast();
  const ctx = {
    filesRef: ref(files),
    folderPathRef: ref(ROOT),
    openFileInTab,
    toast,
    workspaceCharacters: [],
    workspaceLoreEntries: [],
  } as unknown as UseWorkspaceEntityActionsContext;
  const { result } = renderHook(() => useWorkspaceEntityActions(ctx));
  return { handleFileSelect: result.current.handleFileSelect, openFileInTab, toast };
}

afterEach(() => uninstallElectronMock());

describe('handleFileSelect：内部数据转到可视化界面', () => {
  it('场景视频目录 → 读取分镜状态打开画布（不打开 JSON）', async () => {
    const mock = installElectronMock((channel) =>
      channel === 'read-file' ? JSON.stringify({ chapterPath: CHAPTER, scene: '第一场' }) : null
    );
    const { handleFileSelect, openFileInTab } = setup();
    handleFileSelect(SCENE_DIR);
    await waitFor(() =>
      expect(openFileInTab).toHaveBeenCalledWith(
        createSceneVideoWorkspaceTab({ chapterPath: CHAPTER, scene: '第一场' })
      )
    );
    expect(mock.invoke).toHaveBeenCalledWith('read-file', `${SCENE_DIR}/分镜.json`);
  });

  it('分镜状态记录不完整时提示，不打开原文', async () => {
    installElectronMock(() => '{}');
    const { handleFileSelect, openFileInTab, toast } = setup();
    handleFileSelect(`${SCENE_DIR}/分镜.json`);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(openFileInTab).not.toHaveBeenCalled();
  });

  it('成长档案 JSON → 成长档案标签；提示词记录只提示', () => {
    installElectronMock();
    const { handleFileSelect, openFileInTab, toast } = setup();
    handleFileSelect('/w/资料/记忆/角色/林舟.json');
    expect(openFileInTab).toHaveBeenLastCalledWith(createGrowthWorkspaceTab('林舟'));
    handleFileSelect('/w/资料/记忆/规则.json');
    expect(openFileInTab).toHaveBeenLastCalledWith(createGrowthWorkspaceTab(null));
    handleFileSelect(`${SCENE_DIR}/镜头1-v1.prompt.json`);
    expect(toast.info).toHaveBeenCalledWith('这是软件内部数据，请在「场景视频」中查看');
    expect(openFileInTab).toHaveBeenCalledTimes(2);
  });

  it('普通文件照常打开', () => {
    installElectronMock();
    const { handleFileSelect, openFileInTab } = setup();
    handleFileSelect('/w/资料/人物表.json');
    expect(openFileInTab).toHaveBeenCalledWith('/w/资料/人物表.json');
  });
});
