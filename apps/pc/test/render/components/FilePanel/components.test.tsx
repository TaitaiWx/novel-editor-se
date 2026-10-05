// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { FileNode } from '@/render/types';
import type { AssistantArtifactGenerationStatus } from '@/render/utils/assistantGeneration';
import StoryTreeNode, { type StoryTreeContext } from '@/render/components/FilePanel/StoryTreeNode';
import SectionHeader from '@/render/components/FilePanel/SectionHeader';
import ObjectItemRow from '@/render/components/FilePanel/ObjectItemRow';
import WorkspaceHeader, {
  buildCreateMenuItems,
} from '@/render/components/FilePanel/WorkspaceHeader';
import SearchBar from '@/render/components/FilePanel/SearchBar';
import CharacterGenerationHint from '@/render/components/FilePanel/CharacterGenerationHint';
import { createVolumeWorkspaceTab } from '@/render/utils/workspace';

const volume: FileNode = {
  name: '第一卷',
  path: '/p/v1',
  type: 'directory',
  children: [
    { name: '第一章.md', path: '/p/v1/c1.md', type: 'file' },
    { name: '草稿.md', path: '/p/v1/d1.md', type: 'file' },
  ],
};

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

/** 通过标题文本找到行级可点击节点 */
const rowOf = (text: string) => screen.getByText(text).closest('[role="button"]') as HTMLElement;

describe('StoryTreeNode', () => {
  it('卷节点显示类型与章/稿统计，折叠时不渲染子节点', () => {
    const tree = makeTree();
    render(<StoryTreeNode node={volume} parentPath="/p" tree={tree} />);
    expect(screen.getByText('卷')).toBeTruthy();
    expect(screen.getByText('1章')).toBeTruthy();
    expect(screen.getByText('1稿')).toBeTruthy();
    expect(screen.queryByText('第一章')).toBeNull();
    fireEvent.click(rowOf('第一卷'));
    expect(tree.onToggleDirectory).toHaveBeenCalledWith('/p/v1');
  });

  it('展开后递归渲染子节点，点击文件触发选择，修改按钮不冒泡', () => {
    const tree = makeTree({
      expandedStoryDirs: new Set(['/p/v1']),
      selectedFile: '/p/v1/c1.md',
    });
    render(<StoryTreeNode node={volume} parentPath="/p" tree={tree} />);
    expect(screen.getByText('第一章')).toBeTruthy();
    expect(screen.getByText('章')).toBeTruthy();
    expect(screen.getByText('稿')).toBeTruthy();

    fireEvent.click(screen.getByText('草稿'));
    expect(tree.onSelectFile).toHaveBeenCalledWith('/p/v1/d1.md');

    fireEvent.click(screen.getByLabelText('修改 第一章'));
    expect(tree.onRenameNode).toHaveBeenCalledWith('/p/v1/c1.md');
    expect(tree.onSelectFile).toHaveBeenCalledTimes(1);
    expect(tree.registerNodeRef).toHaveBeenCalledWith('/p/v1/c1.md', expect.any(HTMLElement));
  });

  it('卷节点右键发出对象菜单事件；未分卷不显示修改按钮', () => {
    const tree = makeTree();
    const synthetic: FileNode = { name: '未分卷', path: '/p', type: 'directory', children: [] };
    render(<StoryTreeNode node={synthetic} parentPath={null} tree={tree} />);
    expect(screen.queryByLabelText('修改 未分卷')).toBeNull();
    fireEvent.contextMenu(rowOf('未分卷'));
    expect(tree.onObjectContextMenu).toHaveBeenCalledWith(expect.anything(), {
      kind: 'volume-item',
      volumePath: '/p',
      isSynthetic: true,
    });
  });

  it('普通目录右键走文件菜单，激活卷与落点样式', () => {
    const tree = makeTree({
      activeWorkspaceTab: createVolumeWorkspaceTab('/p/v1'),
      storyDropTarget: { path: '/p/v1', mode: 'inside' },
    });
    const { container } = render(<StoryTreeNode node={volume} parentPath="/p" tree={tree} />);
    const row = container.querySelector('[role="button"]') as HTMLElement;
    expect(row.className).toContain('storyNodeButtonActive');
    expect(row.className).toContain('storyNodeDropTargetInside');
    // 卷不可拖拽排序
    expect(row.getAttribute('draggable')).toBe('false');

    const group: FileNode = { name: '番外', path: '/p/extra', type: 'directory', children: [] };
    render(<StoryTreeNode node={group} parentPath="/p" tree={tree} />);
    const groupRow = rowOf('番外');
    expect(groupRow.getAttribute('draggable')).toBe('true');
    fireEvent.contextMenu(groupRow);
    expect(tree.onContextMenu).toHaveBeenCalledWith(expect.objectContaining({ node: group }));
  });

  it('文件节点拖拽事件转发给上下文', () => {
    const tree = makeTree();
    const file: FileNode = { name: '第一章.md', path: '/p/c1.md', type: 'file' };
    render(<StoryTreeNode node={file} parentPath="/p" tree={tree} />);
    const row = rowOf('第一章');
    fireEvent.dragStart(row);
    fireEvent.dragOver(row);
    fireEvent.dragEnd(row);
    expect(tree.onDragStart).toHaveBeenCalledWith(expect.anything(), '/p/c1.md', '/p');
    expect(tree.onDragOver).toHaveBeenCalledWith(expect.anything(), '/p/c1.md', '/p', false);
    expect(tree.onDragEnd).toHaveBeenCalled();
  });
});

describe('SectionHeader', () => {
  it('渲染标题、图标与计数，单击切换', () => {
    const onToggle = vi.fn();
    const onContextMenu = vi.fn();
    render(
      <SectionHeader
        title="角色"
        icon={<i data-testid="icon" />}
        count={3}
        active
        singleClickOnly
        onToggle={onToggle}
        onContextMenu={onContextMenu}
      />
    );
    expect(screen.getByTestId('icon')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    const button = screen.getByRole('button');
    expect(button.className).toContain('storyNodeButtonActive');
    fireEvent.click(button, { detail: 1 });
    expect(onToggle).toHaveBeenCalledTimes(1);
    fireEvent.click(button, { detail: 2 });
    expect(onToggle).toHaveBeenCalledTimes(1);
    fireEvent.contextMenu(button);
    expect(onContextMenu).toHaveBeenCalled();
  });

  it('非 singleClickOnly 时双击也切换', () => {
    const onToggle = vi.fn();
    render(<SectionHeader title="资料" onToggle={onToggle} onContextMenu={vi.fn()} />);
    fireEvent.click(screen.getByRole('button'), { detail: 2 });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe('ObjectItemRow', () => {
  it('打开 / 修改 / 删除 / 键盘激活', () => {
    const handlers = {
      onOpen: vi.fn(),
      onRename: vi.fn(),
      onDelete: vi.fn(),
      onContextMenu: vi.fn(),
    };
    const { container } = render(
      <ObjectItemRow
        kindLabel="人物"
        title="林舟"
        meta="主要角色 · 主角"
        icon={<i />}
        active
        {...handlers}
      />
    );
    expect(screen.getByText('主要角色 · 主角')).toBeTruthy();
    expect((container.firstChild as HTMLElement).className).toContain('objectNodeShellActive');

    fireEvent.click(screen.getByText('林舟'));
    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByText('林舟').closest('[role="button"]') as HTMLElement, {
      key: 'Enter',
    });
    expect(handlers.onOpen).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByLabelText('修改人物 林舟'));
    expect(handlers.onRename).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('删除人物 林舟'));
    expect(handlers.onDelete).toHaveBeenCalled();
    expect(handlers.onOpen).toHaveBeenCalledTimes(2);

    fireEvent.contextMenu(container.firstChild as HTMLElement);
    expect(handlers.onContextMenu).toHaveBeenCalled();
  });
});

describe('WorkspaceHeader', () => {
  const noop = () => {};
  const createHandlers = {
    onCreateVolume: vi.fn(),
    onCreateChapter: noop,
    onCreateDraftFolder: noop,
    onCreateDraft: noop,
    onCreateCharacter: noop,
    onCreateLoreEntry: noop,
    onCreateMaterialDirectory: noop,
  };

  it('buildCreateMenuItems：未提供导入回调时禁用导入项', () => {
    const items = buildCreateMenuItems(createHandlers);
    expect(items.map((item) => item.label)).toEqual([
      '新建卷',
      '新建章',
      '新建稿夹',
      '新建稿',
      'divider',
      '新建人物',
      '新建设定',
      'divider',
      '新建资料目录',
      '导入 Word / Excel 文稿',
    ]);
    expect(items[items.length - 1].disabled).toBe(true);
    expect(buildCreateMenuItems({ ...createHandlers, onImportFile: noop }).at(-1)?.disabled).toBe(
      false
    );
  });

  function renderHeader(overrides: Partial<React.ComponentProps<typeof WorkspaceHeader>> = {}) {
    const props: React.ComponentProps<typeof WorkspaceHeader> = {
      workspaceLabel: '我的小说',
      isWorkspaceBusy: false,
      isLoading: false,
      hasFolder: true,
      showSearch: false,
      quickOpenShortcut: 'Mod+P',
      createMenuItems: buildCreateMenuItems(createHandlers),
      createMenuOpen: false,
      onCreateMenuOpenChange: vi.fn(),
      onOpenFolder: vi.fn(),
      onToggleSearch: vi.fn(),
      onRefresh: vi.fn(),
      onContextMenu: vi.fn(),
      ...overrides,
    };
    render(<WorkspaceHeader {...props} />);
    return props;
  }

  it('显示作品名与操作按钮', () => {
    const props = renderHeader({ onRenameProject: vi.fn(), isWorkspaceBusy: true });
    expect(screen.getByText('我的小说')).toBeTruthy();
    expect(screen.getByText('正在切换作品…')).toBeTruthy();
    expect(screen.getByLabelText('更换文件夹')).toBeTruthy();
    expect((screen.getByLabelText('修改作品名') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByLabelText('折叠侧边栏')).toBeNull();

    fireEvent.click(screen.getByLabelText(/搜索文件/));
    expect(props.onToggleSearch).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('重新扫描作品目录'));
    expect(props.onRefresh).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('新建'));
    expect(props.onCreateMenuOpenChange).toHaveBeenCalled();
  });

  it('加载中禁用新建与刷新', () => {
    renderHeader({ isLoading: true, onCollapse: vi.fn() });
    expect((screen.getByLabelText('新建') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('重新扫描作品目录') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText('折叠侧边栏')).toBeTruthy();
  });

  it('菜单展开后点击菜单项会关闭菜单并执行动作', () => {
    const props = renderHeader({ createMenuOpen: true });
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(8);
    fireEvent.click(screen.getByText('新建卷'));
    expect(props.onCreateMenuOpenChange).toHaveBeenCalledWith(false);
    expect(createHandlers.onCreateVolume).toHaveBeenCalled();
  });
});

describe('SearchBar', () => {
  it('输入、清空与 Escape 关闭', () => {
    const onChange = vi.fn();
    const onDismiss = vi.fn();
    const inputRef = React.createRef<HTMLInputElement>();
    const { rerender } = render(
      <SearchBar inputRef={inputRef} value="" onChange={onChange} onDismiss={onDismiss} />
    );
    expect(inputRef.current).toBeInstanceOf(HTMLInputElement);
    expect(screen.queryByText('×')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('搜索作品内容...'), {
      target: { value: '第一' },
    });
    expect(onChange).toHaveBeenCalledWith('第一');

    rerender(
      <SearchBar inputRef={inputRef} value="第一" onChange={onChange} onDismiss={onDismiss} />
    );
    fireEvent.click(screen.getByText('×'));
    expect(onChange).toHaveBeenLastCalledWith('');
    fireEvent.keyDown(screen.getByPlaceholderText('搜索作品内容...'), { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe('CharacterGenerationHint', () => {
  const makeStatus = (state: string) =>
    ({
      artifact: 'characters',
      state,
      scopeKind: 'project',
      scopePath: '/p',
      scopeLabel: '全书',
      message: `状态 ${state}`,
      totalSteps: 4,
      completedSteps: 2,
      resultCount: 0,
      libraryCount: 0,
      createdCount: 0,
      updatedCount: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    }) as unknown as AssistantArtifactGenerationStatus;

  it.each([
    ['running', 'sectionStatusRunning'],
    ['error', 'sectionStatusError'],
    ['empty', 'sectionStatusEmpty'],
    ['success', 'sectionStatusSuccess'],
  ])('状态 %s 使用对应样式', (state, className) => {
    const { container } = render(<CharacterGenerationHint status={makeStatus(state)} />);
    expect(screen.getByText(`状态 ${state}`)).toBeTruthy();
    expect((container.firstChild as HTMLElement).className).toContain(className);
  });
});
