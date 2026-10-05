// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useContextMenuItems,
  type UseContextMenuItemsContext,
} from '@/render/hooks/useContextMenuItems';
import type { FileNode } from '@/render/types';

/** 除数据字段外，其余回调一律用 vi.fn() 占位 */
function setup(node: FileNode) {
  const handlers = new Map<string, ReturnType<typeof vi.fn>>();
  const data: Record<string, unknown> = {
    contextMenu: { x: 0, y: 0, target: { kind: 'file', node } },
    folderPath: '/p',
    workspaceCharacters: [],
    workspaceLoreEntries: [],
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
});
