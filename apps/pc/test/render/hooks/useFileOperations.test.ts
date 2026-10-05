// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFileOperations, type UseFileOperationsContext } from '@/render/hooks/useFileOperations';
import type { FileNode } from '@/render/types';
import type { StoryOrderMap } from '@/render/utils/workspace';
import { CHAPTER_MATERIALS_STORAGE_PREFIX } from '@/render/app/types';
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
    dir('/w/正文', [file('/w/正文/第1章.md'), file('/w/正文/第2章.md'), file('/w/正文/第3章.md')]),
    dir('/w/第一卷', [file('/w/第一卷/第1章.md')]),
    dir('/w/资料', [file('/w/资料/a.txt')]),
  ];
}

type Updater<T> = T | ((prev: T) => T);
function applyUpdater<T>(updater: Updater<T>, prev: T): T {
  return typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater;
}

function setup(
  options: {
    handler?: InvokeHandler;
    dialog?: DialogSpy;
    files?: FileNode[];
    folder?: string | null;
    activeTab?: string | null;
    clipboard?: string[];
    storyOrderMap?: StoryOrderMap;
    materialNodes?: FileNode[];
    readText?: string;
    persistError?: Error;
    noIpc?: boolean;
  } = {}
) {
  if (options.noIpc) uninstallElectronMock();
  const electron = options.noIpc ? null : installElectronMock(options.handler);
  const toast = makeToast();
  const dialog = options.dialog ?? makeDialog();
  const storyOrderMapRef = ref<StoryOrderMap>(options.storyOrderMap ?? {});
  const activeTabRef = ref<string | null>(options.activeTab ?? null);
  const ctx = {
    activeTabRef,
    clipboard: options.clipboard ?? [],
    closeTab: vi.fn(),
    closeTabsByPredicate: vi.fn(),
    dialog,
    filesRef: ref<FileNode[]>(options.files ?? defaultTree()),
    folderPathRef: ref<string | null>(options.folder === undefined ? FOLDER : options.folder),
    moveViewportSnapshot: vi.fn(),
    openFileInTab: vi.fn(),
    persistStoryOrderMap: vi.fn(async () => {
      if (options.persistError) throw options.persistError;
    }),
    readStoryDocumentText: vi.fn(async () => options.readText ?? ''),
    refreshCurrentFolder: vi.fn(async () => undefined),
    remapPathReferences: vi.fn(),
    removeViewportSnapshots: vi.fn(),
    setActiveTab: vi.fn(),
    setChapterMaterialPaths: vi.fn(),
    setClipboard: vi.fn(),
    setOpenTabs: vi.fn(),
    setStoryOrderMap: vi.fn(),
    setUntitledTabContents: vi.fn(),
    storyOrderMapRef,
    toast,
    workspaceMaterialNodes: options.materialNodes ?? [],
  };
  const { result } = renderHook(() =>
    useFileOperations(ctx as unknown as UseFileOperationsContext)
  );
  return { result, ctx, toast, dialog, electron, storyOrderMapRef, activeTabRef };
}

afterEach(() => {
  uninstallElectronMock();
});

describe('useFileOperations · 删除', () => {
  it('确认后删除文件、关闭标签、刷新并提示', async () => {
    const { result, ctx, toast, electron } = setup();
    await act(() => result.current.handleDeleteFile('/w/正文/第1章.md'));
    expect(electron?.invoke).toHaveBeenCalledWith('delete-file', '/w/正文/第1章.md');
    expect(ctx.closeTab).toHaveBeenCalledWith('/w/正文/第1章.md');
    const predicate = ctx.removeViewportSnapshots.mock.calls[0][0] as (p: string) => boolean;
    expect(predicate('/w/正文/第1章.md')).toBe(true);
    expect(predicate('/w/x.md')).toBe(false);
    expect(ctx.refreshCurrentFolder).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('已删除 "第1章.md"');
  });

  it('取消确认时不删除', async () => {
    const { result, electron } = setup({ dialog: makeDialog({ confirm: false }) });
    await act(() => result.current.handleDeleteFile('/w/a.md'));
    expect(electron?.invoke).not.toHaveBeenCalled();
  });

  it('IPC 失败时 toast.error', async () => {
    const { result, toast, ctx } = setup({
      handler: () => {
        throw new Error('EACCES');
      },
    });
    await act(() => result.current.handleDeleteFile('/w/a.md'));
    expect(toast.error).toHaveBeenCalledWith('删除文件失败: EACCES');
    expect(ctx.closeTab).not.toHaveBeenCalled();
  });

  it('无 IPC 时直接返回', async () => {
    const { result, dialog } = setup({ noIpc: true });
    await act(() => result.current.handleDeleteFile('/w/a.md'));
    await act(() => result.current.handleDeleteDirectory('/w/x'));
    await act(() => result.current.handlePasteFiles('/w'));
    await act(() => result.current.handleDropFiles(['/a']));
    expect(dialog.confirm).not.toHaveBeenCalled();
  });

  it('删除目录：关闭目录下标签并在当前标签被删除时清空激活', async () => {
    const { result, ctx, toast, electron } = setup({ activeTab: '/w/正文/第1章.md' });
    await act(() => result.current.handleDeleteDirectory('/w/正文'));
    expect(electron?.invoke).toHaveBeenCalledWith('delete-directory', '/w/正文');
    const next = applyUpdater(ctx.setOpenTabs.mock.calls[0][0] as Updater<string[]>, [
      '/w/正文/第1章.md',
      '/w/资料/a.txt',
    ]);
    expect(next).toEqual(['/w/资料/a.txt']);
    expect(ctx.setActiveTab).toHaveBeenCalledWith(null);
    expect(toast.success).toHaveBeenCalledWith('已删除文件夹 "正文"');
  });

  it('删除目录：激活标签不在目录下时不清空', async () => {
    const { result, ctx } = setup({ activeTab: '/w/资料/a.txt' });
    await act(() => result.current.handleDeleteDirectory('/w/正文'));
    expect(ctx.setActiveTab).not.toHaveBeenCalled();
  });

  // BUG: useFileOperations.ts handleDeleteDirectory 使用 `t.startsWith(dirPath)` 判断子路径，
  // 未带路径分隔符，删除 "/w/正文" 时会误关闭兄弟目录 "/w/正文2" 下的标签（视口快照同理）。
  it('删除目录不应误关闭同前缀兄弟目录的标签', async () => {
    const { result, ctx } = setup();
    await act(() => result.current.handleDeleteDirectory('/w/正文'));
    const next = applyUpdater(ctx.setOpenTabs.mock.calls[0][0] as Updater<string[]>, [
      '/w/正文2/x.md',
    ]);
    expect(next).toEqual(['/w/正文2/x.md']);
  });

  it('删除目录失败 / 取消', async () => {
    const failing = setup({
      handler: () => {
        throw new Error('busy');
      },
    });
    await act(() => failing.result.current.handleDeleteDirectory('/w/正文'));
    expect(failing.toast.error).toHaveBeenCalledWith('删除目录失败: busy');

    const cancelled = setup({ dialog: makeDialog({ confirm: false }) });
    await act(() => cancelled.result.current.handleDeleteDirectory('/w/正文'));
    expect(cancelled.electron?.invoke).not.toHaveBeenCalled();
  });

  it('删除卷：合成的“未分卷”不可删除，真实卷走目录删除', async () => {
    const { result, toast, electron } = setup();
    await act(() => result.current.handleDeleteVolumeNode('/w', true));
    expect(toast.info).toHaveBeenCalledWith('未分卷用于承接未归档正文，不能直接删除');
    expect(electron?.invoke).not.toHaveBeenCalled();
    await act(() => result.current.handleDeleteVolumeNode('/w/第一卷'));
    expect(electron?.invoke).toHaveBeenCalledWith('delete-directory', '/w/第一卷');
  });
});

describe('useFileOperations · 重命名', () => {
  it('正文文件保留原扩展名并重映射顺序', async () => {
    const { result, ctx, toast, electron, storyOrderMapRef } = setup({
      dialog: makeDialog({ prompts: ['  新章.txt  '] }),
      storyOrderMap: { '/w/正文': ['/w/正文/第1章.md', '/w/正文/第2章.md'] },
    });
    await act(() => result.current.handleRename('/w/正文/第1章.md'));
    expect(ctx.dialog.prompt).toHaveBeenCalledWith('重命名', '请输入新名称', '第1章');
    expect(electron?.invoke).toHaveBeenCalledWith(
      'rename-file',
      '/w/正文/第1章.md',
      '/w/正文/新章.md'
    );
    expect(storyOrderMapRef.current['/w/正文']).toEqual(['/w/正文/新章.md', '/w/正文/第2章.md']);
    expect(ctx.persistStoryOrderMap).toHaveBeenCalledWith(storyOrderMapRef.current);
    expect(ctx.remapPathReferences).toHaveBeenCalledWith('/w/正文/第1章.md', '/w/正文/新章.md');
    expect(toast.success).toHaveBeenCalledWith('已重命名为 "新章"');
  });

  it('资料文件使用完整文件名', async () => {
    const { result, ctx, electron, toast } = setup({ dialog: makeDialog({ prompts: ['b.pdf'] }) });
    await act(() => result.current.handleRename('/w/资料/a.txt'));
    expect(ctx.dialog.prompt).toHaveBeenCalledWith('重命名', '请输入新名称', 'a.txt');
    expect(electron?.invoke).toHaveBeenCalledWith('rename-file', '/w/资料/a.txt', '/w/资料/b.pdf');
    expect(toast.success).toHaveBeenCalledWith('已重命名为 "b.pdf"');
  });

  it('输入为空 / 未变化时不调用 IPC', async () => {
    const empty = setup({ dialog: makeDialog({ prompts: ['   '] }) });
    await act(() => empty.result.current.handleRename('/w/正文/第1章.md'));
    expect(empty.electron?.invoke).not.toHaveBeenCalled();

    const same = setup({ dialog: makeDialog({ prompts: ['第1章'] }) });
    await act(() => same.result.current.handleRename('/w/正文/第1章.md'));
    expect(same.electron?.invoke).not.toHaveBeenCalled();
  });

  it('无法解析父目录时报错', async () => {
    const { result, toast, electron } = setup({ dialog: makeDialog({ prompts: ['b.txt'] }) });
    await act(() => result.current.handleRename('a.txt'));
    expect(toast.error).toHaveBeenCalledWith('重命名失败: 无法解析父目录');
    expect(electron?.invoke).not.toHaveBeenCalled();
  });

  it('IPC 失败时提示且不更新顺序', async () => {
    const { result, toast, ctx } = setup({
      dialog: makeDialog({ prompts: ['x'] }),
      handler: () => {
        throw new Error('exists');
      },
    });
    await act(() => result.current.handleRename('/w/正文/第1章.md'));
    expect(toast.error).toHaveBeenCalledWith('重命名失败: exists');
    expect(ctx.setStoryOrderMap).not.toHaveBeenCalled();
  });
});

describe('useFileOperations · 正文排序/移动', () => {
  it('同目录内重排并持久化', async () => {
    const { result, ctx, storyOrderMapRef, electron } = setup();
    await act(() =>
      result.current.handleReorderStoryNode('/w/正文/第1章.md', '/w/正文/第3章.md', 'after')
    );
    expect(storyOrderMapRef.current['/w/正文']).toEqual([
      '/w/正文/第2章.md',
      '/w/正文/第3章.md',
      '/w/正文/第1章.md',
    ]);
    expect(ctx.persistStoryOrderMap).toHaveBeenCalled();
    expect(electron?.invoke).not.toHaveBeenCalled();
  });

  it('同目录 inside 放到末尾；顺序未变时不持久化', async () => {
    const { result, ctx } = setup();
    await act(() =>
      result.current.handleReorderStoryNode('/w/正文/第3章.md', '/w/正文/第2章.md', 'after')
    );
    expect(ctx.persistStoryOrderMap).not.toHaveBeenCalled();
  });

  it('持久化失败时回滚顺序并提示', async () => {
    const original: StoryOrderMap = { '/w/正文': ['/w/正文/第1章.md'] };
    const { result, ctx, toast, storyOrderMapRef } = setup({
      storyOrderMap: original,
      persistError: new Error('disk full'),
    });
    await act(() =>
      result.current.handleReorderStoryNode('/w/正文/第1章.md', '/w/正文/第2章.md', 'after')
    );
    expect(storyOrderMapRef.current).toBe(original);
    expect(ctx.setStoryOrderMap).toHaveBeenLastCalledWith(original);
    expect(toast.error).toHaveBeenCalledWith('调整顺序失败: disk full');
  });

  it('跨目录 inside 移动时自动避免重名', async () => {
    const { result, ctx, electron, storyOrderMapRef } = setup();
    await act(() =>
      result.current.handleReorderStoryNode('/w/正文/第1章.md', '/w/第一卷', 'inside')
    );
    expect(electron?.invoke).toHaveBeenCalledWith(
      'rename-file',
      '/w/正文/第1章.md',
      '/w/第一卷/第1章-2.md'
    );
    expect(storyOrderMapRef.current['/w/第一卷']).toEqual([
      '/w/第一卷/第1章.md',
      '/w/第一卷/第1章-2.md',
    ]);
    expect(storyOrderMapRef.current['/w/正文']).not.toContain('/w/正文/第1章.md');
    expect(ctx.remapPathReferences).toHaveBeenCalledWith(
      '/w/正文/第1章.md',
      '/w/第一卷/第1章-2.md'
    );
    expect(ctx.refreshCurrentFolder).toHaveBeenCalled();
  });

  it('跨目录 before 插入到目标之前', async () => {
    const { result, storyOrderMapRef } = setup();
    await act(() =>
      result.current.handleReorderStoryNode('/w/正文/第2章.md', '/w/第一卷/第1章.md', 'before')
    );
    expect(storyOrderMapRef.current['/w/第一卷']).toEqual([
      '/w/第一卷/第2章.md',
      '/w/第一卷/第1章.md',
    ]);
  });

  it('跨目录移动失败时提示', async () => {
    const { result, toast } = setup({
      handler: () => {
        throw new Error('locked');
      },
    });
    await act(() =>
      result.current.handleReorderStoryNode('/w/正文/第2章.md', '/w/第一卷/第1章.md', 'after')
    );
    expect(toast.error).toHaveBeenCalledWith('移动正文失败: locked');
  });

  it('无效输入直接忽略：同路径、未知源、拖入自身子孙、无工作区', async () => {
    const { result, ctx, electron } = setup();
    await act(() => result.current.handleReorderStoryNode('/w/正文', '/w/正文', 'inside'));
    await act(() => result.current.handleReorderStoryNode('/w/nope.md', '/w/正文', 'inside'));
    await act(() => result.current.handleReorderStoryNode('/w/正文', '/w/正文/第1章.md', 'before'));
    await act(() =>
      result.current.handleReorderStoryNode('/w/正文/第1章.md', '/w/unknown.md', 'before')
    );
    expect(electron?.invoke).not.toHaveBeenCalled();
    expect(ctx.persistStoryOrderMap).not.toHaveBeenCalled();

    const noFolder = setup({ folder: null });
    await act(() =>
      noFolder.result.current.handleReorderStoryNode('/w/正文/第1章.md', '/w/第一卷', 'inside')
    );
    expect(noFolder.electron?.invoke).not.toHaveBeenCalled();
  });
});

describe('useFileOperations · 复制粘贴 / 拖放', () => {
  it('复制写入应用内剪贴板', () => {
    const { result, ctx } = setup();
    act(() => result.current.handleCopyFile('/w/a.md'));
    expect(ctx.setClipboard).toHaveBeenCalledWith(['/w/a.md']);
  });

  it('粘贴优先使用应用内剪贴板', async () => {
    const { result, electron, toast } = setup({ clipboard: ['/x/a.md'] });
    await act(() => result.current.handlePasteFiles('/w/正文'));
    expect(electron?.invoke).toHaveBeenCalledTimes(1);
    expect(electron?.invoke).toHaveBeenCalledWith('paste-files', ['/x/a.md'], '/w/正文');
    expect(toast.success).toHaveBeenCalledWith('已粘贴');
  });

  it('应用内剪贴板为空时回退系统剪贴板；系统剪贴板也为空则不粘贴', async () => {
    const withSystem = setup({
      handler: (channel) => (channel === 'read-clipboard-file-paths' ? ['/sys/b.md'] : undefined),
    });
    await act(() => withSystem.result.current.handlePasteFiles('/w'));
    expect(withSystem.electron?.invoke).toHaveBeenCalledWith('paste-files', ['/sys/b.md'], '/w');

    const empty = setup({
      handler: (channel) => (channel === 'read-clipboard-file-paths' ? [] : undefined),
    });
    await act(() => empty.result.current.handlePasteFiles('/w'));
    expect(empty.electron?.invoke).toHaveBeenCalledTimes(1);
    expect(empty.toast.success).not.toHaveBeenCalled();
  });

  it('粘贴失败时提示', async () => {
    const { result, toast } = setup({
      clipboard: ['/a'],
      handler: () => {
        throw new Error('nope');
      },
    });
    await act(() => result.current.handlePasteFiles('/w'));
    expect(toast.error).toHaveBeenCalledWith('粘贴失败: nope');
  });

  it('拖放导入到工作区根目录', async () => {
    const { result, electron, toast } = setup();
    await act(() => result.current.handleDropFiles(['/d/a.md', '/d/b.md']));
    expect(electron?.invoke).toHaveBeenCalledWith('paste-files', ['/d/a.md', '/d/b.md'], '/w');
    expect(toast.success).toHaveBeenCalledWith('已导入 2 个文件');
  });

  it('拖放：空列表忽略，无工作区提示，失败提示', async () => {
    const a = setup();
    await act(() => a.result.current.handleDropFiles([]));
    expect(a.electron?.invoke).not.toHaveBeenCalled();

    const b = setup({ folder: null });
    await act(() => b.result.current.handleDropFiles(['/a']));
    expect(b.toast.error).toHaveBeenCalledWith('请先打开一个文件夹');

    const c = setup({
      handler: () => {
        throw 'x';
      },
    });
    await act(() => c.result.current.handleDropFiles(['/a']));
    expect(c.toast.error).toHaveBeenCalledWith('导入失败: 未知错误');
  });
});

describe('useFileOperations · 保存未命名', () => {
  it('写入磁盘并替换标签、迁移内容与视口', async () => {
    const { result, ctx, electron, toast } = setup({
      dialog: makeDialog({ prompts: ['新文.md'] }),
      activeTab: '__untitled__:1',
    });
    await act(() => result.current.handleSaveUntitled('__untitled__:1', 'hello'));
    expect(electron?.invoke).toHaveBeenCalledWith('write-file', '/w/新文.md', 'hello');
    expect(
      applyUpdater(ctx.setOpenTabs.mock.calls[0][0] as Updater<string[]>, ['__untitled__:1', '/b'])
    ).toEqual(['/w/新文.md', '/b']);
    const contentsUpdater = ctx.setUntitledTabContents.mock.calls[0][0] as Updater<
      Record<string, string>
    >;
    expect(applyUpdater(contentsUpdater, { '__untitled__:1': 'hello', other: 'x' })).toEqual({
      other: 'x',
    });
    const untouched = { other: 'x' };
    expect(applyUpdater(contentsUpdater, untouched)).toBe(untouched);
    expect(ctx.moveViewportSnapshot).toHaveBeenCalledWith('__untitled__:1', '/w/新文.md');
    expect(ctx.setActiveTab).toHaveBeenCalledWith('/w/新文.md');
    expect(toast.success).toHaveBeenCalledWith('文件 "新文.md" 已保存');
  });

  it('非激活标签不切换；取消输入不写盘；无工作区提示；失败提示', async () => {
    const a = setup({ dialog: makeDialog({ prompts: ['x.md'] }), activeTab: '/other' });
    await act(() => a.result.current.handleSaveUntitled('__untitled__:1', ''));
    expect(a.ctx.setActiveTab).not.toHaveBeenCalled();

    const b = setup({ dialog: makeDialog({ prompts: [null] }) });
    await act(() => b.result.current.handleSaveUntitled('__untitled__:1', ''));
    expect(b.electron?.invoke).not.toHaveBeenCalled();

    const c = setup({ folder: null });
    await act(() => c.result.current.handleSaveUntitled('__untitled__:1', ''));
    expect(c.toast.error).toHaveBeenCalledWith('请先打开一个文件夹');

    const d = setup({
      dialog: makeDialog({ prompts: ['x.md'] }),
      handler: () => {
        throw new Error('ro');
      },
    });
    await act(() => d.result.current.handleSaveUntitled('__untitled__:1', ''));
    expect(d.toast.error).toHaveBeenCalledWith('保存失败: ro');
  });
});

describe('useFileOperations · 清空资料', () => {
  const materials = [dir('/w/资料', [file('/w/资料/a.txt')]), file('/w/notes.pdf')];

  it('删除所有资料节点与工作区内的章节资料设置', async () => {
    const { result, ctx, electron, toast } = setup({
      materialNodes: materials,
      handler: (channel) =>
        channel === 'db-settings-all'
          ? [
              { key: `${CHAPTER_MATERIALS_STORAGE_PREFIX}/w/正文/第1章.md`, value: '[]' },
              { key: `${CHAPTER_MATERIALS_STORAGE_PREFIX}/other/x.md`, value: '[]' },
              { key: 'unrelated', value: '1' },
            ]
          : undefined,
    });
    await act(() => result.current.handleClearMaterials());
    expect(electron?.invoke).toHaveBeenCalledWith('delete-directory', '/w/资料');
    expect(electron?.invoke).toHaveBeenCalledWith('delete-file', '/w/notes.pdf');
    expect(electron?.invoke).toHaveBeenCalledWith('db-settings-delete-prefixes', [
      `${CHAPTER_MATERIALS_STORAGE_PREFIX}/w/正文/第1章.md`,
    ]);
    expect(ctx.setChapterMaterialPaths).toHaveBeenCalledWith([]);
    const predicate = ctx.closeTabsByPredicate.mock.calls[0][0] as (tab: string) => boolean;
    expect(predicate('/w/资料/a.txt')).toBe(true);
    expect(predicate('/w/notes.pdf')).toBe(true);
    expect(predicate('/w/资料2/a.txt')).toBe(false);
    expect(toast.success).toHaveBeenCalledWith('资料已清空');
  });

  it('没有匹配设置时不调用删除前缀', async () => {
    const { result, electron } = setup({
      materialNodes: materials,
      handler: (channel) => (channel === 'db-settings-all' ? [] : undefined),
    });
    await act(() => result.current.handleClearMaterials());
    expect(electron?.invoke).not.toHaveBeenCalledWith(
      'db-settings-delete-prefixes',
      expect.anything()
    );
  });

  it('无资料提示；取消不删除；失败提示', async () => {
    const a = setup();
    await act(() => a.result.current.handleClearMaterials());
    expect(a.toast.info).toHaveBeenCalledWith('当前作品没有可清空的资料');

    const b = setup({ materialNodes: materials, dialog: makeDialog({ confirm: false }) });
    await act(() => b.result.current.handleClearMaterials());
    expect(b.electron?.invoke).not.toHaveBeenCalled();

    const c = setup({
      materialNodes: materials,
      handler: () => {
        throw new Error('perm');
      },
    });
    await act(() => c.result.current.handleClearMaterials());
    expect(c.toast.error).toHaveBeenCalledWith('清空资料失败: perm');
  });
});

describe('useFileOperations · 按章节拆分', () => {
  const text = '第一章 开端\n内容A\n\n第二章 发展\n内容B';

  it('识别章节后逐个创建文件并打开第一个', async () => {
    const { result, ctx, electron, toast, dialog } = setup({
      readText: text,
      files: [dir('/w/正文', [file('/w/正文/全本.md'), file('/w/正文/第一章 开端.md')])],
      handler: (channel, ...args) =>
        channel === 'create-file'
          ? { success: true, filePath: `${String(args[0])}/${String(args[1])}` }
          : undefined,
    });
    await act(() => result.current.handleSplitStoryFile('/w/正文/全本.md'));
    expect(dialog.confirm.mock.calls[0][1]).toContain('识别到 2 个章节');
    expect(electron?.invoke).toHaveBeenCalledWith('create-file', '/w/正文', '第一章 开端-2.md');
    expect(electron?.invoke).toHaveBeenCalledWith(
      'write-file',
      '/w/正文/第二章 发展.md',
      '# 第二章 发展\n内容B'
    );
    expect(ctx.openFileInTab).toHaveBeenCalledWith('/w/正文/第一章 开端-2.md');
    expect(toast.success).toHaveBeenCalledWith('已拆分生成 2 个章节文件');
  });

  it('超过 8 章时预览带省略号', async () => {
    const many = Array.from({ length: 9 }, (_, i) => `第${i + 1}章\n正文${i}`).join('\n');
    const { result, dialog } = setup({ readText: many, dialog: makeDialog({ confirm: false }) });
    await act(() => result.current.handleSplitStoryFile('/w/正文/全本.md'));
    expect(dialog.confirm.mock.calls[0][1]).toMatch(/…$/);
  });

  it('不足两章时警告；非正文文件忽略；读取失败提示', async () => {
    const a = setup({ readText: '只有一段文字' });
    await act(() => a.result.current.handleSplitStoryFile('/w/正文/全本.md'));
    expect(a.toast.warning).toHaveBeenCalledWith('当前文件未识别出可拆分的多个章节');

    const b = setup({ readText: text });
    await act(() => b.result.current.handleSplitStoryFile('/w/资料/a.pdf'));
    expect(b.ctx.readStoryDocumentText).not.toHaveBeenCalled();

    const c = setup();
    c.ctx.readStoryDocumentText.mockRejectedValueOnce(new Error('ENOENT'));
    await act(() => c.result.current.handleSplitStoryFile('/w/正文/全本.md'));
    expect(c.toast.error).toHaveBeenCalledWith('按章节拆分失败: ENOENT');
  });
});
