// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import LoadingSpinner from '@/render/components/LoadingSpinner';
import ErrorState from '@/render/components/ErrorState';
import { PanelResizer } from '@/render/components/PanelResizer';
import ActionButtons from '@/render/components/ActionButtons';
import PanelHeader from '@/render/components/PanelHeader';

describe('LoadingSpinner', () => {
  it('默认显示“正在加载...”，中等尺寸 40px', () => {
    const { container } = render(<LoadingSpinner />);
    expect(screen.getByText('正在加载...')).toBeTruthy();
    const svg = container.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('width')).toBe('40');
    expect((container.firstChild as HTMLElement).className).toContain('medium');
  });

  it('支持自定义消息与尺寸，空消息时不渲染文字', () => {
    const { container, rerender } = render(<LoadingSpinner message="读取中" size="large" />);
    expect(screen.getByText('读取中')).toBeTruthy();
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('56');
    rerender(<LoadingSpinner message="" size="small" />);
    expect(container.querySelector('p')).toBeNull();
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('28');
  });
});

describe('ErrorState', () => {
  it('默认标题与图标，无消息、无重试按钮', () => {
    render(<ErrorState />);
    expect(screen.getByText('出现错误')).toBeTruthy();
    expect(screen.getByText('!')).toBeTruthy();
    expect(screen.queryByText('重试')).toBeNull();
  });

  it('显示消息并在点击重试时回调', () => {
    const onRetry = vi.fn();
    const { container } = render(
      <ErrorState icon="x" title="加载失败" message="网络错误" size="small" onRetry={onRetry} />
    );
    expect(screen.getByText('网络错误')).toBeTruthy();
    expect((container.firstChild as HTMLElement).className).toContain('small');
    fireEvent.click(screen.getByText('重试'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('PanelResizer', () => {
  it('mousedown 时回调', () => {
    const onMouseDown = vi.fn();
    const { container } = render(<PanelResizer onMouseDown={onMouseDown} />);
    fireEvent.mouseDown(container.firstChild as HTMLElement);
    expect(onMouseDown).toHaveBeenCalledTimes(1);
  });
});

describe('ActionButtons', () => {
  it('只渲染提供了回调的按钮', () => {
    render(<ActionButtons onRefresh={() => {}} />);
    expect(screen.getByTitle('刷新')).toBeTruthy();
    expect(screen.queryByTitle('创建文件')).toBeNull();
    expect(screen.queryByTitle('选择文件夹')).toBeNull();
  });

  it('没有文件夹时禁用文件操作按钮，但打开文件夹可用', () => {
    const onOpenFolder = vi.fn();
    render(
      <ActionButtons
        onCreateFile={() => {}}
        onCreateDirectory={() => {}}
        onRefresh={() => {}}
        onOpenFolder={onOpenFolder}
        folderButtonTitle="打开"
      />
    );
    expect((screen.getByTitle('创建文件') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTitle('创建目录') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTitle('刷新') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTitle('打开'));
    expect(onOpenFolder).toHaveBeenCalled();
  });

  it('有文件夹时按钮可点击并触发回调', () => {
    const fns = { onCreateFile: vi.fn(), onCreateDirectory: vi.fn(), onRefresh: vi.fn() };
    render(<ActionButtons {...fns} hasFolder />);
    fireEvent.click(screen.getByTitle('创建文件'));
    fireEvent.click(screen.getByTitle('创建目录'));
    fireEvent.click(screen.getByTitle('刷新'));
    expect(fns.onCreateFile).toHaveBeenCalled();
    expect(fns.onCreateDirectory).toHaveBeenCalled();
    expect(fns.onRefresh).toHaveBeenCalled();
  });

  it('加载中禁用所有按钮并显示加载图标', () => {
    const { container } = render(
      <ActionButtons onRefresh={() => {}} onOpenFolder={() => {}} hasFolder isLoading />
    );
    expect((screen.getByTitle('刷新') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTitle('选择文件夹') as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('.loadingIcon')).not.toBeNull();
  });
});

describe('PanelHeader', () => {
  it('显示标题、副标题与指示器', () => {
    render(
      <PanelHeader
        title="资源"
        subtitle="共 3 项"
        indicator={{ text: '已同步', type: 'success' }}
      />
    );
    expect(screen.getByText('资源')).toBeTruthy();
    expect(screen.getByText('共 3 项')).toBeTruthy();
    expect(screen.getByText('已同步').className).toContain('success');
  });

  it('指示器默认 info 类型', () => {
    render(<PanelHeader title="t" indicator={{ text: '提示' }} />);
    expect(screen.getByText('提示').className).toContain('info');
  });

  it('显示文件夹名与文件数量，数量为 0 时隐藏计数', () => {
    const { rerender } = render(
      <PanelHeader title="t" folderInfo={{ path: '/Users/me/novel', fileCount: 5 }} />
    );
    expect(screen.getByText('novel').getAttribute('title')).toBe('/Users/me/novel');
    expect(screen.getByText('5 项')).toBeTruthy();
    rerender(<PanelHeader title="t" folderInfo={{ path: '/Users/me/novel', fileCount: 0 }} />);
    expect(screen.queryByText('0 项')).toBeNull();
  });

  // 回归：PanelHeader/index.tsx:37 getFolderName 先用 '/' 拆分，Windows 路径 split('/').pop()
  // 总是返回整个字符串（非空），'\\' 分支永远走不到，导致显示完整路径而非文件夹名。
  it('Windows 路径只显示最后一级文件夹名', () => {
    render(<PanelHeader title="t" folderInfo={{ path: 'C:\\Users\\me\\novel', fileCount: 1 }} />);
    expect(screen.getByTitle('C:\\Users\\me\\novel').textContent).toBe('novel');
  });

  it('传递 actions 给 ActionButtons 并渲染设置组件', () => {
    const onRefresh = vi.fn();
    render(
      <PanelHeader
        title="t"
        actions={{ onRefresh, hasFolder: true }}
        settingsComponent={<span>settings</span>}
      />
    );
    fireEvent.click(screen.getByTitle('刷新'));
    expect(onRefresh).toHaveBeenCalled();
    expect(screen.getByText('settings')).toBeTruthy();
  });
});
