// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useContextMenuItems,
  type UseContextMenuItemsContext,
} from '@/render/hooks/useContextMenuItems';
import type { FileNode } from '@/render/types';
import { REFERENCE_OPEN_EVENT, type OpenReferenceDetail } from '@/render/utils/referencePane';

/** 除数据字段外，其余回调一律用 vi.fn() 占位 */
function setup(node: FileNode | null, overrides: Record<string, unknown> = {}) {
  const handlers = new Map<string, ReturnType<typeof vi.fn>>();
  const data: Record<string, unknown> = {
    contextMenu: { x: 0, y: 0, target: { kind: 'file', node } },
    folderPath: '/p',
    workspaceCharacters: [],
    workspaceLoreEntries: [],
    chapterAssistantEnabled: false,
    materialFiles: [],
    linkedMaterialFiles: [],
    ...overrides,
  };
  const ctx = new Proxy(data, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (!handlers.has(key)) handlers.set(key, vi.fn());
      return handlers.get(key);
    },
  }) as unknown as UseContextMenuItemsContext;
  const { result } = renderHook(() => useContextMenuItems(ctx));
  return { items: result.current.contextMenuItems, handlers };
}

describe('useContextMenuItems', () => {
  it.each<FileNode>([
    { name: '001-启程.md', path: '/p/novels/001-启程.md', type: 'file' },
    { name: '星河旅人', path: '/p/novels/星河旅人', type: 'directory', children: [] },
  ])('文件 / 文件夹菜单提供「重命名」($type)', (node) => {
    const { items, handlers } = setup(node);
    const rename = items.find((item) => item.label === '重命名');
    expect(rename).toBeDefined();
    rename?.onClick();
    expect(handlers.get('handleRename')).toHaveBeenCalledWith(node.path);
  });

  it('资料文件菜单可「关联到当前章」/「从当前章移除」（仅在打开章节时）', () => {
    const node: FileNode = { name: '地图.png', path: '/p/资料/地图.png', type: 'file' };
    const material = { path: node.path, name: node.name };
    const linkable = setup(node, { chapterAssistantEnabled: true, materialFiles: [material] });
    linkable.items.find((item) => item.label === '关联到当前章')?.onClick();
    expect(linkable.handlers.get('handleAddChapterMaterial')).toHaveBeenCalledWith(node.path);

    const linked = setup(node, {
      chapterAssistantEnabled: true,
      materialFiles: [material],
      linkedMaterialFiles: [material],
    });
    linked.items.find((item) => item.label === '从当前章移除')?.onClick();
    expect(linked.handlers.get('handleRemoveChapterMaterial')).toHaveBeenCalledWith(node.path);

    const noChapter = setup(node, { materialFiles: [material] });
    expect(noChapter.items.some((item) => item.label === '关联到当前章')).toBe(false);
  });

  it('人物 / 设定条目菜单提供「重命名」（与双击名称、F2 的行内重命名并存）', () => {
    const character = setup(null, {
      contextMenu: {
        x: 0,
        y: 0,
        target: { kind: 'object', target: { kind: 'character-item', characterId: 7 } },
      },
      workspaceCharacters: [{ id: 7, name: '林舟' }],
    });
    character.items.find((item) => item.label === '重命名')?.onClick();
    expect(character.handlers.get('handleRenameCharacterNode')).toHaveBeenCalledWith(7);

    const lore = setup(null, {
      contextMenu: {
        x: 0,
        y: 0,
        target: { kind: 'object', target: { kind: 'lore-item', entryId: 3 } },
      },
      workspaceLoreEntries: [{ id: 3, title: '星河大陆' }],
    });
    lore.items.find((item) => item.label === '重命名')?.onClick();
    expect(lore.handlers.get('handleRenameLoreNode')).toHaveBeenCalledWith(3);
  });

  it.each([
    ['/p/资料/地图.png', '地图.png', 'image'],
    ['/p/资料/视频/镜头1-v1.mp4', '镜头1-v1.mp4', 'video'],
  ] as const)('图片 / 视频文件菜单第一项是「在编辑器旁边打开」（%s）', (filePath, name, kind) => {
    const listener = vi.fn();
    window.addEventListener(REFERENCE_OPEN_EVENT, listener);
    const { items } = setup({ name, path: filePath, type: 'file' });
    expect(items[0].label).toBe('在编辑器旁边打开');
    // 其后是单独导出：图片 PNG / JPEG / WebP，视频只有原格式
    const exportLabels = items
      .slice(1)
      .filter((item) => item.label.startsWith('导出'))
      .map((item) => item.label);
    expect(exportLabels).toEqual(
      kind === 'image' ? ['导出为 PNG…', '导出为 JPEG…', '导出为 WebP…'] : ['导出 MP4…']
    );
    expect(items[1 + exportLabels.length].separator).toBe(true);
    items[0].onClick();
    expect(listener).toHaveBeenCalledTimes(1);
    const detail = (listener.mock.calls[0][0] as CustomEvent<OpenReferenceDetail>).detail;
    expect(detail.items).toEqual([{ path: filePath, title: name, kind }]);
    window.removeEventListener(REFERENCE_OPEN_EVENT, listener);
  });

  it.each<FileNode>([
    { name: '001-启程.md', path: '/p/novels/001-启程.md', type: 'file' },
    { name: '图集.png', path: '/p/资料/图集.png', type: 'directory', children: [] },
  ])('非媒体文件与文件夹没有「在编辑器旁边打开」（$name）', (node) => {
    const { items } = setup(node);
    expect(items.some((item) => item.label === '在编辑器旁边打开')).toBe(false);
    expect(items[0].label).toBe('重命名');
  });
});
