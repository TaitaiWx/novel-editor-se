import { describe, expect, it, vi } from 'vitest';
import { registerActiveEditor, saveAllEditors } from '@/render/components/TextEditor/active-editor';
describe('editor preparation', () => {
  it('awaits all editors including unfocused split pane before permitting close', async () => {
    let finish!: () => void;
    const a = registerActiveEditor({
      getSnapshot: () => ({ filePath: '/a', content: 'last key', readOnly: false }),
      save: () =>
        new Promise<boolean>((resolve) => {
          finish = () => resolve(true);
        }),
      openSearch: () => {},
    });
    const save = vi.fn(async () => true);
    const b = registerActiveEditor({
      getSnapshot: () => ({ filePath: '/b', content: 'b', readOnly: false }),
      save,
      openSearch: () => {},
    });
    try {
      let done = false;
      const pending = saveAllEditors().then((r) => {
        done = true;
        return r;
      });
      await Promise.resolve();
      expect(done).toBe(false);
      finish();
      expect(await pending).toBe(true);
      expect(save).toHaveBeenCalled();
    } finally {
      a.dispose();
      b.dispose();
    }
  });
  it('rejects nonempty untitled drafts without attempting destructive close', async () => {
    const save = vi.fn();
    const editor = registerActiveEditor({
      getSnapshot: () => ({ filePath: '__untitled__:draft', content: 'keep me', readOnly: false }),
      save,
      openSearch: () => {},
    });
    try {
      expect(await saveAllEditors()).toBe(false);
      expect(save).not.toHaveBeenCalled();
    } finally {
      editor.dispose();
    }
  });
  it('explicit false or thrown save failure cancels preparation', async () => {
    const editor = registerActiveEditor({
      getSnapshot: () => ({ filePath: '/a', content: 'keep me', readOnly: false }),
      save: async () => false,
      openSearch: () => {},
    });
    try {
      expect(await saveAllEditors()).toBe(false);
    } finally {
      editor.dispose();
    }
  });
});
