// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useUnsavedChangesGuard } from '@/render/hooks/useUnsavedChangesGuard';
import { flushPreparationParticipants } from '@/render/utils/rendererPreparation';
describe('未提交表单的退出保护', () => {
  it('读取最新dirty状态，保存或取消编辑后才允许关闭，卸载不遗留阻塞', async () => {
    const { rerender, unmount } = renderHook(({ dirty }) => useUnsavedChangesGuard(dirty), {
      initialProps: { dirty: false },
    });
    expect(await flushPreparationParticipants()).toBe(true);
    rerender({ dirty: true });
    expect(await flushPreparationParticipants()).toBe(false);
    rerender({ dirty: false });
    expect(await flushPreparationParticipants()).toBe(true);
    rerender({ dirty: true });
    unmount();
    expect(await flushPreparationParticipants()).toBe(true);
  });
});
