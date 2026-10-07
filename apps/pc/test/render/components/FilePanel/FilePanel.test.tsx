// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import FilePanel from '@/render/components/FilePanel';
import type { FileNode } from '@/render/types';
import type { Character, LoreEntry } from '@/render/components/RightPanel/types';

const files: FileNode[] = [
  {
    name: '第一卷',
    path: '/p/第一卷',
    type: 'directory',
    children: [{ name: '第一章.md', path: '/p/第一卷/第一章.md', type: 'file' }],
  },
];

const characters = [
  { id: 1, name: '林舟', role: '主角', category: 'major', description: '', currentState: [] },
  { id: 2, name: '白芷', role: '', category: 'secondary', description: '', currentState: [] },
] as Character[];

const loreEntries = [
  {
    id: 7,
    title: '灵气体系',
    summary: '',
    category: 'world',
    tags: [],
    createdAt: '',
    updatedAt: '',
  },
] as unknown as LoreEntry[];

function renderPanel(overrides: Partial<React.ComponentProps<typeof FilePanel>> = {}) {
  const noop = vi.fn();
  const props: React.ComponentProps<typeof FilePanel> = {
    files,
    characters,
    loreEntries,
    selectedFile: null,
    folderPath: '/p',
    isLoading: false,
    onFileSelect: vi.fn(),
    onOpenCharacterNode: vi.fn(),
    onOpenLoreNode: vi.fn(),
    onDeleteCharacterNode: noop,
    onDeleteLoreNode: noop,
    onRenameCharacterNode: noop,
    onRenameLoreNode: noop,
    onRenameNode: noop,
    onCreateVolume: noop,
    onCreateChapter: noop,
    onCreateDraftFolder: noop,
    onCreateDraft: noop,
    onCreateCharacter: noop,
    onCreateLoreEntry: noop,
    onCreateMaterialDirectory: noop,
    onRefresh: noop,
    onOpenFolder: noop,
    onObjectContextMenu: vi.fn(),
    ...overrides,
  };
  const utils = render(<FilePanel {...props} />);
  return { ...utils, props };
}

describe('FilePanel', () => {
  it('未打开文件夹时显示空状态', () => {
    renderPanel({ folderPath: null, files: [] });
    expect(screen.queryByText('正文')).toBeNull();
  });

  it('渲染正文、角色、设定、资料分区，并分组显示角色', () => {
    renderPanel();
    expect(screen.getByText('p')).toBeTruthy();
    expect(screen.getByText('正文')).toBeTruthy();
    expect(screen.getByText('第一卷')).toBeTruthy();
    expect(screen.getByText('主要角色')).toBeTruthy();
    expect(screen.getByText('次要角色 · 未填写角色定位')).toBeTruthy();
    expect(screen.getByText('灵气体系')).toBeTruthy();
    expect(screen.getByText('暂无说明')).toBeTruthy();
    expect(screen.getByText('导入的图片、文档和其他素材会出现在这里')).toBeTruthy();
  });

  it('选中文件时自动展开所在卷，点击章节触发选择', () => {
    const { props } = renderPanel({ selectedFile: '/p/第一卷/第一章.md' });
    fireEvent.click(screen.getByText('第一章'));
    expect(props.onFileSelect).toHaveBeenCalledWith('/p/第一卷/第一章.md');
  });

  it('打开对象节点与右键菜单', () => {
    const { props } = renderPanel();
    fireEvent.click(screen.getByText('林舟'));
    expect(props.onOpenCharacterNode).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByText('灵气体系'));
    expect(props.onOpenLoreNode).toHaveBeenCalledWith(7);
    fireEvent.contextMenu(screen.getByText('灵气体系'));
    expect(props.onObjectContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: 'lore-item', entryId: 7 } })
    );
  });

  it('搜索过滤角色与设定分区', () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText(/搜索文件/));
    fireEvent.change(screen.getByPlaceholderText('搜索作品内容...'), {
      target: { value: '白芷' },
    });
    expect(screen.queryByText('林舟')).toBeNull();
    expect(screen.getByText('白芷')).toBeTruthy();
    expect(screen.queryByText('灵气体系')).toBeNull();
    expect(screen.getByText('还没有正文文件')).toBeTruthy();
  });

  it('折叠角色分区', () => {
    renderPanel();
    fireEvent.click(screen.getByText('角色'), { detail: 1 });
    expect(screen.queryByText('林舟')).toBeNull();
  });

  it('提供 onOpenGrowth 时显示「成长档案」分区，未提供时不显示', () => {
    const onOpenGrowth = vi.fn();
    const onCreateGrowthSheet = vi.fn();
    const { unmount } = renderPanel({
      growthIndex: {
        initialized: true,
        sheets: [
          {
            name: '白芷',
            aliases: [],
            level: 3,
            exp: 900,
            latestChapter: 0,
            errorCount: 0,
            warningCount: 0,
          },
        ],
      },
      onOpenGrowth,
      onCreateGrowthSheet,
      activeWorkspaceTab: '__workspace__:growth:白芷',
    });
    expect(screen.getByText('成长档案')).toBeTruthy();
    expect(screen.getByText('Lv.3')).toBeTruthy();
    fireEvent.click(screen.getByText('Lv.3'));
    expect(onOpenGrowth).toHaveBeenCalledWith('白芷');
    fireEvent.click(screen.getByLabelText('新建成长卡'));
    expect(onCreateGrowthSheet).toHaveBeenCalledTimes(1);
    unmount();

    renderPanel();
    expect(screen.queryByText('成长档案')).toBeNull();
  });
});

describe('FilePanel · ne init 项目结构（角色 / 设定 / 成长档案 / 资料跟随作品）', () => {
  const sampleFiles: FileNode[] = [
    { name: '欢迎使用.md', path: '/s/欢迎使用.md', type: 'file' },
    {
      name: 'novels',
      path: '/s/novels',
      type: 'directory',
      children: [
        {
          name: '星河旅人',
          path: '/s/novels/星河旅人',
          type: 'directory',
          children: [
            ...['第一卷-离乡', '第二卷-星海'].map((volume, index) => ({
              name: volume,
              path: `/s/novels/星河旅人/${volume}`,
              type: 'directory' as const,
              children: [1, 2, 3].map((n) => {
                const name = `00${index * 3 + n}-章节${index * 3 + n}.md`;
                return {
                  name,
                  path: `/s/novels/星河旅人/${volume}/${name}`,
                  type: 'file' as const,
                };
              }),
            })),
            {
              name: '资料',
              path: '/s/novels/星河旅人/资料',
              type: 'directory' as const,
              children: [
                {
                  name: '世界观.md',
                  path: '/s/novels/星河旅人/资料/世界观.md',
                  type: 'file' as const,
                },
              ],
            },
          ],
        },
        {
          name: '剑与诗',
          path: '/s/novels/剑与诗',
          type: 'directory',
          children: [
            { name: '001-少年.md', path: '/s/novels/剑与诗/001-少年.md', type: 'file' },
            { name: '002-听雨楼.md', path: '/s/novels/剑与诗/002-听雨楼.md', type: 'file' },
            {
              name: '资料',
              path: '/s/novels/剑与诗/资料',
              type: 'directory',
              children: [
                { name: '江湖风物.md', path: '/s/novels/剑与诗/资料/江湖风物.md', type: 'file' },
                { name: '听雨楼.png', path: '/s/novels/剑与诗/资料/听雨楼.png', type: 'file' },
              ],
            },
          ],
        },
      ],
    },
  ];
  const projectLayout = {
    name: '示例作品集',
    novelsDir: 'novels',
    novelsPath: '/s/novels',
    novels: ['剑与诗', '星河旅人'],
  };
  const star = { kind: 'work' as const, name: '星河旅人', path: '/s/novels/星河旅人' };
  const sword = { kind: 'work' as const, name: '剑与诗', path: '/s/novels/剑与诗' };
  const unassigned = { kind: 'unassigned' as const, name: '未归属', path: '/s' };

  const rowOf = (text: string) => screen.getByText(text).closest('[role="button"]') as HTMLElement;
  const materials = () => screen.getByRole('region', { name: '资料' });
  /** 资料分区标题上的文件数 */
  const materialCount = () => within(materials()).getAllByText(/^\d+$/)[0]?.textContent ?? '';

  it('顶部作品切换器显示当前作品；正文只列当前作品的卷 / 章，不显示 novels 容器与其他作品', () => {
    renderPanel({
      files: sampleFiles,
      folderPath: '/s',
      projectLayout,
      workScope: star,
      workScopeOptions: [sword, star],
    });
    const switcher = screen.getByTestId('work-switcher');
    expect(switcher.textContent).toContain('星河旅人');
    expect(switcher.textContent).toContain('6章');
    expect(screen.queryByText('novels')).toBeNull();
    expect(screen.queryByText('剑与诗')).toBeNull();
    expect(rowOf('第一卷-离乡').textContent).toContain('3章');
    expect(screen.getAllByText('卷')).toHaveLength(2);
    // 正文分区标题带当前作品的章数
    expect(screen.getByText('正文').parentElement?.textContent).toContain('6');
  });

  it('未传入当前作品时默认第一部作品；切换器列出作品与章数，可切换、新建作品', () => {
    const onSelectWork = vi.fn();
    const onCreateWork = vi.fn();
    renderPanel({
      files: sampleFiles,
      folderPath: '/s',
      projectLayout,
      onSelectWork,
      onCreateWork,
    });
    expect(screen.getByTestId('work-switcher').textContent).toContain('剑与诗');
    expect(document.querySelector('span[title="001-少年.md"]')).not.toBeNull();

    fireEvent.click(screen.getByTestId('work-switcher'));
    const list = screen.getByRole('listbox', { name: '作品' });
    const options = Array.from(list.querySelectorAll('[role="option"]')).map(
      (el) => el.textContent
    );
    expect(options).toEqual(['剑与诗2章', '星河旅人6章']);
    fireEvent.click(screen.getByRole('option', { name: /星河旅人/ }));
    expect(onSelectWork).toHaveBeenCalledWith('/s/novels/星河旅人');

    fireEvent.click(screen.getByTestId('work-switcher'));
    fireEvent.click(screen.getByText('新建作品'));
    expect(onCreateWork).toHaveBeenCalledTimes(1);
  });

  it('资料分区只显示当前作品的 资料/；未归属显示项目根的旧资料', () => {
    const { unmount } = renderPanel({
      files: sampleFiles,
      folderPath: '/s',
      projectLayout,
      workScope: star,
    });
    // 星河旅人 1 个资料文件，剑与诗 2 个
    expect(materialCount()).toBe('1');
    unmount();

    const other = renderPanel({
      files: sampleFiles,
      folderPath: '/s',
      projectLayout,
      workScope: sword,
    });
    expect(materialCount()).toBe('2');
    other.unmount();

    renderPanel({
      files: [
        ...sampleFiles,
        {
          name: '资料',
          path: '/s/资料',
          type: 'directory',
          children: [
            { name: '旧设定.md', path: '/s/资料/旧设定.md', type: 'file' },
            { name: '旧人物.md', path: '/s/资料/旧人物.md', type: 'file' },
            { name: '草图.png', path: '/s/资料/草图.png', type: 'file' },
          ],
        },
      ],
      folderPath: '/s',
      projectLayout: { ...projectLayout, hasProjectMaterials: true },
      workScope: unassigned,
      workScopeOptions: [sword, star, unassigned],
    });
    expect(screen.getByTestId('work-switcher').textContent).toContain('未归属');
    expect(materialCount()).toBe('3');
    expect(screen.queryByText('第一卷-离乡')).toBeNull();
  });

  it('搜索时跨作品显示结果', () => {
    renderPanel({ files: sampleFiles, folderPath: '/s', projectLayout, workScope: star });
    expect(screen.queryByText('剑与诗')).toBeNull();
    fireEvent.click(screen.getByLabelText(/搜索文件/));
    fireEvent.change(screen.getByPlaceholderText('搜索作品内容...'), {
      target: { value: '少年' },
    });
    expect(screen.getByText('剑与诗')).toBeTruthy();
  });

  it('根目录文档在项目名下方的「项目说明」分区（作品切换器之上，默认折叠，带数量），展开后点击打开', () => {
    const { props, container } = renderPanel({
      files: sampleFiles,
      folderPath: '/s',
      projectLayout,
      workScope: star,
    });
    const region = screen.getByRole('region', { name: '项目说明' });
    // 层级：项目名 → 项目说明 → 作品切换器 → 当前作品的内容
    const switcher = screen.getByTestId('work-switcher');
    expect(
      region.compareDocumentPosition(switcher) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(container.querySelector('[class*="workspaceTree"]')?.contains(region)).toBe(false);
    // 不在 ⋯ 菜单里
    fireEvent.click(screen.getByTestId('project-menu-trigger'));
    expect(screen.queryByRole('group', { name: /^项目说明/ })).toBeNull();
    fireEvent.click(screen.getByTestId('project-menu-trigger'));

    expect(screen.queryByText('欢迎使用')).toBeNull();
    const header = within(region).getByRole('button', { name: /项目说明/ });
    expect(header.textContent).toContain('1');
    fireEvent.click(header, { detail: 1 });
    const item = within(region).getByRole('listitem');
    expect(item.textContent).toBe('欢迎使用');
    fireEvent.click(item);
    expect(props.onFileSelect).toHaveBeenCalledWith('/s/欢迎使用.md');
  });

  it('没有根目录文档时不显示「项目说明」分区', () => {
    renderPanel({
      files: sampleFiles.slice(1),
      folderPath: '/s',
      projectLayout,
      workScope: star,
    });
    expect(screen.queryByRole('region', { name: '项目说明' })).toBeNull();
  });

  it('普通文件夹：没有作品切换器；根目录说明文档放进项目说明，不计入未分卷章数', () => {
    renderPanel({
      files: [
        { name: 'README.md', path: '/p/README.md', type: 'file' },
        { name: '第一章.md', path: '/p/第一章.md', type: 'file' },
      ],
      folderPath: '/p',
    });
    expect(screen.queryByTestId('work-switcher')).toBeNull();
    const region = screen.getByRole('region', { name: '项目说明' });
    fireEvent.click(within(region).getByRole('button', { name: /项目说明/ }), { detail: 1 });
    expect(within(region).getByRole('listitem').textContent).toBe('README');
    expect(rowOf('未分卷').textContent).toContain('1章');
  });
});
