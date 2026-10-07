// @vitest-environment happy-dom
/**
 * 资料树「在资料中定位」：展开全部祖先目录 → 滚动到该行 → 高亮；树里暂时没有时请求刷新后继续
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FileTree, { findTreePath } from '@/render/components/FileTree';
import type { FileNode } from '@/render/types';
import { NOVEL_EDITOR_PATH_MIME } from '@/render/utils/referencePane';

const W = '/p/novels/星河旅人/资料';
const VIDEO = `${W}/视频/示例/离港.mp4`;

const tree: FileNode[] = [
  {
    name: '视频',
    path: `${W}/视频`,
    type: 'directory',
    children: [
      {
        name: '示例',
        path: `${W}/视频/示例`,
        type: 'directory',
        children: [{ name: '离港.mp4', path: VIDEO, type: 'file' }],
      },
    ],
  },
  { name: '世界观.md', path: `${W}/世界观.md`, type: 'file' },
];

const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockClear();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function row(path: string): HTMLElement | null {
  return document.querySelector(`[data-path="${path}"]`);
}

describe('FileTree 定位', () => {
  it('findTreePath：兼容分隔符差异，找不到时为 null', () => {
    expect(findTreePath(tree, VIDEO)).toBe(VIDEO);
    expect(findTreePath(tree, VIDEO.replace(/\//g, '\\'))).toBe(VIDEO);
    expect(findTreePath(tree, `${W}/none.png`)).toBeNull();
  });

  it('展开祖先目录、滚动到该行居中、获得焦点并高亮', async () => {
    const { rerender } = render(
      <FileTree files={tree} onFileSelect={vi.fn()} showFileSizes={false} revealRequest={null} />
    );
    expect(row(VIDEO)).toBeNull();
    rerender(
      <FileTree
        files={tree}
        onFileSelect={vi.fn()}
        showFileSizes={false}
        revealRequest={{ path: VIDEO, id: 'r1' }}
      />
    );
    await waitFor(() => expect(row(VIDEO)?.getAttribute('data-revealed')).toBe('true'));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' });
    expect(document.activeElement).toBe(row(VIDEO));
  });

  it('树里暂时没有：请求一次刷新；文件出现后继续定位', async () => {
    const onRevealMissing = vi.fn();
    const empty: FileNode[] = [{ name: '世界观.md', path: `${W}/世界观.md`, type: 'file' }];
    const { rerender } = render(
      <FileTree
        files={empty}
        onFileSelect={vi.fn()}
        showFileSizes={false}
        revealRequest={{ path: VIDEO, id: 'r2' }}
        onRevealMissing={onRevealMissing}
      />
    );
    expect(onRevealMissing).toHaveBeenCalledTimes(1);
    expect(onRevealMissing).toHaveBeenCalledWith(VIDEO);
    rerender(
      <FileTree
        files={[...empty]}
        onFileSelect={vi.fn()}
        showFileSizes={false}
        revealRequest={{ path: VIDEO, id: 'r2' }}
        onRevealMissing={onRevealMissing}
      />
    );
    expect(onRevealMissing).toHaveBeenCalledTimes(1);
    rerender(
      <FileTree
        files={tree}
        onFileSelect={vi.fn()}
        showFileSizes={false}
        revealRequest={{ path: VIDEO, id: 'r2' }}
        onRevealMissing={onRevealMissing}
      />
    );
    await waitFor(() => expect(row(VIDEO)?.getAttribute('data-revealed')).toBe('true'));
  });

  it('文件行可拖出，携带绝对路径（拖到参考窗格）；目录不可拖', () => {
    render(<FileTree files={tree} onFileSelect={vi.fn()} showFileSizes={false} />);
    const file = row(`${W}/世界观.md`) as HTMLElement;
    expect(file.getAttribute('draggable')).toBe('true');
    expect(row(`${W}/视频`)?.getAttribute('draggable')).toBe('false');
    const setData = vi.fn();
    fireEvent.dragStart(file, { dataTransfer: { setData, effectAllowed: 'all' } });
    expect(setData).toHaveBeenCalledWith(NOVEL_EDITOR_PATH_MIME, `${W}/世界观.md`);
    expect(screen.getByText('世界观.md')).toBeTruthy();
  });
});
