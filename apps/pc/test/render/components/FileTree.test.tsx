// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import FileTree from '@/render/components/FileTree';
import type { FileInfo, FileNode } from '@/render/types';
import { installElectronMock, uninstallElectronMock } from '../hooks/electronMock';

const info = (size: number): FileInfo => ({
  size,
  created: new Date(0),
  modified: new Date(0),
  isDirectory: false,
  isFile: true,
});

const files: FileNode[] = [
  { name: 'z.md', path: '/p/z.md', type: 'file' },
  {
    name: '卷一',
    path: '/p/卷一',
    type: 'directory',
    children: [
      { name: 'b.txt', path: '/p/卷一/b.txt', type: 'file' },
      {
        name: '子目录',
        path: '/p/卷一/子目录',
        type: 'directory',
        children: [{ name: 'deep.json', path: '/p/卷一/子目录/deep.json', type: 'file' }],
      },
      { name: 'a.ts', path: '/p/卷一/a.ts', type: 'file' },
    ],
  },
  { name: 'a.js', path: '/p/a.js', type: 'file' },
  { name: 'x.py', path: '/p/x.py', type: 'file' },
  { name: 'y.css', path: '/p/y.css', type: 'file' },
  { name: 'k.html', path: '/p/k.html', type: 'file' },
  { name: 'c.tsx', path: '/p/c.tsx', type: 'file' },
  { name: 'noext', path: '/p/noext', type: 'file' },
];

const sizes: Record<string, number> = {
  '/p/z.md': 0,
  '/p/a.js': 512,
  '/p/x.py': 2048,
  '/p/y.css': 3 * 1024 * 1024,
  '/p/卷一/b.txt': 10,
  '/p/卷一/a.ts': 20,
};

function mockInfo() {
  return installElectronMock((channel, paths) => {
    if (channel === 'get-file-info-batch') {
      return (paths as string[])
        .filter((p) => p in sizes)
        .map((p) => ({ path: p, info: info(sizes[p]) }));
    }
    return undefined;
  });
}

afterEach(() => {
  uninstallElectronMock();
  vi.useRealTimers();
});

const names = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.itemName')).map((el) => el.textContent);

describe('FileTree', () => {
  it('目录优先 + 名称排序，展示文件大小', async () => {
    const mock = mockInfo();
    const { container } = render(<FileTree files={files} onFileSelect={vi.fn()} />);
    expect(names(container)[0]).toBe('卷一');
    expect(names(container)).not.toContain('b.txt');
    expect(await screen.findByText('512 B')).toBeTruthy();
    expect(screen.getByText('0 B')).toBeTruthy();
    expect(screen.getByText('2 KB')).toBeTruthy();
    expect(screen.getByText('3 MB')).toBeTruthy();
    expect(mock.invoke).toHaveBeenCalledWith('get-file-info-batch', expect.any(Array));
    // 各类型图标 class
    for (const cls of ['md', 'js', 'py', 'css', 'html', 'jsx', 'file', 'folder']) {
      expect(container.querySelector(`.fileIcon.${cls}`)).toBeTruthy();
    }
  });

  it('点击目录展开/折叠，点击文件触发 onFileSelect', async () => {
    const mock = mockInfo();
    const onFileSelect = vi.fn();
    const { container } = render(<FileTree files={files} onFileSelect={onFileSelect} />);
    await screen.findByText('512 B');

    fireEvent.click(screen.getByText('卷一'));
    const n = names(container);
    expect(n.slice(1, 4)).toEqual(['子目录', 'a.ts', 'b.txt']);
    expect(container.querySelector('.expandIcon.expanded')).toBeTruthy();
    expect(onFileSelect).not.toHaveBeenCalled();
    expect(await screen.findByText('20 B')).toBeTruthy();
    // 只请求新可见的文件
    const lastCall = mock.invoke.mock.calls.at(-1);
    expect(lastCall?.[1]).toEqual(expect.arrayContaining(['/p/卷一/a.ts', '/p/卷一/b.txt']));
    expect(lastCall?.[1]).not.toContain('/p/a.js');

    fireEvent.click(screen.getByText('子目录'));
    expect(screen.getByText('deep.json')).toBeTruthy();
    expect(container.querySelector('.fileIcon.json')).toBeTruthy();
    expect(container.querySelector('.fileIcon.txt')).toBeTruthy();
    expect(container.querySelector('.fileIcon.ts')).toBeTruthy();

    fireEvent.click(screen.getByText('a.ts'));
    expect(onFileSelect).toHaveBeenCalledWith('/p/卷一/a.ts');

    fireEvent.click(screen.getByText('卷一'));
    expect(screen.queryByText('a.ts')).toBeNull();
    await waitFor(() => expect(screen.queryByText('20 B')).toBeNull());
  });

  it('选中态、itemMeta、修改按钮', () => {
    installElectronMock(() => []);
    const onRenameNode = vi.fn();
    const onFileSelect = vi.fn();
    const { container } = render(
      <FileTree
        files={files}
        showFileSizes={false}
        selectedFile="/p/a.js"
        itemMetaMap={{ '/p/a.js': '1200 字' }}
        onFileSelect={onFileSelect}
        onRenameNode={onRenameNode}
      />
    );
    expect(container.querySelector('.selected')?.textContent).toContain('a.js');
    expect(screen.getByText('1200 字')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '修改 a.js' }));
    expect(onRenameNode).toHaveBeenCalledWith('/p/a.js');
    expect(onFileSelect).not.toHaveBeenCalled();
  });

  it('关闭 showFileSizes / showExpandIcon / fill', () => {
    const mock = installElectronMock(() => []);
    const { container } = render(
      <FileTree
        files={files}
        fill={false}
        showFileSizes={false}
        showExpandIcon={false}
        baseIndent={2}
        onFileSelect={vi.fn()}
      />
    );
    expect(mock.invoke).not.toHaveBeenCalled();
    expect(container.querySelector('.expandIcon')).toBeNull();
    expect(container.querySelector('.fileTree.fill')).toBeNull();
    expect((container.querySelector('.itemHeader') as HTMLElement).style.paddingLeft).toBe('2px');
  });

  it('右键节点与背景分别回调', () => {
    installElectronMock(() => []);
    const onContextMenu = vi.fn();
    const onBackgroundContextMenu = vi.fn();
    const { container } = render(
      <FileTree
        files={files}
        showFileSizes={false}
        onFileSelect={vi.fn()}
        onContextMenu={onContextMenu}
        onBackgroundContextMenu={onBackgroundContextMenu}
      />
    );
    fireEvent.contextMenu(screen.getByText('a.js'), { clientX: 5, clientY: 6 });
    expect(onContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({ x: 5, y: 6, node: expect.objectContaining({ path: '/p/a.js' }) })
    );
    expect(onBackgroundContextMenu).not.toHaveBeenCalled();
    fireEvent.contextMenu(container.firstChild as HTMLElement, { clientX: 1, clientY: 2 });
    expect(onBackgroundContextMenu).toHaveBeenCalledWith({ x: 1, y: 2 });
  });

  it('revealPath 自动展开祖先目录', () => {
    installElectronMock(() => []);
    render(
      <FileTree
        files={files}
        showFileSizes={false}
        onFileSelect={vi.fn()}
        revealPath="/p/卷一/子目录/deep.json"
      />
    );
    expect(screen.getByText('deep.json')).toBeTruthy();
  });

  it('根目录内联创建：Enter 提交、Escape 取消、blur 取消、IME 忽略', () => {
    vi.useFakeTimers();
    installElectronMock(() => []);
    const onInlineCreate = vi.fn();
    const onCancelCreate = vi.fn();
    render(
      <FileTree
        files={files}
        showFileSizes={false}
        onFileSelect={vi.fn()}
        creatingType="file"
        onInlineCreate={onInlineCreate}
        onCancelCreate={onCancelCreate}
      />
    );
    const input = screen.getByPlaceholderText('文件名') as HTMLInputElement;
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(document.activeElement).toBe(input);

    // 空值 Enter 不提交
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onInlineCreate).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '  新章节.md ' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(onInlineCreate).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onInlineCreate).toHaveBeenCalledWith('file', '新章节.md');
    // 提交后 blur 不触发取消
    fireEvent.blur(input);
    expect(onCancelCreate).not.toHaveBeenCalled();
  });

  it('内联创建取消路径', () => {
    installElectronMock(() => []);
    const onCancelCreate = vi.fn();
    const { rerender } = render(
      <FileTree
        files={files}
        showFileSizes={false}
        onFileSelect={vi.fn()}
        creatingType="directory"
        onInlineCreate={vi.fn()}
        onCancelCreate={onCancelCreate}
      />
    );
    const input = screen.getByPlaceholderText('目录名');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCancelCreate).toHaveBeenCalledTimes(1);
    fireEvent.blur(input);
    expect(onCancelCreate).toHaveBeenCalledTimes(2);

    // 选中根节点时，输入框出现在该节点之后
    rerender(
      <FileTree
        files={files}
        showFileSizes={false}
        onFileSelect={vi.fn()}
        selectedFile="/p/a.js"
        creatingType="directory"
        onInlineCreate={vi.fn()}
        onCancelCreate={onCancelCreate}
      />
    );
    const inputs = screen.getAllByPlaceholderText('目录名');
    expect(inputs).toHaveLength(1);
    const header = screen.getByText('a.js').closest('.fileTreeItem') as HTMLElement;
    expect(header.nextElementSibling?.querySelector('input')).toBe(inputs[0]);
  });

  it('在子目录内联创建：自动展开目标目录并提交', () => {
    installElectronMock(() => []);
    const onInlineCreate = vi.fn();
    render(
      <FileTree
        files={files}
        showFileSizes={false}
        onFileSelect={vi.fn()}
        creatingType="file"
        createTargetPath="/p/卷一/子目录"
        onInlineCreate={onInlineCreate}
        onCancelCreate={vi.fn()}
      />
    );
    expect(screen.getByText('deep.json')).toBeTruthy();
    const input = screen.getByPlaceholderText('文件名');
    fireEvent.change(input, { target: { value: 'n.md' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onInlineCreate).toHaveBeenCalledWith('file', 'n.md');
  });

  it('get-file-info-batch 失败时静默', async () => {
    const mock = installElectronMock(() => {
      throw new Error('x');
    });
    render(<FileTree files={files} onFileSelect={vi.fn()} />);
    await waitFor(() => expect(mock.invoke).toHaveBeenCalled());
    expect(screen.queryByText('512 B')).toBeNull();
  });

  it('空列表 + 切换 showFileSizes 清空缓存', async () => {
    mockInfo();
    const { rerender } = render(<FileTree files={files} onFileSelect={vi.fn()} />);
    await screen.findByText('512 B');
    rerender(<FileTree files={files} showFileSizes={false} onFileSelect={vi.fn()} />);
    expect(screen.queryByText('512 B')).toBeNull();
    rerender(<FileTree files={[]} onFileSelect={vi.fn()} />);
    expect(screen.queryByText('a.js')).toBeNull();
  });
});
