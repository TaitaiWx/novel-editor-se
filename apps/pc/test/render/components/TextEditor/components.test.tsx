// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EditorFileHeader, {
  getSaveStatusLabel,
} from '@/render/components/TextEditor/EditorFileHeader';
import TextEditor from '@/render/components/TextEditor';
import { ToastProvider } from '@/render/components/Toast';
import { EditorView } from '@codemirror/view';

describe('getSaveStatusLabel', () => {
  it('按优先级返回保存状态', () => {
    const date = new Date(2024, 0, 1, 8, 30, 0);
    expect(getSaveStatusLabel(true, true, date)).toBe('保存中...');
    expect(getSaveStatusLabel(false, true, date)).toBe('未保存');
    expect(getSaveStatusLabel(false, false, date)).toBe(date.toLocaleTimeString());
    expect(getSaveStatusLabel(false, false, null)).toBe('已保存');
  });
});

describe('EditorFileHeader', () => {
  const baseProps = {
    fileName: '第一章.md',
    language: 'markdown',
    hasChanges: true,
    isLargeFile: true,
    readOnly: false,
    isChangelog: false,
    autoSaving: false,
    lastSaved: null,
    onSave: vi.fn(),
  };

  it('显示文件信息、未保存标记与保存按钮', () => {
    render(<EditorFileHeader {...baseProps} settingsComponent={<span>设置</span>} />);
    expect(screen.getByText('第一章.md')).toBeTruthy();
    expect(screen.getByText('*')).toBeTruthy();
    expect(screen.getByText('markdown')).toBeTruthy();
    expect(screen.getByText('大文件')).toBeTruthy();
    expect(screen.getByText('未保存')).toBeTruthy();
    expect(screen.getByText('设置')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('保存'));
    expect(baseProps.onSave).toHaveBeenCalled();
  });

  it('只读或更新日志时隐藏保存相关元素', () => {
    const { rerender } = render(<EditorFileHeader {...baseProps} readOnly />);
    expect(screen.queryByLabelText('保存')).toBeNull();
    expect(screen.queryByText('未保存')).toBeNull();
    rerender(<EditorFileHeader {...baseProps} isChangelog hasChanges={false} />);
    expect(screen.queryByLabelText('保存')).toBeNull();
    expect(screen.getByText('已保存')).toBeTruthy();
  });

  it('保存中禁用按钮', () => {
    render(<EditorFileHeader {...baseProps} autoSaving />);
    expect((screen.getByLabelText('保存') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('TextEditor', () => {
  const invoke = vi.fn();

  beforeEach(() => {
    invoke.mockReset();
    Object.defineProperty(window, 'electron', {
      value: { ipcRenderer: { invoke } },
      configurable: true,
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'electron');
  });

  it('未选择文件时显示空状态', () => {
    render(
      <ToastProvider>
        <TextEditor filePath={null} />
      </ToastProvider>
    );
    // 显式传入的 title 优先于 variant=file 的内置文案
    expect(screen.getByText('选择文件开始编辑')).toBeTruthy();
    expect(screen.queryByText('文件加载失败')).toBeNull();
  });

  it('加载文件后显示头部与内容', async () => {
    invoke.mockResolvedValue('你好，世界');
    const onContentChange = vi.fn();
    const { container } = render(
      <ToastProvider>
        <TextEditor filePath="/novel/第一章.md" onContentChange={onContentChange} />
      </ToastProvider>
    );
    // 文件名、语言标签与编辑器内容分别异步就绪（语言包懒加载），统一等待，避免覆盖率插桩变慢时偶发失败
    await waitFor(() => {
      expect(screen.getByText('第一章.md')).toBeTruthy();
      expect(screen.getByText('markdown')).toBeTruthy();
      expect(container.querySelector('.cm-content')?.textContent).toContain('你好，世界');
      expect(onContentChange).toHaveBeenCalledWith('你好，世界');
    });
    expect(invoke).toHaveBeenCalledWith('read-file', '/novel/第一章.md', 'UTF-8');
  });

  it('读取失败显示错误态', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    invoke.mockRejectedValue(new Error('boom'));
    render(
      <ToastProvider>
        <TextEditor filePath="/novel/missing.md" />
      </ToastProvider>
    );
    await waitFor(() => expect(screen.getByText('文件加载失败')).toBeTruthy());
    errorSpy.mockRestore();
  });

  it('编辑后切换自动换行 / 只读不重新读盘，未保存的输入不会丢失', async () => {
    invoke.mockResolvedValue('原始内容');
    const renderEditor = (wordWrap: boolean, readOnly: boolean) => (
      <ToastProvider>
        <TextEditor filePath="/novel/第二章.md" wordWrap={wordWrap} readOnly={readOnly} />
      </ToastProvider>
    );
    const { container, rerender } = render(renderEditor(true, false));
    await waitFor(() =>
      expect(container.querySelector('.cm-content')?.textContent).toContain('原始内容')
    );
    const readCalls = () => invoke.mock.calls.filter(([channel]) => channel === 'read-file').length;
    expect(readCalls()).toBe(1);

    const contentDom = container.querySelector('.cm-content') as HTMLElement;
    const view = EditorView.findFromDOM(contentDom);
    expect(view).toBeTruthy();
    view?.dispatch({ changes: { from: view.state.doc.length, insert: '，新增未保存' } });

    rerender(renderEditor(false, false));
    rerender(renderEditor(false, true));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(readCalls()).toBe(1);
    expect(container.querySelector('.cm-content')?.textContent).toContain('原始内容，新增未保存');
  });
});

describe('EditorFileHeader：Markdown 源码 / 实时预览切换', () => {
  const props = {
    fileName: '排版示例.md',
    language: 'markdown',
    hasChanges: false,
    isLargeFile: false,
    readOnly: false,
    isChangelog: false,
    autoSaving: false,
    lastSaved: null,
    onSave: vi.fn(),
  };

  it('非 markdown 文件不显示切换', () => {
    render(<EditorFileHeader {...props} onToggleLivePreview={vi.fn()} />);
    expect(screen.queryByRole('group', { name: 'Markdown 显示方式' })).toBeNull();
  });

  it('点击未选中的一侧才切换', () => {
    const onToggle = vi.fn();
    render(<EditorFileHeader {...props} livePreview onToggleLivePreview={onToggle} />);
    const live = screen.getByRole('button', { name: '实时预览' });
    expect(live.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(live);
    expect(onToggle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '源码' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
