// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { LoreView } from '@/render/components/RightPanel/LoreView';
import {
  installElectronMock,
  uninstallElectronMock,
  type ElectronMock,
} from '../../hooks/electronMock';
import { chooseOption } from '../../helpers/select';

// 全量单测并发时保存链路（IPC mock → 状态刷新）偶尔超过默认 1 秒，放宽本文件的异步等待上限
configure({ asyncUtilTimeout: 5000 });

interface Row {
  id: number;
  category: string;
  title: string;
  content: string;
  tags: string;
  attributes?: string;
  created_at: string;
  updated_at: string;
}

interface DbOpts {
  rows?: Array<Partial<Row> & { title: string }>;
  ai?: { ok: boolean; text?: string; error?: string } | Error;
  importResult?: unknown;
  legacy?: string | null;
}

/** 内存版 world-setting 表 */
function installDb(opts: DbOpts = {}): { mock: ElectronMock; rows: Row[] } {
  let nextId = 100;
  const rows: Row[] = (opts.rows ?? []).map((r, i) => ({
    id: r.id ?? i + 1,
    category: r.category ?? 'world',
    title: r.title,
    content: r.content ?? '',
    tags: r.tags ?? '[]',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: r.updated_at ?? '2026-01-02T00:00:00Z',
  }));
  const mock = installElectronMock((channel, ...args) => {
    switch (channel) {
      case 'db-world-setting-list-by-folder':
        return rows.map((r) => ({ ...r }));
      case 'db-world-setting-create-by-folder': {
        const [, category, title, content, tags] = args as string[];
        rows.push({
          id: (nextId += 1),
          category,
          title,
          content,
          tags,
          created_at: '',
          updated_at: '2026-01-03T00:00:00Z',
        });
        return true;
      }
      case 'db-world-setting-bulk-create-by-folder': {
        const items = args[1] as Array<{ category: string; title: string; content: string }>;
        items.forEach((item) =>
          rows.push({
            id: (nextId += 1),
            category: item.category,
            title: item.title,
            content: item.content,
            tags: '[]',
            created_at: '',
            updated_at: '',
          })
        );
        return true;
      }
      case 'db-world-setting-update': {
        const [id, patch] = args as [
          number,
          {
            category?: string;
            title?: string;
            content?: string;
            tags?: string;
            attributes?: string;
          },
        ];
        const row = rows.find((r) => r.id === id);
        if (row) {
          if (patch.category) row.category = patch.category;
          if (patch.title) row.title = patch.title;
          if (patch.content !== undefined) row.content = patch.content;
          if (patch.tags !== undefined) row.tags = patch.tags;
          if (patch.attributes !== undefined) row.attributes = patch.attributes;
        }
        return true;
      }
      case 'db-world-setting-delete': {
        const idx = rows.findIndex((r) => r.id === args[0]);
        if (idx >= 0) rows.splice(idx, 1);
        return true;
      }
      case 'db-settings-get':
        return opts.legacy ?? null;
      case 'import-structured-file':
        return opts.importResult ?? null;
      case 'ai-request':
        if (opts.ai instanceof Error) throw opts.ai;
        return opts.ai ?? { ok: true, text: '' };
      default:
        return undefined;
    }
  });
  return { mock, rows };
}

const writeText = vi.fn(async (_text: string) => undefined);

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  uninstallElectronMock();
  vi.useRealTimers();
});

const seed = [
  { id: 1, title: '灵气体系', content: '天地灵气分九品', category: 'system' },
  { id: 2, title: '青云门', content: '正道第一大派', category: 'faction' },
  { id: 3, title: '九州', content: '', category: 'world' },
  { id: 4, title: '东海', content: '海外仙岛', category: 'world' },
];

describe('LoreView', () => {
  it('未打开项目时显示空提示', () => {
    installDb();
    render(<LoreView folderPath={null} content="" />);
    expect(screen.getByText('打开项目后管理设定集')).toBeTruthy();
  });

  it('加载条目、分类计数、切换分类与搜索', async () => {
    installDb({ rows: seed });
    const onEntriesChange = vi.fn();
    render(<LoreView folderPath="/novel" content="" onEntriesChange={onEntriesChange} />);
    expect(await screen.findByText('九州')).toBeTruthy();
    expect(screen.getByText('条目 4')).toBeTruthy();
    expect(screen.getByText('暂无详细说明')).toBeTruthy();
    expect(screen.queryByText('青云门')).toBeNull();
    await waitFor(() =>
      expect(onEntriesChange).toHaveBeenLastCalledWith(expect.arrayContaining([expect.anything()]))
    );

    // 顶部摘要卡切换
    fireEvent.click(screen.getAllByRole('button', { name: /势力/ })[0]);
    expect(screen.getByText('青云门')).toBeTruthy();
    expect(screen.getByText('当前分类 势力')).toBeTruthy();

    // 底部 tab 切换
    fireEvent.click(screen.getByRole('button', { name: '术语' }));
    expect(screen.getByText('当前分类暂无条目')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '世界观' }));
    fireEvent.change(screen.getByPlaceholderText('搜索世界观条目标题或内容'), {
      target: { value: '仙岛' },
    });
    expect(screen.getByText('东海')).toBeTruthy();
    expect(screen.queryByText('九州')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('搜索世界观条目标题或内容'), {
      target: { value: '不存在' },
    });
    expect(screen.getByText('没有匹配的条目')).toBeTruthy();
  });

  it('新增条目（空标题忽略）', async () => {
    const { mock } = installDb();
    render(<LoreView folderPath="/novel" content="" />);
    await screen.findByText('当前分类暂无条目');
    fireEvent.click(screen.getByRole('button', { name: '添加条目' }));
    expect(mock.invoke).not.toHaveBeenCalledWith(
      'db-world-setting-create-by-folder',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );

    fireEvent.change(screen.getByPlaceholderText('新增世界观条目标题'), {
      target: { value: ' 昆仑 ' },
    });
    fireEvent.change(
      screen.getAllByPlaceholderText('记录规则、背景、约束、历史脉络、关键词等')[0],
      {
        target: { value: ' 万山之祖 ' },
      }
    );
    fireEvent.click(screen.getByRole('button', { name: '添加条目' }));
    expect(await screen.findByText('昆仑')).toBeTruthy();
    expect(screen.getByText('万山之祖')).toBeTruthy();
    expect(mock.invoke).toHaveBeenCalledWith(
      'db-world-setting-create-by-folder',
      '/novel',
      'world',
      '昆仑',
      '万山之祖',
      '[]',
      '{}'
    );
    expect((screen.getByPlaceholderText('新增世界观条目标题') as HTMLInputElement).value).toBe('');
  });

  it('编辑条目：点击卡片/编辑按钮进入编辑，保存修改，取消编辑', async () => {
    const { mock } = installDb({ rows: seed });
    render(<LoreView folderPath="/novel" content="" />);
    await screen.findByText('东海');

    fireEvent.click(screen.getByText('东海'));
    const titleInput = screen.getByPlaceholderText('编辑世界观条目标题') as HTMLInputElement;
    expect(titleInput.value).toBe('东海');
    fireEvent.click(screen.getByRole('button', { name: '取消编辑' }));
    expect(screen.getByPlaceholderText('新增世界观条目标题')).toBeTruthy();

    const card = screen.getByText('东海').closest('[class*="loreEntryCard"]') as HTMLElement;
    fireEvent.click(card.querySelector('button') as HTMLButtonElement); // 编辑
    fireEvent.change(screen.getByPlaceholderText('编辑世界观条目标题'), {
      target: { value: '东海龙宫' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect(await screen.findByText('东海龙宫')).toBeTruthy();
    expect(mock.invoke).toHaveBeenCalledWith(
      'db-world-setting-update',
      4,
      expect.objectContaining({ title: '东海龙宫', content: '海外仙岛', category: 'world' })
    );
  });

  it('删除条目（正在编辑时清空编辑区）', async () => {
    const { mock } = installDb({ rows: seed });
    render(<LoreView folderPath="/novel" content="" />);
    await screen.findByText('东海');
    fireEvent.click(screen.getByText('东海'));
    const card = screen.getByText('东海').closest('[class*="loreEntryCard"]') as HTMLElement;
    fireEvent.click(card.querySelectorAll('button')[1] as HTMLButtonElement);
    await waitFor(() => expect(screen.queryByText('东海')).toBeNull());
    expect(mock.invoke).toHaveBeenCalledWith('db-world-setting-delete', 4);
    expect(screen.getByPlaceholderText('新增世界观条目标题')).toBeTruthy();

    const other = screen.getByText('九州').closest('[class*="loreEntryCard"]') as HTMLElement;
    fireEvent.click(other.querySelectorAll('button')[1] as HTMLButtonElement);
    await waitFor(() => expect(screen.queryByText('九州')).toBeNull());
  });

  it('导入设定：取消、成功（含去重与失败文件）', async () => {
    const { mock } = installDb({
      rows: seed,
      importResult: {
        previews: [
          {
            fileName: 'lore.json',
            content: JSON.stringify([
              { title: '九州', category: 'world' },
              { title: '昆仑', summary: '万山之祖' },
            ]),
            sourcePath: '/x/lore.json',
          },
        ],
        errors: [{ filePath: '/x/bad.docx', error: 'bad' }],
      },
    });
    render(<LoreView folderPath="/novel" content="" />);
    await screen.findByText('东海');
    fireEvent.click(screen.getByRole('button', { name: '导入设定 / 大纲' }));
    const result = await screen.findByText(/已导入/);
    expect(result.textContent).toBe('已导入 1 条，跳过 1 条，1 个文件失败');
    expect(await screen.findByText('昆仑')).toBeTruthy();
    expect(mock.invoke).toHaveBeenCalledWith('import-structured-file');
  });

  it('导入对话框取消时无提示', async () => {
    installDb({ rows: seed, importResult: null });
    render(<LoreView folderPath="/novel" content="" />);
    await screen.findByText('东海');
    fireEvent.click(screen.getByRole('button', { name: '导入设定 / 大纲' }));
    await act(async () => undefined);
    expect(screen.queryByText(/已导入/)).toBeNull();
  });

  it('设定诊断：无条目时提示先积累', async () => {
    installDb();
    render(<LoreView folderPath="/novel" content="" />);
    await screen.findByText('当前分类暂无条目');
    fireEvent.click(screen.getByRole('button', { name: '诊断设定缺口' }));
    expect(screen.getByText('先积累一些设定条目，再做 AI 诊断。')).toBeTruthy();
  });

  it('设定诊断：分段结果、复制、写入草稿', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const text = [
      '1. 缺失设定',
      '- 货币体系',
      '2. 可能冲突',
      '东海与九州地理关系不明',
      '3. 建议补充的条目模板',
      '- 宗门等级：外门、内门、真传',
    ].join('\n');
    const { mock } = installDb({ rows: seed, ai: { ok: true, text } });
    render(<LoreView folderPath="/novel" content="正文片段" />);
    await screen.findByText('东海');
    fireEvent.click(screen.getByRole('button', { name: '诊断设定缺口' }));
    expect(await screen.findByText('缺失设定')).toBeTruthy();
    expect(screen.getByText('货币体系')).toBeTruthy();
    expect(screen.getByText('建议补充的条目模板')).toBeTruthy();
    const req = mock.invoke.mock.calls.find((c) => c[0] === 'ai-request')?.[1] as {
      context: string;
    };
    expect(req.context).toContain('[体系] 灵气体系: 天地灵气分九品');
    expect(req.context).toContain('正文抽样:\n正文片段');

    fireEvent.click(screen.getByRole('button', { name: '复制全部' }));
    expect(await screen.findByRole('button', { name: '已复制全部' })).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(text);
    await act(async () => {
      vi.advanceTimersByTime(1700);
    });
    expect(screen.getByRole('button', { name: '复制全部' })).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: '复制本段' })[0]);
    expect(await screen.findByRole('button', { name: '已复制' })).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: '复制' })[0]);
    expect(writeText).toHaveBeenLastCalledWith('货币体系');

    fireEvent.click(screen.getByRole('button', { name: '写入草稿' }));
    expect(screen.getByText('已写入草稿区，可继续补充后保存')).toBeTruthy();
    expect((screen.getByPlaceholderText('新增势力条目标题') as HTMLInputElement).value).toBe(
      '宗门等级'
    );
  });

  it('设定诊断：失败 / 异常 / 空返回', async () => {
    installDb({ rows: seed, ai: { ok: false, error: '额度不足' } });
    const first = render(<LoreView folderPath="/novel" content="" />);
    await screen.findByText('东海');
    fireEvent.click(screen.getByRole('button', { name: '诊断设定缺口' }));
    expect(await screen.findByText('额度不足')).toBeTruthy();
    first.unmount();

    installDb({ rows: seed, ai: new Error('网络错误') });
    const second = render(<LoreView folderPath="/novel" content="" />);
    await screen.findByText('东海');
    fireEvent.click(screen.getByRole('button', { name: '诊断设定缺口' }));
    expect(await screen.findByText('网络错误')).toBeTruthy();
    second.unmount();

    installDb({ rows: seed, ai: { ok: true } });
    render(<LoreView folderPath="/novel" content="" />);
    await screen.findByText('东海');
    fireEvent.click(screen.getByRole('button', { name: '诊断设定缺口' }));
    expect(await screen.findByText('AI 未返回诊断结果')).toBeTruthy();
  });

  it('详情模式：标题 / 内容编辑保存，分类、目录、标签即时保存，相关设定跳转、删除', async () => {
    const { mock, rows } = installDb({ rows: seed });
    render(<LoreView folderPath="/novel" content="" initialEntryId={3} />);
    const detail = await screen.findByTestId('lore-detail');
    const title = within(detail).getByLabelText('设定标题') as HTMLInputElement;
    expect(title.value).toBe('九州');
    // 没有图时封面显示首字 +「添加图片」
    expect(within(detail).getByRole('button', { name: '为 九州 添加图片' })).toBeTruthy();

    // 内容：改完点「保存」
    fireEvent.change(within(detail).getByLabelText('设定内容'), { target: { value: '天下九分' } });
    fireEvent.click(within(detail).getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(mock.invoke).toHaveBeenCalledWith(
        'db-world-setting-update',
        3,
        expect.objectContaining({ title: '九州', content: '天下九分' })
      )
    );

    // 标题：失焦保存
    fireEvent.change(title, { target: { value: '神州' } });
    fireEvent.blur(title);
    await waitFor(() => expect(rows.find((row) => row.id === 3)?.title).toBe('神州'));

    // 目录（多级分类）：失焦时规范化并写入 attributes
    const folder = within(detail).getByLabelText('设定目录') as HTMLInputElement;
    fireEvent.change(folder, { target: { value: ' 地理 / 中原 /' } });
    fireEvent.blur(folder);
    await waitFor(() =>
      expect(JSON.parse(rows.find((row) => row.id === 3)?.attributes ?? '{}')).toEqual({
        folder: '地理/中原',
      })
    );

    // 标签：回车添加，× 移除
    const tagInput = within(detail).getByLabelText('添加标签');
    fireEvent.change(tagInput, { target: { value: '#古国，大陆' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    await waitFor(() =>
      expect(JSON.parse(rows.find((row) => row.id === 3)?.tags ?? '[]')).toEqual(['古国', '大陆'])
    );
    fireEvent.click(await within(detail).findByLabelText('移除标签 古国'));
    await waitFor(() =>
      expect(JSON.parse(rows.find((row) => row.id === 3)?.tags ?? '[]')).toEqual(['大陆'])
    );

    // 图集分页
    fireEvent.click(within(detail).getByRole('tab', { name: /图集/ }));
    expect(within(detail).getByTestId('entity-gallery')).toBeTruthy();

    // 相关设定（同目录 / 同标签 / 同分类）→ 跳转到「东海」
    fireEvent.click(within(detail).getByRole('tab', { name: '相关设定' }));
    fireEvent.click(within(detail).getByText('东海'));
    await waitFor(() =>
      expect((within(detail).getByLabelText('设定标题') as HTMLInputElement).value).toBe('东海')
    );

    // 分类即时保存
    chooseOption('设定分类', '势力', within(detail));
    await waitFor(() => expect(rows.find((row) => row.id === 4)?.category).toBe('faction'));

    fireEvent.click(within(detail).getByRole('tab', { name: '内容' }));
    fireEvent.click(within(detail).getByRole('button', { name: '删除条目' }));
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledWith('db-world-setting-delete', 4));
  });

  it('详情模式：条目不存在 / 没有相关设定', async () => {
    installDb({ rows: [{ id: 9, title: '孤条', category: 'term', content: '唯一' }] });
    const { unmount } = render(<LoreView folderPath="/novel" content="" initialEntryId={9} />);
    const detail = await screen.findByTestId('lore-detail');
    fireEvent.click(within(detail).getByRole('tab', { name: '相关设定' }));
    expect(within(detail).getByText('还没有同目录、同标签或同分类的设定。')).toBeTruthy();
    unmount();

    installDb({ rows: seed });
    render(<LoreView folderPath="/novel" content="" initialEntryId={999} />);
    expect(await screen.findByText('没有找到对应设定，可能已经被删除。')).toBeTruthy();
  });

  it('迁移旧版 settings 存储的设定', async () => {
    const { mock } = installDb({
      legacy: JSON.stringify([{ title: '旧设定', summary: '来自旧版' }, { title: '' }]),
    });
    render(<LoreView folderPath="/novel" content="" />);
    expect(await screen.findByText('旧设定')).toBeTruthy();
    expect(mock.invoke).toHaveBeenCalledWith('db-world-setting-bulk-create-by-folder', '/novel', [
      { category: 'world', title: '旧设定', content: '来自旧版', tags: '[]' },
    ]);
  });

  // BUG: LoreView.tsx 的 React.memo 比较函数只比较 folderPath/initialEntryId，
  // 而 content 通过 `contentRef.current = content`（仅在渲染时执行）同步。
  // content 变化不会触发重渲染，contentRef 永远停留在首次渲染的正文，
  // 导致"诊断设定缺口"发送给 AI 的正文抽样是过期内容。
  it('设定诊断应使用最新的正文内容', async () => {
    const { mock } = installDb({ rows: seed, ai: { ok: true, text: 'ok' } });
    const { rerender } = render(<LoreView folderPath="/novel" content="旧正文" />);
    await screen.findByText('东海');
    rerender(<LoreView folderPath="/novel" content="新正文" />);
    fireEvent.click(screen.getByRole('button', { name: '诊断设定缺口' }));
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledWith('ai-request', expect.anything()));
    const req = mock.invoke.mock.calls.find((c) => c[0] === 'ai-request')?.[1] as {
      context: string;
    };
    expect(req.context).toContain('新正文');
  });
});
