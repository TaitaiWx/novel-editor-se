// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { FileNode } from '@/render/types';
import InlineRenameInput from '@/render/components/InlineRenameInput';
import StoryTreeNode, { type StoryTreeContext } from '@/render/components/FilePanel/StoryTreeNode';
import ObjectItemRow from '@/render/components/FilePanel/ObjectItemRow';
import WorkspaceHeader, {
  buildCreateMenuItems,
} from '@/render/components/FilePanel/WorkspaceHeader';
import ProjectDocsButton, {
  PROJECT_DOCS_HINT,
} from '@/render/components/FilePanel/ProjectDocsButton';
import FileTree from '@/render/components/FileTree';

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
      isWorkspaceBusy: false,
      isLoading: false,
      hasFolder: true,
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

  it('折叠侧边栏按钮在最右侧（刷新之后），与其他操作之间有分隔', () => {
    const { container, props } = renderHeader();
    const buttons = Array.from(container.querySelectorAll('button')).map((button) =>
      button.getAttribute('aria-label')
    );
    expect(buttons).toEqual([
      '更换文件夹',
      expect.stringMatching(/^搜索文件/),
      '新建',
      '重新扫描作品目录',
      '折叠侧边栏',
    ]);
    const collapse = screen.getByLabelText('折叠侧边栏');
    expect(collapse.parentElement?.previousElementSibling?.getAttribute('aria-hidden')).toBe(
      'true'
    );
    fireEvent.click(collapse);
    expect(props.onCollapse).toHaveBeenCalled();
    // 不再有铅笔按钮
    expect(screen.queryByLabelText('修改作品名')).toBeNull();
  });

  it('双击项目名进入行内重命名：Enter 提交、Esc 取消、失焦提交', () => {
    const { props } = renderHeader();
    const name = screen.getByLabelText('项目名 示例作品集，双击或按 F2 重命名');
    expect(name.textContent).toBe('示例作品集');

    fireEvent.doubleClick(name);
    let input = screen.getByLabelText('重命名项目') as HTMLInputElement;
    expect(input.value).toBe('示例作品集');
    fireEvent.change(input, { target: { value: '我的作品集' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onRenameProject).toHaveBeenCalledWith('我的作品集');
    expect(screen.queryByLabelText('重命名项目')).toBeNull();

    fireEvent.doubleClick(screen.getByText('示例作品集'));
    input = screen.getByLabelText('重命名项目') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '不要' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(props.onRenameProject).toHaveBeenCalledTimes(1);
    expect(document.activeElement?.textContent).toBe('示例作品集');

    // 键盘：聚焦项目名后按 F2
    fireEvent.keyDown(screen.getByText('示例作品集'), { key: 'F2' });
    input = screen.getByLabelText('重命名项目') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '失焦提交' } });
    fireEvent.blur(input);
    expect(props.onRenameProject).toHaveBeenLastCalledWith('失焦提交');
  });

  it('项目名旁渲染附加内容（项目说明按钮），编辑时隐藏', () => {
    renderHeader({ identityExtra: <button type="button">项目说明按钮</button> });
    expect(screen.getByText('项目说明按钮')).toBeTruthy();
    fireEvent.doubleClick(screen.getByText('示例作品集'));
    expect(screen.queryByText('项目说明按钮')).toBeNull();
  });
});

describe('ProjectDocsButton', () => {
  const docs: FileNode[] = [
    { name: '欢迎使用.md', path: '/p/欢迎使用.md', type: 'file' },
    { name: '排版示例.md', path: '/p/排版示例.md', type: 'file' },
  ];

  it('没有根目录文档时不渲染', () => {
    const { container } = render(
      <ProjectDocsButton docs={[]} selectedFile={null} onOpen={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('带数量徽标；点击弹出说明与文档列表，点击文档打开并关闭弹层，右键走文件菜单', () => {
    const onOpen = vi.fn();
    const onContextMenu = vi.fn();
    render(
      <ProjectDocsButton
        docs={docs}
        selectedFile="/p/排版示例.md"
        onOpen={onOpen}
        onContextMenu={onContextMenu}
      />
    );
    const trigger = screen.getByLabelText('项目说明（2 个文件）');
    expect(trigger.textContent).toBe('2');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(PROJECT_DOCS_HINT)).toBeTruthy();
    const list = screen.getByRole('list', { name: '项目说明' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('排版示例').closest('button')?.className).toContain('itemActive');

    fireEvent.contextMenu(within(list).getByText('排版示例'));
    expect(onContextMenu).toHaveBeenCalledWith(expect.objectContaining({ node: docs[1] }));

    fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole('list', { name: '项目说明' })).getByText('欢迎使用'));
    expect(onOpen).toHaveBeenCalledWith('/p/欢迎使用.md');
    expect(screen.queryByRole('list', { name: '项目说明' })).toBeNull();
  });
});
