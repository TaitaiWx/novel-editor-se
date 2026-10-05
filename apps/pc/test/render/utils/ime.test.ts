import { describe, expect, it } from 'vitest';
import { isImeComposing } from '@/render/utils/ime';
import { NOVEL_EDITOR_FILE_SAVED_EVENT } from '@/render/utils/editor-events';

describe('isImeComposing', () => {
  it('空事件返回 false', () => {
    expect(isImeComposing(null)).toBe(false);
    expect(isImeComposing(undefined)).toBe(false);
    expect(isImeComposing({})).toBe(false);
  });

  it.each([
    [{ isComposing: true }],
    [{ nativeEvent: { isComposing: true } }],
    [{ keyCode: 229 }],
    [{ nativeEvent: { keyCode: 229 } }],
    [{ which: 229 }],
    [{ nativeEvent: { which: 229 } }],
  ])('识别输入法组合态 %o', (event) => {
    expect(isImeComposing(event)).toBe(true);
  });

  it('普通按键不是组合态', () => {
    expect(isImeComposing({ keyCode: 13, which: 13, nativeEvent: { keyCode: 13 } })).toBe(false);
  });
});

describe('editor-events', () => {
  it('导出文件保存事件名', () => {
    expect(NOVEL_EDITOR_FILE_SAVED_EVENT).toBe('novel-editor:file-saved');
  });
});
