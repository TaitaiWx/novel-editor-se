// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useWorkspaceCreation,
  type UseWorkspaceCreationContext,
} from '@/render/hooks/useWorkspaceCreation';
import type { FileNode } from '@/render/types';
import type { CreatingType } from '@/render/app/types';
import {
  WORKSPACE_TAB_CHARACTERS,
  WORKSPACE_TAB_LORE,
  createCharacterWorkspaceTab,
  createLoreWorkspaceTab,
  createVolumeWorkspaceTab,
} from '@/render/utils/workspace';
import { installElectronMock, uninstallElectronMock, type InvokeHandler } from './electronMock';
import { makeDialog, makeToast, ref, type DialogSpy } from './hookCtx';

const FOLDER = '/w';

function file(path: string): FileNode {
  return { name: path.split('/').pop() || path, path, type: 'file' };
}
function dir(path: string, children: FileNode[] = []): FileNode {
  return { name: path.split('/').pop() || path, path, type: 'directory', children };
}

function defaultTree(): FileNode[] {
  return [
    dir('/w/第一卷', [file('/w/第一卷/第1章.md'), file('/w/第一卷/样稿.md')]),
    dir('/w/样稿', [file('/w/样稿/片段.md')]),
    file('/w/第2章.md'),
    dir('/w/资料', [file('/w/资料/a.txt')]),
  ];
}

type Updater<T> = T | ((prev: T) => T);
function applyUpdater<T>(updater: Updater<T>, prev: T): T {
  return typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater;
}

interface Props {
  activeTab: string | null;
  creatingType: CreatingType;
}

function setup(
  options: {
    handler?: InvokeHandler;
    dialog?: DialogSpy;
    files?: FileNode[];
    folder?: string | null;
    activeTab?: string | null;
    creatingType?: CreatingType;
    noIpc?: boolean;
  } = {}
) {
  if (options.noIpc) uninstallElectronMock();
  const electron = options.noIpc ? null : installElectronMock(options.handler);
  const toast = makeToast();
  const dialog = options.dialog ?? makeDialog();
  const files = options.files ?? defaultTree();
  const folder = options.folder === undefined ? FOLDER : options.folder;
  const activeTabRef = ref<string | null>(options.activeTab ?? null);
  const base = {
    activeTabRef,
    dialog,
    files,
    filesRef: ref<FileNode[]>(files),
    folderPath: folder,
    folderPathRef: ref<string | null>(folder),
    openFileInTab: vi.fn(),
    openTabsRef: ref<string[]>([]),
    refreshCurrentFolder: vi.fn(async () => undefined),
    setActiveTab: vi.fn(),
    setCreatingType: vi.fn(),
    setEditorContent: vi.fn(),
    setOpenTabs: vi.fn(),
    setUntitledTabContents: vi.fn(),
    setWorkspaceCharacters: vi.fn(),
    setWorkspaceLoreEntries: vi.fn(),
    toast,
    untitledCounterRef: ref(0),
  };
  const hook = renderHook(
    (props: Props) => {
      activeTabRef.current = props.activeTab;
      return useWorkspaceCreation({ ...base, ...props } as unknown as UseWorkspaceCreationContext);
    },
    {
      initialProps: {
        activeTab: options.activeTab ?? null,
        creatingType: options.creatingType ?? null,
      },
    }
  );
  return { ...hook, ctx: base, toast, dialog, electron };
}

afterEach(() => {
  uninstallElectronMock();
});

describe('useWorkspaceCreation · 行内新建', () => {
  it('有工作区时进入新建文件/目录模式，取消时退出', () => {
    const { result, ctx } = setup();
    act(() => result.current.handleCreateFile());
    act(() => result.current.handleCreateDirectory());
    act(() => result.current.handleCancelCreate());
    expect(ctx.setCreatingType.mock.calls.map((c) => c[0])).toEqual(['file', 'directory', null]);
  });

  it('无工作区时不进入新建模式', () => {
    const { result, ctx } = setup({ folder: null });
    act(() => result.current.handleCreateFile());
    act(() => result.current.handleCreateDirectory());
    expect(ctx.setCreatingType).not.toHaveBeenCalled();
  });

  it('createTargetPath 根据选中节点推断目标目录', () => {
    const { result, rerender } = setup({ creatingType: 'file' });
    expect(result.current.createTargetPath).toBeNull();
    rerender({ creatingType: 'file', activeTab: '/w/第一卷' });
    expect(result.current.createTargetPath).toBe('/w/第一卷');
    rerender({ creatingType: 'file', activeTab: '/w/第一卷/第1章.md' });
    expect(result.current.createTargetPath).toBe('/w/第一卷');
    rerender({ creatingType: 'file', activeTab: '/w/第2章.md' });
    expect(result.current.createTargetPath).toBeNull();
    rerender({ creatingType: 'file', activeTab: '__untitled__:1' });
    expect(result.current.createTargetPath).toBeNull();
    rerender({ creatingType: null, activeTab: '/w/第一卷' });
    expect(result.current.createTargetPath).toBeNull();
  });

  it('行内新建文件补 .md 后缀并落到选中目录', async () => {
    const { result, ctx, electron, toast } = setup({
      creatingType: 'file',
      activeTab: '/w/第一卷',
    });
    await act(() => result.current.handleInlineCreate('file', ' 新章 '));
    expect(electron?.invoke).toHaveBeenCalledWith('create-file', '/w/第一卷', '新章.md');
    expect(toast.success).toHaveBeenCalledWith('文件 "新章" 创建成功');
    expect(ctx.refreshCurrentFolder).toHaveBeenCalled();
    expect(ctx.setCreatingType).toHaveBeenLastCalledWith(null);
  });

  it('行内新建目录落到根目录', async () => {
    const { result, electron, toast } = setup({ creatingType: 'directory' });
    await act(() => result.current.handleInlineCreate('directory', '卷二'));
    expect(electron?.invoke).toHaveBeenCalledWith('create-directory', '/w', '卷二');
    expect(toast.success).toHaveBeenCalledWith('目录 "卷二" 创建成功');
  });

  it('行内新建失败时提示并退出新建模式；无 IPC 提示；无目标目录忽略', async () => {
    const a = setup({
      creatingType: 'file',
      handler: () => {
        throw new Error('exists');
      },
    });
    await act(() => a.result.current.handleInlineCreate('file', 'x'));
    expect(a.toast.error).toHaveBeenCalledWith('创建失败: exists');
    expect(a.ctx.setCreatingType).toHaveBeenLastCalledWith(null);
    a.unmount();

    const b = setup({ creatingType: 'file', noIpc: true });
    await act(() => b.result.current.handleInlineCreate('file', 'x'));
    expect(b.toast.error).toHaveBeenCalledWith('Electron IPC 不可用');
    expect(b.ctx.setCreatingType).toHaveBeenCalledWith(null);
    b.unmount();

    const c = setup({ folder: null });
    await act(() => c.result.current.handleInlineCreate('file', 'x'));
    expect(c.ctx.setCreatingType).not.toHaveBeenCalled();
  });
});

describe('useWorkspaceCreation · 资料目录', () => {
  it('已有资料根目录时直接在其下创建', async () => {
    const { result, electron, toast } = setup({ dialog: makeDialog({ prompts: [' 地图 '] }) });
    await act(() => result.current.handleCreateMaterialDirectory());
    expect(electron?.invoke).toHaveBeenCalledTimes(1);
    expect(electron?.invoke).toHaveBeenCalledWith('create-directory', '/w/资料', '地图');
    expect(toast.success).toHaveBeenCalledWith('资料目录创建成功');
  });

  it('没有资料根目录时先创建“资料”', async () => {
    const { result, electron } = setup({
      files: [file('/w/a.md')],
      dialog: makeDialog({ prompts: ['地图'] }),
      handler: (channel, ...args) =>
        channel === 'create-directory'
          ? { success: true, dirPath: `${String(args[0])}/${String(args[1])}` }
          : undefined,
    });
    await act(() => result.current.handleCreateMaterialDirectory());
    expect(electron?.invoke).toHaveBeenNthCalledWith(1, 'create-directory', '/w', '资料');
    expect(electron?.invoke).toHaveBeenNthCalledWith(2, 'create-directory', '/w/资料', '地图');
  });

  it('输入为空不创建；创建失败提示', async () => {
    const a = setup({ dialog: makeDialog({ prompts: ['  '] }) });
    await act(() => a.result.current.handleCreateMaterialDirectory());
    expect(a.electron?.invoke).not.toHaveBeenCalled();

    const b = setup({
      dialog: makeDialog({ prompts: ['x'] }),
      handler: () => {
        throw new Error('perm');
      },
    });
    await act(() => b.result.current.handleCreateMaterialDirectory());
    expect(b.toast.error).toHaveBeenCalledWith('新建资料目录失败: perm');
  });

  // BUG: useWorkspaceCreation.ts handleCreateMaterialDirectory 在 try 块之外创建“资料”根目录，
  // 该 IPC 失败时 promise 直接 reject，用户看不到任何错误提示（未处理的异常）。
  it('创建资料根目录失败时应提示错误而不是抛出', async () => {
    const { result, toast } = setup({
      files: [],
      dialog: makeDialog({ prompts: ['x'] }),
      handler: () => {
        throw new Error('perm');
      },
    });
    await act(() => result.current.handleCreateMaterialDirectory());
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('useWorkspaceCreation · 人物与设定', () => {
  const characterRows = [{ id: 7, name: '林', role: '主角', description: '', attributes: '{}' }];

  it('getCurrentNovelId 返回当前作品 id，缺失时为 null', async () => {
    const a = setup({ handler: () => ({ id: 3 }) });
    await expect(a.result.current.getCurrentNovelId()).resolves.toBe(3);
    const b = setup({ handler: () => null });
    await expect(b.result.current.getCurrentNovelId()).resolves.toBeNull();
    const c = setup({ folder: null });
    await expect(c.result.current.getCurrentNovelId()).resolves.toBeNull();
  });

  it('新建人物：写库、刷新列表并打开人物页', async () => {
    const { result, ctx, electron, toast } = setup({
      dialog: makeDialog({ prompts: [' 林 ', ' 主角 ', '主要角色'] }),
      handler: (channel) => {
        if (channel === 'db-novel-get-by-folder') return { id: 1 };
        if (channel === 'db-character-create') return { lastInsertRowid: 7 };
        if (channel === 'db-character-list') return characterRows;
        return undefined;
      },
    });
    await act(() => result.current.handleCreateCharacter());
    const createCall = electron?.invoke.mock.calls.find((c) => c[0] === 'db-character-create');
    expect(createCall?.slice(1, 4)).toEqual([1, '林', '主角']);
    expect(JSON.parse(String(createCall?.[5]))).toMatchObject({ category: 'major' });
    expect(ctx.setWorkspaceCharacters).toHaveBeenCalledWith([
      expect.objectContaining({ id: 7, name: '林' }),
    ]);
    expect(ctx.openFileInTab).toHaveBeenCalledWith(createCharacterWorkspaceTab({ id: 7 }));
    expect(toast.success).toHaveBeenCalledWith('人物创建成功');
  });

  it('新建人物：无有效 id 时打开人物总览', async () => {
    const { result, ctx } = setup({
      dialog: makeDialog({ prompts: ['林', null, null] }),
      handler: (channel) => {
        if (channel === 'db-novel-get-by-folder') return { id: 1 };
        if (channel === 'db-character-list') return [];
        return {};
      },
    });
    await act(() => result.current.handleCreateCharacter());
    expect(ctx.openFileInTab).toHaveBeenCalledWith(WORKSPACE_TAB_CHARACTERS);
  });

  it('新建人物：无作品 / 名称为空时不写库；写库失败提示', async () => {
    const a = setup({ handler: () => null });
    await act(() => a.result.current.handleCreateCharacter());
    expect(a.dialog.prompt).not.toHaveBeenCalled();

    const b = setup({ dialog: makeDialog({ prompts: [''] }), handler: () => ({ id: 1 }) });
    await act(() => b.result.current.handleCreateCharacter());
    expect(b.electron?.invoke).not.toHaveBeenCalledWith(
      'db-character-create',
      ...Array(5).fill(expect.anything())
    );

    const c = setup({
      dialog: makeDialog({ prompts: ['林', '', ''] }),
      handler: (channel) => {
        if (channel === 'db-novel-get-by-folder') return { id: 1 };
        throw new Error('constraint');
      },
    });
    await act(() => c.result.current.handleCreateCharacter());
    expect(c.toast.error).toHaveBeenCalledWith('新建人物失败: constraint');
  });

  const loreRow = (id: number, title: string) => ({
    id,
    category: 'world',
    title,
    content: '',
    tags: '[]',
    created_at: '',
    updated_at: '',
  });

  it('新建设定：写库后打开新条目', async () => {
    const { result, ctx, electron, toast } = setup({
      dialog: makeDialog({ prompts: [' 灵脉 '] }),
      handler: (channel) =>
        channel === 'db-world-setting-list-by-folder' ? [loreRow(5, '灵脉')] : undefined,
    });
    await act(() => result.current.handleCreateLoreEntry());
    expect(electron?.invoke).toHaveBeenCalledWith(
      'db-world-setting-create-by-folder',
      '/w',
      'world',
      '灵脉',
      '',
      '[]'
    );
    expect(ctx.setWorkspaceLoreEntries).toHaveBeenCalledWith([
      expect.objectContaining({ id: 5, title: '灵脉' }),
    ]);
    expect(ctx.openFileInTab).toHaveBeenCalledWith(createLoreWorkspaceTab({ id: 5 }));
    expect(toast.success).toHaveBeenCalledWith('设定创建成功');
  });

  it('新建设定：找不到新条目时打开设定总览；空名称忽略；失败提示', async () => {
    const a = setup({
      dialog: makeDialog({ prompts: ['灵脉'] }),
      handler: (channel) => (channel === 'db-world-setting-list-by-folder' ? [] : undefined),
    });
    await act(() => a.result.current.handleCreateLoreEntry());
    expect(a.ctx.openFileInTab).toHaveBeenCalledWith(WORKSPACE_TAB_LORE);

    const b = setup({ dialog: makeDialog({ prompts: [null] }) });
    await act(() => b.result.current.handleCreateLoreEntry());
    expect(b.electron?.invoke).not.toHaveBeenCalled();

    const c = setup({
      dialog: makeDialog({ prompts: ['x'] }),
      handler: () => {
        throw new Error('db');
      },
    });
    await act(() => c.result.current.handleCreateLoreEntry());
    expect(c.toast.error).toHaveBeenCalledWith('新建设定失败: db');
  });
});

describe('useWorkspaceCreation · 卷章新建', () => {
  it('resolveStoryCreateTargetDir 根据选中项推断目录', () => {
    const volumeTab = setup({ activeTab: createVolumeWorkspaceTab('/w/第一卷') });
    expect(volumeTab.result.current.resolveStoryCreateTargetDir('volume')).toBe('/w');
    expect(volumeTab.result.current.resolveStoryCreateTargetDir('chapter')).toBe('/w/第一卷');
    expect(volumeTab.result.current.resolveStoryCreateTargetDir('draft')).toBe('/w/第一卷');
    volumeTab.unmount();

    const dirSel = setup({ activeTab: '/w/第一卷' });
    expect(dirSel.result.current.resolveStoryCreateTargetDir('chapter')).toBe('/w/第一卷');
    expect(dirSel.result.current.resolveStoryCreateTargetDir('draft-folder')).toBe('/w/第一卷');
    dirSel.unmount();

    const draftDir = setup({ activeTab: '/w/样稿' });
    expect(draftDir.result.current.resolveStoryCreateTargetDir('chapter')).toBe('/w');
    draftDir.unmount();

    const fileSel = setup({ activeTab: '/w/第一卷/第1章.md' });
    expect(fileSel.result.current.resolveStoryCreateTargetDir('chapter')).toBe('/w/第一卷');
    expect(fileSel.result.current.resolveStoryCreateTargetDir('draft')).toBe('/w/第一卷');
    fileSel.unmount();

    const none = setup();
    expect(none.result.current.resolveStoryCreateTargetDir('chapter')).toBe('/w');
    expect(none.result.current.resolveStoryCreateTargetDir('draft')).toBe('/w');
    none.unmount();

    const noFolder = setup({ folder: null });
    expect(noFolder.result.current.resolveStoryCreateTargetDir('chapter')).toBeNull();
  });

  it('suggestStoryCreateName 根据已有节点编号', () => {
    const { result } = setup();
    expect(result.current.suggestStoryCreateName('volume', '/w')).toBe('第2卷');
    expect(result.current.suggestStoryCreateName('chapter', '/w/第一卷')).toBe('第2章 未命名');
    expect(result.current.suggestStoryCreateName('draft-folder', '/w')).toBe('样稿2');
    expect(result.current.suggestStoryCreateName('draft', '/w/第一卷')).toBe('样稿-2');
    expect(result.current.suggestStoryCreateName('draft', '/nope')).toBe('样稿');
    expect(result.current.suggestStoryCreateName('draft-folder', '/nope')).toBe('样稿');
  });

  it('新建卷：创建目录并打开卷页', async () => {
    const { result, ctx, electron, toast, dialog } = setup({
      dialog: makeDialog({ prompts: ['第二卷'] }),
      handler: (channel, ...args) =>
        channel === 'create-directory'
          ? { success: true, dirPath: `${String(args[0])}/${String(args[1])}` }
          : undefined,
    });
    await act(() => result.current.handleCreateStoryItem('volume'));
    expect(dialog.prompt).toHaveBeenCalledWith('新建卷', '请输入名称', '第2卷');
    expect(electron?.invoke).toHaveBeenCalledWith('create-directory', '/w', '第二卷');
    expect(ctx.openFileInTab).toHaveBeenCalledWith(createVolumeWorkspaceTab('/w/第二卷'));
    expect(toast.success).toHaveBeenCalledWith('新建卷成功');
  });

  it('新建稿夹不打开标签；新建章节创建文件并打开', async () => {
    const handler: InvokeHandler = (channel, ...args) =>
      channel === 'create-file'
        ? { success: true, filePath: `${String(args[0])}/${String(args[1])}` }
        : { success: true, dirPath: `${String(args[0])}/${String(args[1])}` };
    const a = setup({ dialog: makeDialog({ prompts: ['稿'] }), handler });
    await act(() => a.result.current.handleCreateStoryItem('draft-folder'));
    expect(a.ctx.openFileInTab).not.toHaveBeenCalled();
    expect(a.toast.success).toHaveBeenCalledWith('新建稿夹成功');

    const b = setup({ dialog: makeDialog({ prompts: ['第3章'] }), handler });
    await act(() => b.result.current.handleCreateStoryItem('chapter'));
    expect(b.electron?.invoke).toHaveBeenCalledWith('create-file', '/w', '第3章.md');
    expect(b.ctx.openFileInTab).toHaveBeenCalledWith('/w/第3章.md');
  });

  it('新建章节：空名称忽略；失败提示；无工作区忽略', async () => {
    const a = setup({ dialog: makeDialog({ prompts: [''] }) });
    await act(() => a.result.current.handleCreateStoryItem('chapter'));
    expect(a.electron?.invoke).not.toHaveBeenCalled();

    const b = setup({
      dialog: makeDialog({ prompts: ['x'] }),
      handler: () => {
        throw new Error('dup');
      },
    });
    await act(() => b.result.current.handleCreateStoryItem('draft'));
    expect(b.toast.error).toHaveBeenCalledWith('新建稿失败: dup');

    const c = setup({ folder: null });
    await act(() => c.result.current.handleCreateStoryItem('chapter'));
    expect(c.dialog.prompt).not.toHaveBeenCalled();
  });
});

describe('useWorkspaceCreation · 导入文稿', () => {
  it('每个预览打开为未命名标签，并汇报失败数', async () => {
    const { result, ctx, toast } = setup({
      handler: () => ({
        previews: [
          { fileName: 'a.md', content: 'A' },
          { fileName: 'b.md', content: 'B' },
        ],
        errors: [{ filePath: '/x.doc', error: 'bad' }],
      }),
    });
    await act(() => result.current.handleImportFile());
    let tabs: string[] = [];
    ctx.setOpenTabs.mock.calls.forEach((c) => {
      tabs = applyUpdater(c[0] as Updater<string[]>, tabs);
    });
    expect(tabs).toEqual(['__untitled__:a.md', '__untitled__:b.md']);
    let contents: Record<string, string> = {};
    ctx.setUntitledTabContents.mock.calls.forEach((c) => {
      contents = applyUpdater(c[0] as Updater<Record<string, string>>, contents);
    });
    expect(contents).toEqual({ '__untitled__:a.md': 'A', '__untitled__:b.md': 'B' });
    expect(ctx.setActiveTab).toHaveBeenLastCalledWith('__untitled__:b.md');
    expect(ctx.setEditorContent).toHaveBeenLastCalledWith('B');
    expect(ctx.untitledCounterRef.current).toBe(2);
    expect(toast.success).toHaveBeenCalledWith('文件已转换，可自行编辑后保存');
    expect(toast.error).toHaveBeenCalledWith('1 个文件转换失败');
  });

  it('用户取消 / 全部失败 / IPC 异常', async () => {
    const a = setup({ handler: () => null });
    await act(() => a.result.current.handleImportFile());
    expect(a.ctx.setOpenTabs).not.toHaveBeenCalled();

    const b = setup({ handler: () => ({ previews: [], errors: [{ filePath: 'x', error: 'e' }] }) });
    await act(() => b.result.current.handleImportFile());
    expect(b.toast.success).not.toHaveBeenCalled();
    expect(b.toast.error).toHaveBeenCalledWith('1 个文件转换失败');

    const c = setup({
      handler: () => {
        throw new Error('parse');
      },
    });
    await act(() => c.result.current.handleImportFile());
    expect(c.toast.error).toHaveBeenCalledWith('导入失败: parse');
  });

  // BUG: useWorkspaceCreation.ts handleImportFile 用 `__untitled__:${fileName}` 作为标签路径，
  // 递增了 untitledCounterRef 却没有用到。导入同名文件（或再次导入同一文件）会产生重复标签路径，
  // 后一个预览的内容覆盖前一个，且 openTabs 中出现重复项。
  it('导入同名文件应生成互不冲突的标签', async () => {
    const { result, ctx } = setup({
      handler: () => ({
        previews: [
          { fileName: 'a.md', content: 'A1' },
          { fileName: 'a.md', content: 'A2' },
        ],
        errors: [],
      }),
    });
    await act(() => result.current.handleImportFile());
    let tabs: string[] = [];
    ctx.setOpenTabs.mock.calls.forEach((c) => {
      tabs = applyUpdater(c[0] as Updater<string[]>, tabs);
    });
    expect(new Set(tabs).size).toBe(2);
  });
});
