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
});
