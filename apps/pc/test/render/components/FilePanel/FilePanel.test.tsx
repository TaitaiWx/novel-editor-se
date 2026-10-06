// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

describe('FilePanel · ne init 项目结构', () => {
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
          children: ['第一卷-离乡', '第二卷-星海'].map((volume, index) => ({
            name: volume,
            path: `/s/novels/星河旅人/${volume}`,
            type: 'directory' as const,
            children: [1, 2, 3].map((n) => {
              const name = `00${index * 3 + n}-章节${index * 3 + n}.md`;
              return { name, path: `/s/novels/星河旅人/${volume}/${name}`, type: 'file' as const };
            }),
          })),
        },
        {
          name: '剑与诗',
          path: '/s/novels/剑与诗',
          type: 'directory',
          children: [
            { name: '001-少年.md', path: '/s/novels/剑与诗/001-少年.md', type: 'file' },
            { name: '002-听雨楼.md', path: '/s/novels/剑与诗/002-听雨楼.md', type: 'file' },
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

  const rowOf = (text: string) => screen.getByText(text).closest('[role="button"]') as HTMLElement;

  it('作品为顶层「作品」节点，带卷数与章数；不显示 novels 容器与未分卷', () => {
    renderPanel({ files: sampleFiles, folderPath: '/s', projectLayout });
    expect(screen.queryByText('novels')).toBeNull();
    expect(screen.queryByText('未分卷')).toBeNull();
    expect(screen.getAllByText('作品')).toHaveLength(2);

    const star = rowOf('星河旅人');
    expect(star.textContent).toContain('作品');
    expect(star.textContent).toContain('2卷');
    expect(star.textContent).toContain('6章');
    expect(star.querySelector('[title]')?.getAttribute('title')).toBe(
      '作品「星河旅人」· 2 卷 · 6 章'
    );
    const sword = rowOf('剑与诗');
    expect(sword.textContent).toContain('2章');
    expect(sword.textContent).not.toContain('卷');
  });

  it('展开作品显示卷与章；章节序号前缀单独弱化显示但文本完整', () => {
    renderPanel({ files: sampleFiles, folderPath: '/s', projectLayout });
    fireEvent.click(rowOf('星河旅人'));
    expect(rowOf('第一卷-离乡').textContent).toContain('3章');
    expect(screen.getAllByText('卷')).toHaveLength(2);
    fireEvent.click(rowOf('第一卷-离乡'));
    const title = document.querySelector('span[title="001-章节1.md"]') as HTMLElement;
    expect(title.textContent).toBe('001-章节1');
    expect(title.getAttribute('title')).toBe('001-章节1.md');
    expect(title.querySelector('[class*="storyNodeIndex"]')?.textContent).toBe('001-');
  });

  it('根目录文档在「项目文档」分区，不是章节，点击打开', () => {
    const { props } = renderPanel({ files: sampleFiles, folderPath: '/s', projectLayout });
    const docs = screen.getByRole('region', { name: '项目文档' });
    expect(docs.textContent).toContain('欢迎使用');
    const welcome = rowOf('欢迎使用');
    expect(welcome.textContent).not.toContain('章');
    expect(welcome.getAttribute('draggable')).toBe('false');
    fireEvent.click(welcome);
    expect(props.onFileSelect).toHaveBeenCalledWith('/s/欢迎使用.md');
  });

  it('普通文件夹：根目录说明文档同样放进项目文档，不计入未分卷章数', () => {
    renderPanel({
      files: [
        { name: 'README.md', path: '/p/README.md', type: 'file' },
        { name: '第一章.md', path: '/p/第一章.md', type: 'file' },
      ],
      folderPath: '/p',
    });
    expect(screen.getByRole('region', { name: '项目文档' }).textContent).toContain('README');
    expect(rowOf('未分卷').textContent).toContain('1章');
  });
});
