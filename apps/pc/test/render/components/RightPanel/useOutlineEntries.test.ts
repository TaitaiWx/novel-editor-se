// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type {
  PersistedOutlineNodeInput,
  PersistedOutlineRow,
  PersistedOutlineScopeInput,
} from '@/render/types/electron-api';
import { installElectronMock, uninstallElectronMock } from '../../hooks/electronMock';

const buildMocks = vi.hoisted(() => ({
  imports: vi.fn<(...args: unknown[]) => Promise<PersistedOutlineNodeInput[]>>(),
  content: vi.fn<(...args: unknown[]) => Promise<PersistedOutlineNodeInput[]>>(),
  ai: vi.fn<(...args: unknown[]) => Promise<PersistedOutlineNodeInput[]>>(),
}));

vi.mock('@/render/components/RightPanel/outline-import', async (importActual) => {
  const actual =
    await importActual<typeof import('@/render/components/RightPanel/outline-import')>();
  return {
    ...actual,
    buildOutlineTreeFromImports: buildMocks.imports,
    buildOutlineTreeFromContent: buildMocks.content,
    buildOutlineTreeFromAi: buildMocks.ai,
  };
});

import { useOutlineEntries } from '@/render/components/RightPanel/useOutlineEntries';

const FOLDER = '/novel';
const CONTENT = '# 第一章 雪夜\n正文一\n\n# 第二章 追杀\n正文二';

function row(overrides: Partial<PersistedOutlineRow> & { id: number }): PersistedOutlineRow {
  return {
    novel_id: 1,
    scope_kind: 'project',
    scope_path: '',
    title: `节点${overrides.id}`,
    content: '',
    anchor_text: '',
    line_hint: null,
    parent_id: null,
    sort_order: 0,
    created_at: '',
    updated_at: '',
    ...overrides,
  } as PersistedOutlineRow;
}

const TREE: PersistedOutlineNodeInput[] = [
  { title: 'A', content: '', children: [], sortOrder: 0 } as PersistedOutlineNodeInput,
  { title: 'B', content: '', children: [], sortOrder: 1 } as PersistedOutlineNodeInput,
];

type Handler = (...args: unknown[]) => unknown;

function setup(routes: Record<string, Handler> = {}) {
  let rows: PersistedOutlineRow[] = [];
  const table: Record<string, Handler> = {
    'db-outline-list-by-folder': () => rows,
    'db-outline-version-list-by-folder': () => [],
    ...routes,
  };
  const mock = installElectronMock((channel, ...args) => table[channel]?.(...args));
  const calls = (channel: string) =>
    mock.invoke.mock.calls.filter((call) => call[0] === channel).map((call) => call.slice(1));
  return {
    mock,
    calls,
    setRows: (next: PersistedOutlineRow[]) => {
      rows = next;
    },
  };
}

async function renderReady(
  opts: {
    folder?: string | null;
    content?: string;
    db?: boolean;
    ai?: boolean;
    scope?: PersistedOutlineScopeInput | null;
  } = {}
) {
  const hook = renderHook(() =>
    useOutlineEntries(
      opts.folder === undefined ? FOLDER : opts.folder,
      opts.content ?? CONTENT,
      opts.db ?? true,
      opts.ai ?? true,
      opts.scope
    )
  );
  await act(async () => {});
  return hook;
}

beforeEach(() => {
  buildMocks.imports.mockReset();
  buildMocks.content.mockReset();
  buildMocks.ai.mockReset();
});

afterEach(() => {
  uninstallElectronMock();
  vi.useRealTimers();
});

describe('useOutlineEntries: 加载与解析', () => {
  it('从正文实时解析目录', async () => {
    setup();
    const { result } = await renderReady();
    expect(result.current.liveEntries.map((e) => e.text)).toEqual(['第一章 雪夜', '第二章 追杀']);
    expect(result.current.liveEntries.every((e) => e.source === 'document')).toBe(true);
    expect(result.current.hasPersistedOutline).toBe(false);
  });

  it('正文变化经过 300ms 防抖后才重新解析', async () => {
    setup();
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ content }) => useOutlineEntries(null, content, false, false),
      { initialProps: { content: '# 一' } }
    );
    rerender({ content: '# 一\n# 二' });
    expect(result.current.liveEntries).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.liveEntries).toHaveLength(2);
  });

  it('数据库未就绪时不加载', async () => {
    const { calls } = setup();
    const { result } = await renderReady({ db: false });
    expect(calls('db-outline-list-by-folder')).toHaveLength(0);
    expect(result.current.versions).toEqual([]);
  });

  it('将入库行按父子层级与 sort_order 展开，并解析锚点行', async () => {
    const { setRows } = setup({
      'db-outline-version-list-by-folder': () => [{ id: 9 }],
    });
    setRows([
      row({ id: 2, title: '第二章 追杀', sort_order: 1 }),
      row({ id: 1, title: '第一章 雪夜', sort_order: 0, content: '  内容  摘要 ' }),
      row({ id: 3, title: '子节点', parent_id: 1, sort_order: 0, line_hint: 2 }),
      row({ id: 4, title: '', anchor_text: '', parent_id: 1, sort_order: 1, line_hint: 7 }),
      row({ id: 5, title: '文二', parent_id: 2, sort_order: 0, line_hint: 5 }),
      row({ id: 6, title: '不存在', parent_id: 2, sort_order: 1, line_hint: 99 }),
      row({ id: 7, title: '无', parent_id: 2, sort_order: 2, content: 'x'.repeat(200) }),
    ]);
    const { result } = await renderReady();
    const entries = result.current.persistedEntries;
    expect(entries.map((e) => [e.id, e.level])).toEqual([
      [1, 1],
      [3, 2],
      [4, 2],
      [2, 1],
      [5, 2],
      [6, 2],
      [7, 2],
    ]);
    expect(entries[0].lineHint).toBe(1); // 精确锚点命中
    expect(entries[0].summary).toBe('内容 摘要');
    expect(entries[0].wordCount).toBe(4);
    expect(entries[1].lineHint).toBe(2); // 找不到时回退 lineHint
    expect(entries[2].lineHint).toBe(7); // 无锚点直接用 lineHint
    expect(entries[3].lineHint).toBe(4);
    expect(entries[4].lineHint).toBe(5); // lineHint 附近子串匹配 "正文二"
    expect(entries[5].lineHint).toBe(99);
    expect(entries[6].lineHint).toBeNull();
    expect(entries[6].summary.endsWith('...')).toBe(true);
    expect(result.current.hasPersistedOutline).toBe(true);
    expect(result.current.versions).toEqual([{ id: 9 }]);
  });

  it('加载失败时清空并展示错误', async () => {
    setup({
      'db-outline-list-by-folder': () => {
        throw new Error('db err');
      },
      'db-outline-version-list-by-folder': () => {
        throw new Error('v err');
      },
    });
    const { result } = await renderReady();
    expect(result.current.statusMessage).toBe('db err');
    expect(result.current.versions).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('非 Error 抛出时使用默认文案，并透传 scope', async () => {
    const { calls } = setup({
      'db-outline-list-by-folder': () => {
        throw 'x';
      },
    });
    const scope = { kind: 'file', path: 'a.md' } as PersistedOutlineScopeInput;
    const { result } = await renderReady({ scope });
    expect(result.current.statusMessage).toBe('加载大纲失败');
    expect(calls('db-outline-list-by-folder')[0]).toEqual([FOLDER, scope]);
  });
});

describe('useOutlineEntries: 版本', () => {
  it('saveOutlineVersion 默认使用当前入库树', async () => {
    const { setRows, calls } = setup();
    setRows([row({ id: 1, title: 'A' }), row({ id: 2, title: 'A1', parent_id: 1 })]);
    const { result } = await renderReady();
    let ok = false;
    await act(async () => {
      ok = await result.current.saveOutlineVersion({ name: 'v1', source: 'manual' });
    });
    expect(ok).toBe(true);
    const [, payload] = calls('db-outline-version-create-by-folder')[0] as [
      string,
      { name: string; entries: Array<{ title: string; children: Array<{ title: string }> }> },
    ];
    expect(payload.name).toBe('v1');
    expect(payload.entries[0].title).toBe('A');
    expect(payload.entries[0].children[0].title).toBe('A1');
    expect(result.current.statusMessage).toBe('已保存大纲版本：v1');
  });

  it('saveOutlineVersion 前置条件失败返回 false（silent 时不改状态）', async () => {
    setup();
    const noDb = await renderReady({ db: false });
    let ok = true;
    await act(async () => {
      ok = await noDb.result.current.saveOutlineVersion({ name: 'v', source: 'manual' });
    });
    expect(ok).toBe(false);
    expect(noDb.result.current.statusMessage).toContain('无法保存大纲版本');
    const { result } = await renderReady();
    await act(async () => {
      ok = await result.current.saveOutlineVersion({
        name: 'v',
        source: 'manual',
        silentStatus: true,
      });
    });
    expect(ok).toBe(false);
    expect(result.current.statusMessage).toBe('');
    await act(async () => {
      await result.current.saveOutlineVersion({ name: 'v', source: 'manual' });
    });
    expect(result.current.statusMessage).toBe('当前没有可保存的大纲结构');
  });

  it('applyOutlineVersion 成功与失败', async () => {
    let fail = false;
    const { calls } = setup({
      'db-outline-version-apply-by-folder': () => {
        if (fail) throw new Error('apply err');
      },
    });
    const { result } = await renderReady();
    await act(async () => {
      await result.current.applyOutlineVersion(3);
    });
    expect(calls('db-outline-version-apply-by-folder')[0]).toEqual([FOLDER, 3, undefined]);
    expect(result.current.statusMessage).toBe('已将所选版本应用为当前大纲');
    fail = true;
    await act(async () => {
      await result.current.applyOutlineVersion(3);
    });
    expect(result.current.statusMessage).toBe('apply err');
    expect(result.current.importing).toBe(false);
  });

  it('updateOutlineVersion 修剪字段；空字段拒绝；失败返回 false', async () => {
    let fail = false;
    const { calls } = setup({
      'db-outline-version-update': () => {
        if (fail) throw 'x';
      },
    });
    const { result } = await renderReady();
    let ok = true;
    await act(async () => {
      ok = await result.current.updateOutlineVersion(1, { name: '   ' });
    });
    expect(ok).toBe(false);
    expect(result.current.statusMessage).toBe('未检测到可更新的大纲版本信息');
    await act(async () => {
      ok = await result.current.updateOutlineVersion(1, { name: ' 新名 ', note: ' 备注 ' });
    });
    expect(ok).toBe(true);
    expect(calls('db-outline-version-update')[0]).toEqual([1, { name: '新名', note: '备注' }]);
    await act(async () => {
      await result.current.updateOutlineVersion(1, { note: '' });
    });
    expect(calls('db-outline-version-update')[1]).toEqual([1, { note: '' }]);
    fail = true;
    await act(async () => {
      ok = await result.current.updateOutlineVersion(1, { name: 'n' });
    });
    expect(ok).toBe(false);
    expect(result.current.statusMessage).toBe('更新大纲版本信息失败');
  });

  it('deleteOutlineVersion 成功与失败', async () => {
    let fail = false;
    setup({
      'db-outline-version-delete': () => {
        if (fail) throw new Error('del err');
      },
    });
    const { result } = await renderReady();
    await act(async () => {
      await result.current.deleteOutlineVersion(1);
    });
    expect(result.current.statusMessage).toBe('已删除大纲版本');
    fail = true;
    await act(async () => {
      await result.current.deleteOutlineVersion(1);
    });
    expect(result.current.statusMessage).toBe('del err');
  });
});

describe('useOutlineEntries: 导入 / 重建 / AI 生成 / 清空', () => {
  it('前置条件：数据库未就绪', async () => {
    setup();
    const { result } = await renderReady({ db: false });
    await act(async () => {
      await result.current.importOutline();
    });
    expect(result.current.statusMessage).toContain('无法导入大纲');
    await act(async () => {
      await result.current.rebuildFromContent();
    });
    expect(result.current.statusMessage).toContain('无法同步正文目录');
    await act(async () => {
      await result.current.clearPersisted();
    });
    expect(result.current.statusMessage).toContain('无法清空大纲');
    await act(async () => {
      await result.current.applyOutlineVersion(1);
    });
    expect(result.current.statusMessage).toContain('无法应用大纲版本');
    await act(async () => {
      await result.current.generateAiOutline();
    });
    expect(result.current.statusMessage).toContain('无法生成 AI 大纲');
  });

  it('importOutline 成功：写入大纲并保存版本', async () => {
    const { calls } = setup({
      'import-structured-file': () => ({ previews: [{}, {}], errors: ['e'] }),
    });
    buildMocks.imports.mockResolvedValue(TREE);
    const { result } = await renderReady({ ai: false });
    await act(async () => {
      await result.current.importOutline();
    });
    expect(buildMocks.imports).toHaveBeenCalledWith([{}, {}], false);
    expect(calls('db-outline-replace-by-folder')[0]).toEqual([FOLDER, TREE, undefined]);
    const [, version] = calls('db-outline-version-create-by-folder')[0] as [
      string,
      { source: string; note: string },
    ];
    expect(version.source).toBe('import');
    expect(version.note).toBe('导入 2 个文件');
    expect(result.current.statusMessage).toBe(
      '已导入 2 个顶层节点，1 个文件失败，并保存为大纲版本'
    );
  });

  it('importOutline：取消选择 / 解析为空 / 版本保存失败 / 写入失败', async () => {
    let file: unknown = null;
    let failVersion = false;
    let failWrite = false;
    setup({
      'import-structured-file': () => file,
      'db-outline-version-create-by-folder': () => {
        if (failVersion) throw new Error('v');
      },
      'db-outline-replace-by-folder': () => {
        if (failWrite) throw 'w';
      },
    });
    const { result } = await renderReady();
    await act(async () => {
      await result.current.importOutline();
    });
    expect(result.current.statusMessage).toBe('未选择可导入的大纲文件');

    file = { previews: [{}], errors: [] };
    buildMocks.imports.mockResolvedValue([]);
    await act(async () => {
      await result.current.importOutline();
    });
    expect(result.current.statusMessage).toBe('没有解析出可导入的大纲结构');

    buildMocks.imports.mockResolvedValue(TREE);
    failVersion = true;
    await act(async () => {
      await result.current.importOutline();
    });
    expect(result.current.statusMessage).toBe('已导入 2 个顶层节点');

    failWrite = true;
    await act(async () => {
      await result.current.importOutline();
    });
    expect(result.current.statusMessage).toBe('导入大纲失败');
    expect(result.current.importing).toBe(false);
  });

  it('rebuildFromContent 成功 / 空树 / 写入失败', async () => {
    let failWrite = false;
    setup({
      'db-outline-replace-by-folder': () => {
        if (failWrite) throw new Error('write err');
      },
    });
    const { result } = await renderReady();
    buildMocks.content.mockResolvedValue([]);
    await act(async () => {
      await result.current.rebuildFromContent();
    });
    expect(result.current.statusMessage).toContain('没有可重建的大纲结构');

    buildMocks.content.mockResolvedValue(TREE);
    await act(async () => {
      await result.current.rebuildFromContent();
    });
    expect(buildMocks.content).toHaveBeenCalledWith(CONTENT, true);
    expect(result.current.statusMessage).toBe('已从正文重建 2 个目录节点，并保存为大纲版本');

    failWrite = true;
    await act(async () => {
      await result.current.rebuildFromContent();
    });
    expect(result.current.statusMessage).toBe('write err');
  });

  it('rebuildFromContent 版本保存抛错时仍提示成功（不带版本后缀）', async () => {
    setup({
      'db-outline-version-create-by-folder': () => {
        throw new Error('v');
      },
    });
    buildMocks.content.mockResolvedValue(TREE);
    const { result } = await renderReady();
    await act(async () => {
      await result.current.rebuildFromContent();
    });
    expect(result.current.statusMessage).toBe('已从正文重建 2 个目录节点');
  });

  it('generateAiOutline：AI 未开启 / 空树 / 成功含参数摘要 / 失败', async () => {
    setup();
    const off = await renderReady({ ai: false });
    await act(async () => {
      await off.result.current.generateAiOutline();
    });
    expect(off.result.current.statusMessage).toContain('请先配置并开启 AI');

    const { result } = await renderReady();
    buildMocks.ai.mockResolvedValue([]);
    await act(async () => {
      await result.current.generateAiOutline();
    });
    expect(result.current.statusMessage).toContain('AI 未生成可用的大纲结构');

    buildMocks.ai.mockResolvedValue(TREE);
    await act(async () => {
      await result.current.generateAiOutline({
        style: 'cinematic',
        granularity: 'fine',
        maxDepth: 2,
      });
    });
    expect(result.current.statusMessage).toBe(
      '已通过 AI 生成 2 个大纲节点（电影感 / 细 / 2 层），并保存为大纲版本'
    );
    await act(async () => {
      await result.current.generateAiOutline();
    });
    expect(result.current.statusMessage).toContain('默认参数');

    buildMocks.ai.mockRejectedValue('x');
    await act(async () => {
      await result.current.generateAiOutline();
    });
    expect(result.current.statusMessage).toBe('AI 生成大纲失败');
  });

  it('generateAiOutline 版本保存失败时不带版本后缀', async () => {
    setup({
      'db-outline-version-create-by-folder': () => {
        throw new Error('v');
      },
    });
    buildMocks.ai.mockResolvedValue(TREE);
    const { result } = await renderReady();
    await act(async () => {
      await result.current.generateAiOutline();
    });
    expect(result.current.statusMessage).toBe('已通过 AI 生成 2 个大纲节点（默认参数）');
  });

  it('clearPersisted 成功与失败', async () => {
    let fail = false;
    const { setRows } = setup({
      'db-outline-clear-by-folder': () => {
        if (fail) throw new Error('clear err');
      },
    });
    setRows([row({ id: 1 })]);
    const { result } = await renderReady();
    expect(result.current.hasPersistedOutline).toBe(true);
    await act(async () => {
      await result.current.clearPersisted();
    });
    expect(result.current.hasPersistedOutline).toBe(false);
    expect(result.current.statusMessage).toContain('已清空已入库大纲');
    fail = true;
    await act(async () => {
      await result.current.clearPersisted();
    });
    expect(result.current.statusMessage).toBe('clear err');
  });
});

describe('useOutlineEntries: reorderEntries', () => {
  it('乐观更新顶层顺序并持久化', async () => {
    const { setRows, calls } = setup();
    setRows([
      row({ id: 1, title: 'A', sort_order: 0 }),
      row({ id: 2, title: 'B', sort_order: 1 }),
      row({ id: 3, title: 'C', sort_order: 2 }),
      row({ id: 4, title: 'A1', parent_id: 1 }),
    ]);
    const { result } = await renderReady();
    await act(async () => {
      await result.current.reorderEntries(0, 2);
    });
    expect(calls('db-outline-reorder-by-folder')[0]).toEqual([FOLDER, [2, 3, 1]]);
    expect(result.current.persistedEntries.filter((e) => e.level === 1).map((e) => e.text)).toEqual(
      ['B', 'C', 'A']
    );
  });

  it('越界、相同位置或无入库大纲时忽略', async () => {
    const { setRows, calls } = setup();
    const empty = await renderReady();
    await act(async () => {
      await empty.result.current.reorderEntries(0, 1);
    });
    setRows([row({ id: 1 }), row({ id: 2, sort_order: 1 })]);
    const { result } = await renderReady();
    await act(async () => {
      await result.current.reorderEntries(1, 1);
      await result.current.reorderEntries(-1, 0);
      await result.current.reorderEntries(0, 5);
    });
    expect(calls('db-outline-reorder-by-folder')).toHaveLength(0);
  });

  it('持久化失败时重新加载回滚', async () => {
    const { setRows, calls } = setup({
      'db-outline-reorder-by-folder': () => {
        throw new Error('fail');
      },
    });
    setRows([row({ id: 1, title: 'A' }), row({ id: 2, title: 'B', sort_order: 1 })]);
    const { result } = await renderReady();
    const before = calls('db-outline-list-by-folder').length;
    await act(async () => {
      await result.current.reorderEntries(0, 1);
    });
    expect(calls('db-outline-list-by-folder').length).toBe(before + 1);
    expect(result.current.persistedEntries.map((e) => e.text)).toEqual(['A', 'B']);
  });
});
