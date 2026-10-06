// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceProjectLayout } from '@/render/types';
import { useWorkScope, type UseWorkScopeContext } from '@/render/hooks/useWorkScope';
import {
  listWorkScopeOptions,
  readStoredWorkPath,
  resolveWorkScope,
  storeWorkPath,
} from '@/render/utils/workScope';
import { installElectronMock, uninstallElectronMock } from './electronMock';
import { makeDialog, makeToast, ref } from './hookCtx';

const layout: WorkspaceProjectLayout = {
  name: '示例作品集',
  novelsDir: 'novels',
  novelsPath: '/s/novels',
  novels: ['剑与诗', '星河旅人'],
};

afterEach(() => {
  uninstallElectronMock();
  window.localStorage.clear();
});

/** 用真实 state 驱动 preferredWorkPath，模拟 useWorkspaceState 中的派生 */
function setup(
  options: {
    activeDocumentTab?: string | null;
    prompts?: Array<string | null>;
    folderPath?: string;
  } = {}
) {
  const dialog = makeDialog({ prompts: options.prompts });
  const toast = makeToast();
  const refreshCurrentFolder = vi.fn(async () => undefined);
  const workScopePathRef = ref<string | null>(null);
  const hook = renderHook(
    ({ activeDocumentTab }: { activeDocumentTab: string | null }) => {
      const [preferred, setPreferredWorkPath] = useState<string | null>(null);
      const folderPath = options.folderPath ?? '/s';
      const workScopeOptions = listWorkScopeOptions(folderPath, layout);
      const workScope = resolveWorkScope(workScopeOptions, preferred);
      workScopePathRef.current = workScope?.path ?? null;
      const ctx = {
        activeDocumentTab,
        dialog,
        folderPath,
        projectLayout: layout,
        refreshCurrentFolder,
        setPreferredWorkPath,
        toast,
        workScope,
        workScopeOptions,
        workScopePathRef,
      } as unknown as UseWorkScopeContext;
      return useWorkScope(ctx);
    },
    { initialProps: { activeDocumentTab: options.activeDocumentTab ?? null } }
  );
  return { hook, dialog, toast, refreshCurrentFolder };
}

describe('useWorkScope', () => {
  it('恢复该项目上次选择的作品；切换后保存选择', () => {
    storeWorkPath('/s', '/s/novels/星河旅人');
    const { hook } = setup();
    expect(hook.result.current.workScope?.name).toBe('星河旅人');
    act(() => hook.result.current.handleSelectWork('/s/novels/剑与诗'));
    expect(hook.result.current.workScope?.name).toBe('剑与诗');
    expect(readStoredWorkPath('/s')).toBe('/s/novels/剑与诗');
  });

  it('打开另一部作品的章节时切换过去；手动切回后不会被同一标签拉回', () => {
    const { hook } = setup();
    expect(hook.result.current.workScope?.name).toBe('剑与诗');
    hook.rerender({ activeDocumentTab: '/s/novels/星河旅人/第一卷/001-启程.md' });
    expect(hook.result.current.workScope?.name).toBe('星河旅人');

    act(() => hook.result.current.handleSelectWork('/s/novels/剑与诗'));
    hook.rerender({ activeDocumentTab: '/s/novels/星河旅人/第一卷/001-启程.md' });
    expect(hook.result.current.workScope?.name).toBe('剑与诗');
    // 项目文档、工作区标签不切换作品
    hook.rerender({ activeDocumentTab: '/s/欢迎使用.md' });
    expect(hook.result.current.workScope?.name).toBe('剑与诗');
  });

  it('主动点击另一部作品的标签（即使已是当前标签）会切回该作品；项目文档不切换', () => {
    const chapter = '/s/novels/星河旅人/第一卷/001-启程.md';
    const { hook } = setup({ activeDocumentTab: chapter });
    expect(hook.result.current.workScope?.name).toBe('星河旅人');
    act(() => hook.result.current.handleSelectWork('/s/novels/剑与诗'));
    expect(hook.result.current.workScope?.name).toBe('剑与诗');

    act(() => hook.result.current.revealWorkForDocument(chapter));
    expect(hook.result.current.workScope?.name).toBe('星河旅人');

    act(() => hook.result.current.revealWorkForDocument('/s/欢迎使用.md'));
    expect(hook.result.current.workScope?.name).toBe('星河旅人');
  });

  it('新建作品：在作品根目录创建文件夹、刷新并切换过去', async () => {
    const mock = installElectronMock((channel, ...args) =>
      channel === 'create-directory' ? { success: true, dirPath: `${args[0]}/${args[1]}` } : null
    );
    const { hook, toast, refreshCurrentFolder } = setup({ prompts: ['海上书'] });
    await act(() => hook.result.current.handleCreateWork());
    expect(mock.invoke).toHaveBeenCalledWith('create-directory', '/s/novels', '海上书');
    expect(refreshCurrentFolder).toHaveBeenCalled();
    expect(readStoredWorkPath('/s')).toBe('/s/novels/海上书');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('已新建作品「海上书」'));
  });

  it('新建作品：取消、非法名称或创建失败时给出提示且不切换', async () => {
    const mock = installElectronMock((channel) => {
      if (channel === 'create-directory') throw new Error('目录已存在');
      return null;
    });
    const { hook, toast } = setup({ prompts: [null, 'a/b', '星河旅人'] });
    await act(() => hook.result.current.handleCreateWork());
    expect(mock.invoke).not.toHaveBeenCalled();
    await act(() => hook.result.current.handleCreateWork());
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('作品名不能包含'));
    await act(() => hook.result.current.handleCreateWork());
    expect(toast.error).toHaveBeenCalledWith('新建作品失败: 目录已存在');
    expect(readStoredWorkPath('/s')).toBeNull();
  });
});
