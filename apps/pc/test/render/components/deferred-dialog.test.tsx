// @vitest-environment happy-dom
import React, { useEffect, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { deferredDialog } from '@/render/components/deferred-dialog';

interface Props {
  visible: boolean;
  onClose: () => void;
}
function DraftDialog({ visible }: Props) {
  const [draft, setDraft] = useState('');
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (!visible) setClosed(true);
  }, [visible]);
  return visible ? (
    <>
      <input aria-label="草稿" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <span>{closed ? '已关闭过' : '首次打开'}</span>
    </>
  ) : null;
}
const open = (p: Props) => p.visible;

describe('deferred dialogs', () => {
  it('loads only on first open, keeps the draft and delivers the close transition', async () => {
    const load = vi.fn(async () => ({ default: DraftDialog }));
    const Dialog = deferredDialog(load, open);
    const onClose = vi.fn();
    const { rerender } = render(<Dialog visible={false} onClose={onClose} />);
    expect(load).not.toHaveBeenCalled();
    rerender(<Dialog visible onClose={onClose} />);
    await screen.findByLabelText('草稿');
    fireEvent.change(screen.getByLabelText('草稿'), { target: { value: '故事开头' } });
    rerender(<Dialog visible={false} onClose={onClose} />);
    expect(screen.queryByLabelText('草稿')).toBeNull();
    rerender(<Dialog visible onClose={onClose} />);
    expect((screen.getByLabelText('草稿') as HTMLInputElement).value).toBe('故事开头');
    expect(screen.getByText('已关闭过')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reuses the loaded module but resets drafts when the caller unmounts on close', async () => {
    const load = vi.fn(async () => ({ default: DraftDialog }));
    const Dialog = deferredDialog(load, open);
    const onClose = vi.fn();
    const first = render(<Dialog visible onClose={onClose} />);
    fireEvent.change(await screen.findByLabelText('草稿'), { target: { value: '首次草稿' } });
    first.unmount();
    render(<Dialog visible onClose={onClose} />);
    expect(((await screen.findByLabelText('草稿')) as HTMLInputElement).value).toBe('');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('can close while loading and does not show stale content when the import finishes', async () => {
    let finish!: (module: { default: typeof DraftDialog }) => void;
    const Dialog = deferredDialog(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      open
    );
    const onClose = vi.fn();
    const { rerender } = render(<Dialog visible onClose={onClose} />);
    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledOnce();
    rerender(<Dialog visible={false} onClose={onClose} />);
    await act(async () => finish({ default: DraftDialog }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByLabelText('草稿')).toBeNull();
    rerender(<Dialog visible onClose={onClose} />);
    expect(screen.getByText('已关闭过')).toBeTruthy();
  });

  it('preserves an actual inspiration draw and its advanced options across close/reopen', async () => {
    const Dialog = deferredDialog(
      () => import('@/render/components/InspirationDialog'),
      (p) => p.visible
    );
    const props = {
      onClose: vi.fn(),
      folderPath: null,
      dbReady: false,
      content: '',
      onInsert: () => true,
      random: () => 0,
    };
    const { rerender } = render(<Dialog {...props} visible={false} />);
    rerender(<Dialog {...props} visible />);
    fireEvent.click(await screen.findByRole('button', { name: '抽一签' }));
    const person = screen.getByTestId('inspiration-person').textContent;
    const place = screen.getByTestId('inspiration-place').textContent;
    fireEvent.click(screen.getByRole('button', { name: '更多选项' }));
    rerender(<Dialog {...props} visible={false} />);
    expect(screen.queryByRole('dialog', { name: '灵感' })).toBeNull();
    rerender(<Dialog {...props} visible />);
    expect(screen.getByTestId('inspiration-person').textContent).toBe(person);
    expect(screen.getByTestId('inspiration-place').textContent).toBe(place);
    expect(screen.getByRole('button', { name: '更多选项' }).getAttribute('aria-expanded')).toBe(
      'true'
    );
  });

  it('contains a failed import and retries without taking down the surrounding editor', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('chunk unavailable'))
      .mockResolvedValue({ default: DraftDialog });
    const Dialog = deferredDialog(load, open);
    const onClose = vi.fn();
    try {
      render(
        <>
          <p>正文编辑器</p>
          <Dialog visible onClose={onClose} />
        </>
      );
      await screen.findByRole('alert');
      expect(screen.getByText('正文编辑器')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: '重试' }));
      await screen.findByLabelText('草稿');
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      consoleError.mockRestore();
    }
  });
});
