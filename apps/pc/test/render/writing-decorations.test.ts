import { describe, expect, it } from 'vitest';
import {
  isCharacterHighlightBoundarySafe,
  shouldIgnoreCharacterHighlightToken,
} from '../../src/render/components/TextEditor/writing-decorations';

describe('writing-decorations token rules', () => {
  it('会忽略单字和纯数字 token', () => {
    expect(shouldIgnoreCharacterHighlightToken('张')).toBe(true);
    expect(shouldIgnoreCharacterHighlightToken('A')).toBe(true);
    expect(shouldIgnoreCharacterHighlightToken('12')).toBe(true);
  });

  it('会保留正常的角色名 token', () => {
    expect(shouldIgnoreCharacterHighlightToken('张三')).toBe(false);
    expect(shouldIgnoreCharacterHighlightToken('阿离')).toBe(false);
    expect(shouldIgnoreCharacterHighlightToken('AI')).toBe(false);
    expect(shouldIgnoreCharacterHighlightToken('A哥')).toBe(false);
  });

  it('会过滤高误报的通用称谓', () => {
    expect(shouldIgnoreCharacterHighlightToken('先生')).toBe(true);
    expect(shouldIgnoreCharacterHighlightToken('老师')).toBe(true);
    expect(shouldIgnoreCharacterHighlightToken('主角')).toBe(true);
  });

  it('ASCII token 必须满足单词边界', () => {
    expect(isCharacterHighlightBoundarySafe('AI 走进房间', 0, 'AI')).toBe(true);
    expect(isCharacterHighlightBoundarySafe('这是AIHero的台词', 2, 'AI')).toBe(false);
    expect(isCharacterHighlightBoundarySafe('超级A哥登场', 2, 'A哥')).toBe(true);
    expect(isCharacterHighlightBoundarySafe('XA哥登场', 1, 'A哥')).toBe(false);
  });

  it('中文 token 不受英文单词边界限制', () => {
    expect(isCharacterHighlightBoundarySafe('张三走进房间', 0, '张三')).toBe(true);
    expect(isCharacterHighlightBoundarySafe('老张三今天迟到了', 1, '张三')).toBe(true);
  });
});
