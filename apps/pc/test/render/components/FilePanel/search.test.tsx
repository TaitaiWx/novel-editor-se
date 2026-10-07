// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import FilePanel from '@/render/components/FilePanel';
import {
  buildSearchGroups,
  relativeDirectory,
  splitHighlight,
} from '@/render/components/FilePanel/search';
import type { FileNode } from '@/render/types';
import type { Character, LoreEntry } from '@/render/components/RightPanel/types';
import type { WorkspaceContentSearchResponse } from '@/shared/workspace-search';

const files: FileNode[] = [
  { name: '欢迎使用.md', path: '/s/欢迎使用.md', type: 'file' },
  { name: '小说格式示例.md', path: '/s/小说格式示例.md', type: 'file' },
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
          {
            name: '第一卷-离乡',
            path: '/s/novels/星河旅人/第一卷-离乡',
            type: 'directory',
            children: [
              {
                name: '001-启程.md',
                path: '/s/novels/星河旅人/第一卷-离乡/001-启程.md',
                type: 'file',
              },
            ],
          },
          {
            name: '资料',
            path: '/s/novels/星河旅人/资料',
            type: 'directory',
            children: [
              { name: '星图.png', path: '/s/novels/星河旅人/资料/星图.png', type: 'file' },
            ],
          },
        ],
      },
      {
        name: '剑与诗',
        path: '/s/novels/剑与诗',
        type: 'directory',
        children: [{ name: '001-少年.md', path: '/s/novels/剑与诗/001-少年.md', type: 'file' }],
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

const characters = [
  {
    id: 1,
    name: '林舟',
    role: '主角',
    category: 'major',
    description: '',
    currentState: [],
    aliases: ['小舟'],
  },
  { id: 2, name: '白芷', role: '', category: 'secondary', description: '', currentState: [] },
] as Character[];

const loreEntries = [
  {
    id: 7,
    title: '星辉灯塔',
    summary: '',
    category: 'world',
    tags: ['地点'],
    folder: '地理',
    media: [],
    createdAt: '',
    updatedAt: '',
  },
] as LoreEntry[];

function renderPanel(overrides: Partial<React.ComponentProps<typeof FilePanel>> = {}) {
  const noop = vi.fn();
  const props: React.ComponentProps<typeof FilePanel> = {
    files,
    characters,
    loreEntries,
    selectedFile: null,
    folderPath: '/s',
    projectLayout,
    workScope: star,
    workScopeOptions: [star],
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
    ...overrides,
  };
  const utils = render(<FilePanel {...props} />);
  return { ...utils, props };
}

const input = () => screen.getByPlaceholderText('搜索作品内容...') as HTMLInputElement;
const results = () => screen.getByRole('listbox', { name: '搜索结果' });

function openSearch(query: string) {
  fireEvent.click(screen.getByLabelText(/搜索文件/));
  fireEvent.change(input(), { target: { value: query } });
}

function mockContentSearch(response: WorkspaceContentSearchResponse) {
  // 面板里其他组件也可能调用 IPC（例如最近使用的文件夹），只统计全文搜索
  const invoke = vi.fn(async (channel: string) =>
    channel === 'workspace-search-content' ? response : null
  );
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { ipcRenderer: { invoke } },
  });
  return invoke;
}

function searchCalls(invoke: ReturnType<typeof mockContentSearch>) {
  return invoke.mock.calls.filter(([channel]) => channel === 'workspace-search-content');
}

afterEach(() => {
  Reflect.deleteProperty(window, 'electron');
  vi.useRealTimers();
});

describe('搜索纯函数', () => {
  it('splitHighlight 忽略大小写切出全部命中', () => {
    expect(splitHighlight('Abc-abC', 'bc')).toEqual([
      { text: 'A', match: false },
      { text: 'bc', match: true },
      { text: '-a', match: false },
      { text: 'bC', match: true },
    ]);
    expect(splitHighlight('文本', '')).toEqual([{ text: '文本', match: false }]);
  });

  it('relativeDirectory 去掉项目根与 novels/ 前缀', () => {
    expect(relativeDirectory('/s/novels/星河旅人/第一卷/001.md', '/s')).toBe('星河旅人 / 第一卷');
    expect(relativeDirectory('/s/欢迎使用.md', '/s')).toBe('');
    expect(relativeDirectory('C:\\s\\资料\\a.png', 'C:\\s')).toBe('资料');
  });

  it('空关键词没有结果；按名称匹配项目说明 / 正文 / 人物（含别名）/ 设定（含标签）/ 资料', () => {
    const base = {
      rootPath: '/s',
      projectDocs: [files[0], files[1]],
      storyNodes: [],
      materialNodes: [],
      characters,
      loreEntries,
      growthSheets: [],
      contentFiles: null,
    };
    expect(buildSearchGroups({ ...base, query: '  ' })).toEqual([]);
    expect(
      buildSearchGroups({ ...base, query: '小说格式' }).map((group) => [group.id, group.total])
    ).toEqual([['docs', 1]]);
    expect(buildSearchGroups({ ...base, query: '小舟' })[0].items[0]).toMatchObject({
      kind: 'character',
      id: 1,
    });
    expect(buildSearchGroups({ ...base, query: '地点' })[0].items[0]).toMatchObject({
      kind: 'lore',
      id: 7,
      detail: '地理 #地点',
    });
  });

  it('只有成长档案的角色也能搜到；有人物卡的不重复', () => {
    const sheet = (name: string) => ({
      name,
      aliases: [],
      level: 3,
      exp: 0,
      latestChapter: 0,
      errorCount: 0,
      warningCount: 0,
    });
    const groups = buildSearchGroups({
      query: '林',
      rootPath: '/s',
      projectDocs: [],
      storyNodes: [],
      materialNodes: [],
      characters,
      loreEntries: [],
      growthSheets: [sheet('林舟'), sheet('林间客')],
      contentFiles: null,
    });
    expect(groups[0].items.map((item) => item.key)).toEqual(['character:1', 'growth:林间客']);
  });
});

describe('FilePanel 搜索', () => {
  it('打开搜索但关键词为空时，照常显示完整面板（正文 / 角色 / 设定 / 资料）', () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText(/搜索文件/));
    expect(input()).toBeTruthy();
    expect(screen.queryByRole('listbox', { name: '搜索结果' })).toBeNull();
    expect(screen.getByRole('region', { name: '正文' })).toBeTruthy();
    expect(screen.getByText('林舟')).toBeTruthy();
    expect(screen.getByText('星辉灯塔')).toBeTruthy();
    expect(screen.getByRole('region', { name: '资料' })).toBeTruthy();
    expect(screen.getByTestId('work-switcher')).toBeTruthy();
  });

  it('按文件名找到根目录的项目说明，高亮关键词，点击打开并关闭搜索', () => {
    const { props } = renderPanel();
    openSearch('小说格式');
    const docs = within(results()).getByRole('region', { name: '项目说明' });
    const option = within(docs).getByRole('option');
    expect(option.textContent).toContain('小说格式示例.md');
    expect(option.querySelector('mark')?.textContent).toBe('小说格式');
    // 搜索时用结果列表替换树
    expect(screen.queryByRole('region', { name: '正文' })).toBeNull();
    fireEvent.click(option);
    expect(props.onFileSelect).toHaveBeenCalledWith('/s/小说格式示例.md');
    expect(screen.queryByPlaceholderText('搜索作品内容...')).toBeNull();
    expect(screen.getByRole('region', { name: '正文' })).toBeTruthy();
  });

  it('跨作品找到章节与资料文件，显示所在目录', () => {
    renderPanel();
    openSearch('少年');
    const story = within(results()).getByRole('region', { name: '正文' });
    expect(within(story).getByRole('option').textContent).toContain('剑与诗');
    fireEvent.change(input(), { target: { value: '星图' } });
    const materials = within(results()).getByRole('region', { name: '资料' });
    expect(within(materials).getByRole('option').textContent).toContain('星河旅人 / 资料');
  });

  it('人物 / 设定结果点击后打开对应详情', () => {
    const { props } = renderPanel();
    openSearch('白芷');
    fireEvent.click(within(results()).getByRole('option'));
    expect(props.onOpenCharacterNode).toHaveBeenCalledWith(2);
    openSearch('灯塔');
    fireEvent.click(within(results()).getByRole('option'));
    expect(props.onOpenLoreNode).toHaveBeenCalledWith(7);
  });

  it('没有结果时给出提示；Esc 关闭搜索', () => {
    renderPanel();
    openSearch('不存在的词');
    expect(results().textContent).toContain('没有找到「不存在的词」');
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.queryByPlaceholderText('搜索作品内容...')).toBeNull();
    expect(screen.queryByRole('listbox', { name: '搜索结果' })).toBeNull();
  });

  it('全文搜索：防抖调用主进程，显示命中行并高亮；↑ / ↓ 选择、Enter 打开', async () => {
    const invoke = mockContentSearch({
      ok: true,
      data: {
        query: '林舟背起行囊',
        truncated: false,
        files: [
          {
            file: '/s/novels/星河旅人/第一卷-离乡/001-启程.md',
            matchCount: 1,
            matches: [
              { line: 3, preview: '清晨，林舟背起行囊走出家门。', matchStart: 3, matchLength: 6 },
            ],
          },
        ],
      },
    });
    const { props } = renderPanel();
    openSearch('林舟背起行囊');
    expect(results().textContent).toContain('正在搜索正文内容');
    const content = await waitFor(() => within(results()).getByRole('region', { name: '内容' }));
    expect(searchCalls(invoke)).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith('workspace-search-content', '/s', '林舟背起行囊');
    const option = within(content).getByRole('option');
    expect(option.textContent).toContain('001-启程');
    expect(option.textContent).toContain('第 3 行');
    expect(option.querySelector('mark')?.textContent).toBe('林舟背起行囊');
    // 唯一结果默认选中，Enter 打开
    expect(option.getAttribute('aria-selected')).toBe('true');
    expect(input().getAttribute('aria-activedescendant')).toBe(option.id);
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(props.onFileSelect).toHaveBeenCalledWith('/s/novels/星河旅人/第一卷-离乡/001-启程.md');
  });

  it('↓ 在多个结果间移动选中项', () => {
    renderPanel();
    openSearch('001');
    const options = within(results()).getAllByRole('option');
    expect(options.length).toBe(2);
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(options[1].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(options[1].getAttribute('aria-selected')).toBe('true');
  });

  it('全文搜索失败时显示原因，名称结果照常可用', async () => {
    mockContentSearch({ ok: false, error: '作品目录不在当前打开的项目内' });
    renderPanel();
    openSearch('小说格式');
    await waitFor(() => expect(results().textContent).toContain('正文内容搜索失败'));
    expect(within(results()).getByRole('option').textContent).toContain('小说格式示例.md');
  });

  it('快速输入只发起最后一次全文搜索', async () => {
    vi.useFakeTimers();
    const invoke = mockContentSearch({
      ok: true,
      data: { query: '', truncated: false, files: [] },
    });
    renderPanel();
    openSearch('林');
    fireEvent.change(input(), { target: { value: '林舟' } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(searchCalls(invoke)).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith('workspace-search-content', '/s', '林舟');
  });
});
