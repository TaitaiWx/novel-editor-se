// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FileNode } from '@/render/types';
import InlineRenameInput from '@/render/components/InlineRenameInput';
import StoryTreeNode, { type StoryTreeContext } from '@/render/components/FilePanel/StoryTreeNode';
import ObjectItemRow from '@/render/components/FilePanel/ObjectItemRow';
import WorkspaceHeader, {
  buildCreateMenuItems,
} from '@/render/components/FilePanel/WorkspaceHeader';
import ProjectMenu, {
  PROJECT_MORE_LABEL,
  folderBaseName,
  getRevealInFileManagerLabel,
  pickRecentFolders,
} from '@/render/components/FilePanel/ProjectMenu';
import FileTree from '@/render/components/FileTree';
import ProjectDocsSection, {
  PROJECT_DOCS_HINT,
} from '@/render/components/FilePanel/ProjectDocsSection';

function makeTree(overrides: Partial<StoryTreeContext> = {}): StoryTreeContext {
  return {
    expandedStoryDirs: new Set<string>(),
    revealPath: null,
    folderPath: '/p',
    activeWorkspaceTab: null,
    selectedFile: null,
    storyDropTarget: null,
    canReorder: true,
    registerNodeRef: vi.fn(),
    onToggleDirectory: vi.fn(),
    onSelectFile: vi.fn(),
    onRenameNode: vi.fn(),
    onRowKeyDown: vi.fn(),
    onDragStart: vi.fn(),
    onDragOver: vi.fn(),
    onDrop: vi.fn(),
    onDragEnd: vi.fn(),
    onContextMenu: vi.fn(),
    onObjectContextMenu: vi.fn(),
    ...overrides,
  };
}

const rowOf = (text: string) => screen.getByText(text).closest('[role="button"]') as HTMLElement;

describe('InlineRenameInput', () => {
  function setup(props: Partial<React.ComponentProps<typeof InlineRenameInput>> = {}) {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const onParentKeyDown = vi.fn();
    const onParentClick = vi.fn();
    render(
      <div onKeyDown={onParentKeyDown} onClick={onParentClick}>
        <InlineRenameInput
          initialValue="001-启程"
          ariaLabel="重命名 001-启程"
          onCommit={onCommit}
          onCancel={onCancel}
          {...props}
        />
      </div>
    );
    const input = screen.getByLabelText('重命名 001-启程') as HTMLInputElement;
    return { input, onCommit, onCancel, onParentKeyDown, onParentClick };
  }

  it('挂载即聚焦并全选；Enter 提交去空白后的新名称，按键与点击不冒泡', () => {
    const { input, onCommit, onCancel, onParentKeyDown, onParentClick } = setup();
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, '001-启程'.length]);
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: '  001-出发  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('001-出发');
    expect(onCancel).not.toHaveBeenCalled();
    expect(onParentKeyDown).not.toHaveBeenCalled();
    expect(onParentClick).not.toHaveBeenCalled();
    // 回车后失焦不会重复提交
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('Esc 取消并把焦点还给所在行', () => {
    const row = document.createElement('div');
    row.tabIndex = 0;
    document.body.appendChild(row);
    const { input, onCommit, onCancel } = setup({ restoreFocusRef: { current: row } });
    fireEvent.change(input, { target: { value: '别的名字' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(row);
    row.remove();
  });

  it('失焦提交；名称为空或未变化时视为取消；输入法组字中的回车不提交', () => {
    const first = setup();
    fireEvent.change(first.input, { target: { value: '001-启程' } });
    fireEvent.blur(first.input);
    expect(first.onCancel).toHaveBeenCalled();
    expect(first.onCommit).not.toHaveBeenCalled();
    document.body.innerHTML = '';

    const second = setup();
    fireEvent.change(second.input, { target: { value: '新名' } });
    fireEvent.keyDown(second.input, { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(second.onCommit).not.toHaveBeenCalled();
    fireEvent.blur(second.input);
    expect(second.onCommit).toHaveBeenCalledWith('新名');
  });

  it('selectEnd 只选中主名（不含扩展名）', () => {
    const { input } = setup({ selectEnd: 3 });
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 3]);
  });
});

describe('正文树行内重命名', () => {
  const volume: FileNode = {
    name: '第一卷',
    path: '/p/v1',
    type: 'directory',
    children: [{ name: '第一章.md', path: '/p/v1/c1.md', type: 'file' }],
  };

  it('选中的章按 F2 进入重命名，Esc 取消后焦点回到行；其他按键交给行处理', () => {
    const tree = makeTree({ expandedStoryDirs: new Set(['/p/v1']) });
    render(<StoryTreeNode node={volume} parentPath="/p" tree={tree} />);
    const row = rowOf('第一章');
    expect(row.getAttribute('aria-keyshortcuts')).toBe('F2');
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(tree.onRowKeyDown).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(row, { key: 'F2' });
    const input = screen.getByLabelText('重命名 第一章');
    // 编辑期间不能拖拽
    expect(row.getAttribute('draggable')).toBe('false');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByLabelText('重命名 第一章')).toBeNull();
    expect(tree.onRenameNode).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(rowOf('第一章'));
    expect(tree.onRowKeyDown).toHaveBeenCalledTimes(1);
  });

  it('双击卷名重命名，失焦提交', () => {
    const tree = makeTree();
    render(<StoryTreeNode node={volume} parentPath="/p" tree={tree} />);
    fireEvent.doubleClick(screen.getByText('第一卷'));
    const input = screen.getByLabelText('重命名 第一卷');
    fireEvent.change(input, { target: { value: '第一卷-离乡' } });
    fireEvent.blur(input);
    expect(tree.onRenameNode).toHaveBeenCalledWith('/p/v1', '第一卷-离乡');
  });
});

describe('ObjectItemRow 行内重命名', () => {
  it('F2 进入，Enter 提交；未提供 onRename 时双击与 F2 都不进入编辑', () => {
    const onRename = vi.fn();
    const { rerender } = render(
      <ObjectItemRow
        kindLabel="设定"
        title="星河大陆"
        meta="世界观"
        icon={<i />}
        active={false}
        onOpen={vi.fn()}
        onRename={onRename}
        onContextMenu={vi.fn()}
      />
    );
    fireEvent.keyDown(rowOf('星河大陆'), { key: 'F2' });
    const input = screen.getByLabelText('重命名设定 星河大陆');
    fireEvent.change(input, { target: { value: '星海大陆' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('星海大陆');

    rerender(
      <ObjectItemRow
        kindLabel="成长档案"
        title="林舟"
        badge="Lv.4"
        meta="经验 120"
        icon={<i />}
        active={false}
        onOpen={vi.fn()}
        onContextMenu={vi.fn()}
      />
    );
    fireEvent.doubleClick(screen.getByText('林舟'));
    fireEvent.keyDown(rowOf('林舟'), { key: 'F2' });
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('FileTree 行内重命名', () => {
  const files: FileNode[] = [
    {
      name: '素材',
      path: '/p/资料/素材',
      type: 'directory',
      children: [],
    },
    { name: '地图.png', path: '/p/资料/地图.png', type: 'file' },
  ];

  it('没有铅笔按钮；双击文件名重命名（只选中主名），F2 重命名目录', () => {
    const onRenameNode = vi.fn();
    const onFileSelect = vi.fn();
    render(
      <FileTree
        files={files}
        showFileSizes={false}
        onFileSelect={onFileSelect}
        onRenameNode={onRenameNode}
      />
    );
    expect(screen.queryByLabelText(/^修改 /)).toBeNull();

    fireEvent.doubleClick(screen.getByText('地图.png'));
    const input = screen.getByLabelText('重命名 地图.png') as HTMLInputElement;
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 2]);
    fireEvent.change(input, { target: { value: '星图.png' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRenameNode).toHaveBeenCalledWith('/p/资料/地图.png', '星图.png');
    expect(onFileSelect).not.toHaveBeenCalled();

    const dirRow = screen.getByText('素材').closest('[tabindex]') as HTMLElement;
    fireEvent.keyDown(dirRow, { key: 'F2' });
    const dirInput = screen.getByLabelText('重命名 素材');
    fireEvent.keyDown(dirInput, { key: 'Escape' });
    expect(onRenameNode).toHaveBeenCalledTimes(1);

    // 回车打开文件
    const fileRow = screen.getByText('地图.png').closest('[tabindex]') as HTMLElement;
    fireEvent.keyDown(fileRow, { key: 'Enter' });
    expect(onFileSelect).toHaveBeenCalledWith('/p/资料/地图.png');
  });

  it('未提供 onRenameNode 时双击不进入编辑', () => {
    render(<FileTree files={files} showFileSizes={false} onFileSelect={vi.fn()} />);
    fireEvent.doubleClick(screen.getByText('地图.png'));
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('WorkspaceHeader 布局与项目名重命名', () => {
  const noop = () => {};
  function renderHeader(overrides: Partial<React.ComponentProps<typeof WorkspaceHeader>> = {}) {
    const props: React.ComponentProps<typeof WorkspaceHeader> = {
      workspaceLabel: '示例作品集',
      folderPath: '/p',
      isWorkspaceBusy: false,
      isLoading: false,
      showSearch: false,
      quickOpenShortcut: 'Mod+P',
      createMenuItems: buildCreateMenuItems({
        onCreateVolume: noop,
        onCreateChapter: noop,
        onCreateDraftFolder: noop,
        onCreateDraft: noop,
        onCreateCharacter: noop,
        onCreateLoreEntry: noop,
        onCreateMaterialDirectory: noop,
      }),
      createMenuOpen: false,
      onCreateMenuOpenChange: vi.fn(),
      onRenameProject: vi.fn(),
      onOpenFolder: vi.fn(),
      onToggleSearch: vi.fn(),
      onCollapse: vi.fn(),
      onRefresh: vi.fn(),
      onContextMenu: vi.fn(),
      ...overrides,
    };
    const view = render(<WorkspaceHeader {...props} />);
    return { props, ...view };
  }

  it('头部：项目名 | 搜索 / 新建 / ⋯ 更多 | 折叠侧边栏（最右侧，与其他操作之间有分隔）', () => {
    const { container, props } = renderHeader();
    const buttons = Array.from(container.querySelectorAll('button')).map(
      (button) => button.getAttribute('data-testid') ?? button.getAttribute('aria-label')
    );
    expect(buttons).toEqual([
      expect.stringMatching(/^搜索文件/),
      '新建',
      'project-menu-trigger',
      '折叠侧边栏',
    ]);
    // ⋯ 在 + 后面
    const more = screen.getByTestId('project-menu-trigger');
    expect(more.getAttribute('aria-label')).toBe(PROJECT_MORE_LABEL);
    expect(more.textContent).toBe('');
    const collapse = screen.getByLabelText('折叠侧边栏');
    expect(collapse.parentElement?.previousElementSibling?.getAttribute('aria-hidden')).toBe(
      'true'
    );
    fireEvent.click(collapse);
    expect(props.onCollapse).toHaveBeenCalled();
    for (const label of ['修改作品名', '更换文件夹', '重新扫描作品目录']) {
      expect(screen.queryByLabelText(label)).toBeNull();
    }
    // 项目说明不在头部
    expect(screen.queryByText('项目说明')).toBeNull();
  });

  it('项目名是普通标题（不是下拉）；⋯ 单击打开 / 关闭项目菜单', () => {
    renderHeader();
    const name = screen.getByTestId('project-name');
    expect(name.tagName).toBe('SPAN');
    expect(name.textContent).toBe('示例作品集');
    fireEvent.click(name);
    expect(screen.queryByRole('menu', { name: '项目菜单' })).toBeNull();
    const trigger = screen.getByTestId('project-menu-trigger');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: '项目菜单' })).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu', { name: '项目菜单' })).toBeNull();
  });

  it('双击项目名进入行内重命名：Enter 提交、Esc 取消（焦点回到项目名）、F2、失焦提交', async () => {
    const { props } = renderHeader();
    const name = () => screen.getByTestId('project-name');

    fireEvent.doubleClick(name());
    expect(screen.queryByRole('menu', { name: '项目菜单' })).toBeNull();
    let input = screen.getByLabelText('重命名项目') as HTMLInputElement;
    expect(input.value).toBe('示例作品集');
    fireEvent.change(input, { target: { value: '我的作品集' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onRenameProject).toHaveBeenCalledWith('我的作品集');
    expect(screen.queryByLabelText('重命名项目')).toBeNull();

    fireEvent.doubleClick(name());
    input = screen.getByLabelText('重命名项目') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '不要' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(props.onRenameProject).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.activeElement).toBe(name()));

    fireEvent.keyDown(name(), { key: 'F2' });
    input = screen.getByLabelText('重命名项目') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '失焦提交' } });
    fireEvent.blur(input);
    expect(props.onRenameProject).toHaveBeenLastCalledWith('失焦提交');
  });

  it('⋯ →「重命名项目」进入行内编辑；切换作品中不可重命名', () => {
    renderHeader();
    fireEvent.click(screen.getByTestId('project-menu-trigger'));
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名项目' }));
    expect(screen.getByLabelText('重命名项目')).toBeTruthy();
  });

  it('切换作品中：双击 / F2 不进入重命名', () => {
    renderHeader({ isWorkspaceBusy: true });
    fireEvent.doubleClick(screen.getByTestId('project-name'));
    fireEvent.keyDown(screen.getByTestId('project-name'), { key: 'F2' });
    expect(screen.queryByLabelText('重命名项目')).toBeNull();
  });
});

describe('ProjectDocsSection（项目说明）', () => {
  const docs: FileNode[] = [
    { name: '欢迎使用.md', path: '/p/欢迎使用.md', type: 'file' },
    { name: '排版示例.md', path: '/p/排版示例.md', type: 'file' },
  ];

  it('默认折叠只占一行（带数量与说明）；展开后点击 / Enter 打开，右键走文件菜单', () => {
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    const onDocContextMenu = vi.fn();
    const { rerender } = render(
      <ProjectDocsSection
        docs={docs}
        selectedFile="/p/排版示例.md"
        collapsed
        onToggle={onToggle}
        onOpen={onOpen}
        onDocContextMenu={onDocContextMenu}
      />
    );
    const region = screen.getByRole('region', { name: '项目说明' });
    const header = within(region).getByRole('button', { name: /项目说明/ });
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(header.getAttribute('title')).toBe(PROJECT_DOCS_HINT);
    expect(header.textContent).toContain('2');
    expect(within(region).queryByRole('listitem')).toBeNull();
    fireEvent.click(header, { detail: 1 });
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <ProjectDocsSection
        docs={docs}
        selectedFile="/p/排版示例.md"
        collapsed={false}
        onToggle={onToggle}
        onOpen={onOpen}
        onDocContextMenu={onDocContextMenu}
      />
    );
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['欢迎使用', '排版示例']);
    expect(items[1].className).toContain('rowActive');
    fireEvent.click(items[0]);
    expect(onOpen).toHaveBeenCalledWith('/p/欢迎使用.md');
    fireEvent.keyDown(items[1], { key: 'Enter' });
    expect(onOpen).toHaveBeenLastCalledWith('/p/排版示例.md');
    fireEvent.contextMenu(items[1]);
    expect(onDocContextMenu).toHaveBeenCalledWith(expect.objectContaining({ node: docs[1] }));
  });

  it('没有根目录文档时不渲染', () => {
    const { container } = render(
      <ProjectDocsSection
        docs={[]}
        selectedFile={null}
        collapsed={false}
        onToggle={vi.fn()}
        onOpen={vi.fn()}
      />
    );
    expect(container.innerHTML).toBe('');
  });
});

describe('ProjectMenu（项目菜单）', () => {
  function Harness(props: Partial<React.ComponentProps<typeof ProjectMenu>>) {
    return (
      <ProjectMenu
        folderPath="/p"
        canRename
        onStartRename={vi.fn()}
        onOpenFolder={vi.fn()}
        onOpenRecentFolder={vi.fn()}
        onRefresh={vi.fn()}
        onReveal={vi.fn()}
        loadRecentFolders={async () => ['/p', '/books/剑与诗', '/books/旧稿']}
        platform="MacIntel"
        {...props}
      />
    );
  }

  function openMenu() {
    fireEvent.click(screen.getByTestId('project-menu-trigger'));
    return screen.getByRole('menu', { name: '项目菜单' });
  }

  it('纯函数：平台文案、最近使用过滤当前文件夹、文件夹名', () => {
    expect(getRevealInFileManagerLabel('MacIntel')).toBe('在访达中显示');
    expect(getRevealInFileManagerLabel('Win32')).toBe('在资源管理器中显示');
    expect(getRevealInFileManagerLabel('Linux x86_64')).toBe('在文件管理器中显示');
    expect(pickRecentFolders(['/a', '/p', '/b', ''], '/p')).toEqual(['/a', '/b']);
    expect(pickRecentFolders(['/1', '/2', '/3'], null, 2)).toEqual(['/1', '/2']);
    expect(folderBaseName('/books/剑与诗/')).toBe('剑与诗');
    expect(folderBaseName('C:\\书\\旧稿')).toBe('旧稿');
  });

  it('菜单项顺序：在访达中显示、重命名项目 | 打开其他文件夹…、打开最近使用、刷新（不含项目说明）', () => {
    render(<Harness />);
    const menu = openMenu();
    const names = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(names).toEqual([
      '在访达中显示',
      '重命名项目F2',
      expect.stringMatching(/^打开其他文件夹…/),
      '打开最近使用',
      '刷新',
    ]);
    expect(within(menu).queryByText('项目说明')).toBeNull();
    expect(within(menu).getAllByRole('separator')).toHaveLength(1);
  });

  it('在访达中显示 / 打开其他文件夹 / 刷新 / 重命名 各自触发并关闭菜单', () => {
    const onReveal = vi.fn();
    const onOpenFolder = vi.fn();
    const onRefresh = vi.fn();
    const onStartRename = vi.fn();
    render(
      <Harness
        onReveal={onReveal}
        onOpenFolder={onOpenFolder}
        onRefresh={onRefresh}
        onStartRename={onStartRename}
        platform="Win32"
      />
    );
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: '在资源管理器中显示' }));
    expect(onReveal).toHaveBeenCalledWith('/p');
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: '打开其他文件夹…' }));
    expect(onOpenFolder).toHaveBeenCalledTimes(1);
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: '刷新' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: '重命名项目' }));
    expect(onStartRename).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('打开最近使用：展开列表（排除当前文件夹），点击按路径打开', async () => {
    const onOpenRecentFolder = vi.fn();
    render(<Harness onOpenRecentFolder={onOpenRecentFolder} />);
    const menu = openMenu();
    const toggle = within(menu).getByRole('menuitem', { name: '打开最近使用' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const group = await screen.findByRole('group', { name: '最近使用' });
    await waitFor(() => expect(within(group).getAllByRole('menuitem')).toHaveLength(2));
    expect(group.textContent).not.toContain('/p/');
    fireEvent.click(within(group).getByTitle('/books/剑与诗'));
    expect(onOpenRecentFolder).toHaveBeenCalledWith('/books/剑与诗');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('没有最近使用时显示禁用的占位项', async () => {
    render(<Harness loadRecentFolders={async () => ['/p']} />);
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: '打开最近使用' }));
    const placeholder = await screen.findByText('无最近使用的文件夹');
    expect((placeholder.closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('键盘：Enter 打开并聚焦第一项，↑ / ↓ / Home / End 循环移动，Esc 关闭并还焦点', () => {
    render(<Harness />);
    const trigger = screen.getByTestId('project-menu-trigger');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const menu = screen.getByRole('menu', { name: '项目菜单' });
    const items = within(menu).getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(document.activeElement as Element, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document.activeElement as Element, { key: 'End' });
    expect(document.activeElement?.textContent).toBe('刷新');
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('键盘：↓ / ↑ 打开并聚焦首 / 末项，Space 切换；→ 展开最近使用、← 收起', async () => {
    render(<Harness />);
    const trigger = screen.getByTestId('project-menu-trigger');
    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    expect(document.activeElement?.textContent).toBe('刷新');
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('在访达中显示');
    fireEvent.keyDown(document.activeElement as Element, { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.keyDown(trigger, { key: ' ' });
    const toggle = screen.getByRole('menuitem', { name: '打开最近使用' });
    toggle.focus();
    fireEvent.keyDown(toggle, { key: 'ArrowRight' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() =>
      expect((document.activeElement as HTMLElement).hasAttribute('data-recent-item')).toBe(true)
    );
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowLeft' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });

  it('不可重命名时「重命名项目」禁用', () => {
    render(<Harness canRename={false} />);
    const rename = within(openMenu()).getByRole('menuitem', { name: '重命名项目' });
    expect((rename as HTMLButtonElement).disabled).toBe(true);
  });
});
