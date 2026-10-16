// @vitest-environment happy-dom
import React, { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InlineRenameInput, { isRenameShortcut } from '@novel-editor/ui/InlineRenameInput';
import ColorPicker from '@novel-editor/ui/ColorPicker';
import DiffEditor from '@novel-editor/ui/DiffEditor';
import DiffText from '@novel-editor/ui/DiffTextInput/DiffText';
import { InlineDiffView } from '@novel-editor/ui/InlineDiffView';

afterEach(() => vi.restoreAllMocks());

describe('行内重命名', () => {
  it('聚焦仅选择文件主名，IME 不提交，Enter 与 blur 不重复提交，恢复焦点', () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    const parentClick = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    render(
      <div onClick={parentClick}>
        <button ref={ref}>原位置</button>
        <InlineRenameInput
          initialValue="旧名.md"
          ariaLabel="重命名"
          selectEnd={2}
          onCommit={commit}
          onCancel={cancel}
          restoreFocusRef={ref}
        />
      </div>
    );
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.selectionEnd).toBe(2);
    fireEvent.click(input);
    expect(parentClick).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: ' 新名.md ' } });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(commit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(commit).toHaveBeenCalledExactlyOnceWith('新名.md');
    expect(cancel).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(ref.current);
  });

  it.each([
    ['', 'Enter'],
    ['旧名', 'Enter'],
    ['新名', 'Escape'],
  ])('取消无效或放弃的改名 %s / %s', (value, key) => {
    const cancel = vi.fn();
    const commit = vi.fn();
    render(
      <InlineRenameInput
        initialValue="旧名"
        ariaLabel="重命名"
        onCommit={commit}
        onCancel={cancel}
      />
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key });
    expect(cancel).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
  });

  it('失焦提交，快捷键只接受没有修饰键的 F2', () => {
    const commit = vi.fn();
    render(
      <InlineRenameInput
        initialValue="旧名"
        ariaLabel="重命名"
        onCommit={commit}
        onCancel={vi.fn()}
      />
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '新名' } });
    fireEvent.blur(screen.getByRole('textbox'));
    expect(commit).toHaveBeenCalledWith('新名');
    const key = { key: 'F2', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
    expect(isRenameShortcut(key as React.KeyboardEvent)).toBe(true);
    for (const modifier of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey'])
      expect(isRenameShortcut({ ...key, [modifier]: true } as React.KeyboardEvent)).toBe(false);
    expect(isRenameShortcut({ ...key, key: 'Enter' } as React.KeyboardEvent)).toBe(false);
  });
});

describe('颜色选择', () => {
  it('只在确认时提交，非法 HEX 阻止提交，RGB 与预设同步', async () => {
    const save = vi.fn();
    render(<ColorPicker value="invalid" onChange={save} preview="林舟" />);
    const trigger = screen.getByLabelText('选择高亮颜色');
    fireEvent.click(trigger);
    const hex = screen.getByLabelText('HEX') as HTMLInputElement;
    expect(hex.value).toBe('#9CDCFE');
    fireEvent.click(screen.getByLabelText('选择 #A2C5AF'));
    expect(hex.value).toBe('#A2C5AF');
    fireEvent.change(screen.getByRole('slider', { name: 'R' }), { target: { value: '255' } });
    expect(hex.value).toBe('#FFC5AF');
    fireEvent.change(hex, { target: { value: 'oops' } });
    expect(hex.getAttribute('aria-invalid')).toBe('true');
    fireEvent.keyDown(hex, { key: 'Enter' });
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(hex, { target: { value: '#aabbcc' } });
    fireEvent.keyDown(hex, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(save).toHaveBeenCalledExactlyOnceWith('#AABBCC');
    expect(document.activeElement).toBe(trigger);
  });

  it('异步保存期间防重复和关闭，失败保留输入允许重试', async () => {
    let reject!: (error: Error) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, fail) => {
            reject = fail;
          })
      )
      .mockResolvedValue(undefined);
    render(<ColorPicker value="#112233" onChange={save} />);
    fireEvent.click(screen.getByLabelText('选择高亮颜色'));
    fireEvent.click(screen.getByText('应用颜色'));
    fireEvent.click(screen.getByText('保存中…'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(save).toHaveBeenCalledOnce();
    await act(async () => reject(new Error('failed')));
    expect(screen.getByRole('alert').textContent).toContain('保存失败');
    fireEvent.click(screen.getByText('应用颜色'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('取消和外部点击丢弃预览，不写入颜色', () => {
    const save = vi.fn();
    render(<ColorPicker value="#112233" onChange={save} />);
    fireEvent.click(screen.getByLabelText('选择高亮颜色'));
    fireEvent.click(screen.getByLabelText('选择 #F0F0F0'));
    fireEvent.click(screen.getByText('取消'));
    fireEvent.click(screen.getByLabelText('选择高亮颜色'));
    expect((screen.getByLabelText('HEX') as HTMLInputElement).value).toBe('#112233');
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
});

describe('差异显示', () => {
  it('DiffText 区分删除/新增，移除基线后恢复纯文本', () => {
    const { container, rerender } = render(<DiffText before="旧称呼" value="新称呼" />);
    expect(container.querySelector('del')?.textContent).toBe('旧');
    expect(container.querySelector('.added')?.textContent).toBe('新');
    rerender(<DiffText value="当前文本" />);
    expect(container.querySelector('del')).toBeNull();
    expect(container.textContent).toBe('当前文本');
  });

  it('行级对比支持采纳、拒绝、复制，只复制修改后的文本，采纳后不能重复应用', async () => {
    const accept = vi.fn(),
      reject = vi.fn();
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const original = Array.from({ length: 20 }, (_, i) => `原文${i}`).join('\n');
    const modified = original.replace('原文10', '新版10');
    const { rerender } = render(
      <InlineDiffView
        original={original}
        modified={modified}
        explanation="更正"
        contextLines={1}
        onAccept={accept}
        onReject={reject}
      />
    );
    expect(screen.getAllByText(/行未变更/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTitle('接受修改，应用到源文件'));
    fireEvent.click(screen.getByTitle('拒绝修改'));
    fireEvent.click(screen.getByTitle('复制修改后文本'));
    await screen.findByText('✓ 已复制');
    expect(copy).toHaveBeenCalledWith(modified);
    expect(accept).toHaveBeenCalledOnce();
    expect(reject).toHaveBeenCalledOnce();
    rerender(
      <InlineDiffView original="" modified="新增" applied onAccept={accept} onReject={reject} />
    );
    expect(screen.queryByTitle('拒绝修改')).toBeNull();
    fireEvent.click(screen.getByTitle('接受修改，应用到源文件'));
    expect(accept).toHaveBeenCalledOnce();
  });

  it('双栏编辑器保持只读，显示实际变更数，更新内容及关闭时清理实例', async () => {
    const accept = vi.fn(),
      close = vi.fn();
    const { container, rerender, unmount } = render(
      <DiffEditor original="旧文" modified="新文" onAccept={accept} onClose={close} />
    );
    await screen.findByText('共1处');
    expect(container.querySelectorAll('.cm-editor')).toHaveLength(2);
    expect(
      [...container.querySelectorAll('.cm-content')].every(
        (el) => el.getAttribute('contenteditable') === 'false'
      )
    ).toBe(true);
    fireEvent.click(screen.getByTitle('下一处变更'));
    fireEvent.click(screen.getByTitle('上一处变更'));
    fireEvent.click(screen.getByTitle('接受修改'));
    fireEvent.click(screen.getByTitle('关闭对比'));
    expect(accept).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    rerender(<DiffEditor original="相同" modified="相同" />);
    expect(screen.getByText('无变更')).toBeTruthy();
    expect((screen.getByTitle('下一处变更') as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelectorAll('.cm-editor')).toHaveLength(2);
    unmount();
    expect(container.querySelector('.cm-editor')).toBeNull();
  });
});
