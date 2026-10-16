// @vitest-environment happy-dom
import React, { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ActionButtons,
  EmptyState,
  ErrorState,
  GenerationStatus,
  LoadingSpinner,
  Modal,
  PanelHeader,
  PanelResizer,
  ContextMenu,
  Select,
} from '@novel-editor/ui';
import { isImeComposing } from '@novel-editor/ui/utils/ime';
import { getPathBasename, isPathInside } from '@novel-editor/ui/utils/path';

describe('布局与状态', () => {
  it('文件操作在没有目录或加载时禁用，注入的标题、设置与路径均正常显示', () => {
    const actions = {
      onCreateFile: vi.fn(),
      onCreateDirectory: vi.fn(),
      onRefresh: vi.fn(),
      onOpenFolder: vi.fn(),
    };
    const { rerender } = render(<ActionButtons {...actions} />);
    for (const label of ['创建文件', '创建目录', '刷新']) fireEvent.click(screen.getByTitle(label));
    expect(actions.onCreateFile).not.toHaveBeenCalled();
    expect(actions.onCreateDirectory).not.toHaveBeenCalled();
    expect(actions.onRefresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('选择文件夹'));
    expect(actions.onOpenFolder).toHaveBeenCalledOnce();
    rerender(<ActionButtons {...actions} hasFolder isLoading />);
    fireEvent.click(screen.getByTitle('选择文件夹'));
    expect(actions.onOpenFolder).toHaveBeenCalledOnce();
    rerender(
      <PanelHeader
        title="资料"
        subtitle="当前作品"
        indicator={{ text: '已同步' }}
        settingsComponent={<span>设置入口</span>}
        actions={{ ...actions, hasFolder: true }}
        folderInfo={{ path: 'C:\\作品\\资料\\', fileCount: 12 }}
      />
    );
    expect(screen.getByText('12 项')).toBeTruthy();
    expect(screen.getByText('设置入口')).toBeTruthy();
    for (const label of ['创建文件', '创建目录', '刷新']) fireEvent.click(screen.getByTitle(label));
    expect(actions.onCreateFile).toHaveBeenCalledOnce();
    expect(actions.onCreateDirectory).toHaveBeenCalledOnce();
    expect(actions.onRefresh).toHaveBeenCalledOnce();
    rerender(<PanelHeader title="空资料" folderInfo={{ path: '/', fileCount: 0 }} />);
    expect(screen.queryByText('0 项')).toBeNull();
  });

  it.each(['generic', 'folder', 'file'] as const)(
    '空状态 %s 提供默认说明和可调用操作',
    (variant) => {
      const action = vi.fn();
      const { rerender } = render(
        <EmptyState variant={variant} actionText="创建" onAction={action} />
      );
      expect(screen.getByRole('heading')).toBeTruthy();
      fireEvent.click(screen.getByText('创建'));
      expect(action).toHaveBeenCalledOnce();
      rerender(
        <EmptyState
          title="自定义"
          description="说明"
          icon={<span>图标</span>}
          actions={<span>操作区</span>}
        />
      );
      expect(screen.getByRole('heading').textContent).toBe('自定义');
      expect(screen.getByText('说明')).toBeTruthy();
      expect(screen.getByText('操作区')).toBeTruthy();
    }
  );

  it('错误状态允许重试，加载状态支持隐藏文案', () => {
    const retry = vi.fn();
    const { rerender } = render(<ErrorState message="网络错误" onRetry={retry} />);
    fireEvent.click(screen.getByText('重试'));
    expect(retry).toHaveBeenCalledOnce();
    rerender(<ErrorState title="失败" />);
    expect(screen.queryByText('重试')).toBeNull();
    rerender(<LoadingSpinner />);
    expect(screen.getByText('正在加载...')).toBeTruthy();
    rerender(<LoadingSpinner message="" size="small" />);
    expect(screen.queryByText('正在加载...')).toBeNull();
  });

  it.each([
    ['waiting', '等待生成'],
    ['generating', '生成中'],
    ['done', '已生成'],
    ['failed', '生成失败'],
    ['cancelled', '已取消'],
  ] as const)('生成状态 %s 有正确文案，紧凑模式仍可访问', (phase, text) => {
    const { rerender } = render(<GenerationStatus phase={phase} />);
    expect(screen.getByText(text)).toBeTruthy();
    rerender(<GenerationStatus phase={phase} compact />);
    expect(screen.getByLabelText(text)).toBeTruthy();
    expect(screen.queryByText(text)).toBeNull();
    rerender(<GenerationStatus label="自定义进度" />);
    expect(screen.getByText('自定义进度')).toBeTruthy();
  });

  it('拖拽把手把鼠标事件交给调用方', () => {
    const drag = vi.fn();
    render(<PanelResizer label="调整宽度" onMouseDown={drag} />);
    fireEvent.mouseDown(screen.getByRole('separator', { name: '调整宽度' }), { clientX: 150 });
    expect(drag).toHaveBeenCalledOnce();
    expect(drag.mock.calls[0][0].clientX).toBe(150);
  });

  it('右键菜单位于视口内，禁用操作不执行，外部点击关闭', () => {
    const action = vi.fn(),
      close = vi.fn();
    render(
      <ContextMenu
        x={-100}
        y={-100}
        onClose={close}
        items={[
          { label: '删除', danger: true, onClick: action },
          { label: '不可用', disabled: true, onClick: action },
          { label: '', separator: true, onClick: action },
        ]}
      />
    );
    expect(screen.getByRole('menu').style.left).toBe('8px');
    fireEvent.click(screen.getByText('不可用'));
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('删除'));
    expect(action).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    fireEvent.mouseDown(document.body);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('Modal 内的下拉列表挂在该弹窗内，保持浏览器模态可交互范围', () => {
    render(
      <Modal open title="编辑" onClose={vi.fn()}>
        <Select
          aria-label="状态"
          value="plan"
          onChange={vi.fn()}
          options={[{ value: 'plan', label: '计划' }]}
        />
      </Modal>
    );
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('dialog').contains(screen.getByRole('listbox'))).toBe(true);
  });

  it('Modal 聚焦指定字段，关闭或取消通知调用方，卸载恢复之前焦点', () => {
    const input = createRef<HTMLInputElement>();
    const close = vi.fn();
    const { rerender } = render(
      <>
        <button>打开</button>
        <Modal open={false} title="编辑" onClose={close}>
          内容
        </Modal>
      </>
    );
    const opener = screen.getByText('打开');
    act(() => opener.focus());
    rerender(
      <>
        <button>打开</button>
        <Modal
          open
          title="编辑"
          onClose={close}
          initialFocusRef={input}
          footer={<span>底部操作</span>}
        >
          <input ref={input} aria-label="名称" />
        </Modal>
      </>
    );
    const dialog = screen.getByRole('dialog', { name: '编辑' });
    expect(document.activeElement).toBe(input.current);
    fireEvent.click(screen.getByLabelText('关闭'));
    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
    expect(close).toHaveBeenCalledTimes(2);
    rerender(
      <>
        <button>打开</button>
        <Modal open={false} title="编辑" onClose={close}>
          内容
        </Modal>
      </>
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe('跨平台工具', () => {
  it.each([
    ['/book/chapter.md', 'chapter.md'],
    ['C:\\book\\', 'book'],
    ['', ''],
    ['/', '/'],
  ])('basename %s', (path, name) => expect(getPathBasename(path)).toBe(name));
  it.each([
    ['/book/a', '/book', true],
    ['/book', '/book/', true],
    ['/books', '/book', false],
    ['C:\\book\\a', 'C:\\book', true],
    ['/a', '/', true],
    ['relative', '', false],
    ['/other', '/book', false],
  ])('路径边界 %s / %s', (child, dir, inside) => expect(isPathInside(child, dir)).toBe(inside));
  it('识别浏览器和 React 的输入法组合状态及旧版 229 标志', () => {
    expect(isImeComposing(null)).toBe(false);
    expect(isImeComposing(undefined)).toBe(false);
    expect(isImeComposing({})).toBe(false);
    for (const event of [{ isComposing: true }, { keyCode: 229 }, { which: 229 }]) {
      expect(isImeComposing(event)).toBe(true);
      expect(isImeComposing({ nativeEvent: event })).toBe(true);
    }
  });
});
