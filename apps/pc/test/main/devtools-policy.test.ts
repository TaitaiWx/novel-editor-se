import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: true } }));

import { devToolsAllowed } from '../../src/main/devtools-policy';

describe('devToolsAllowed', () => {
  it('开发模式允许，生产版本不允许', () => {
    expect(devToolsAllowed(false, {})).toBe(true);
    expect(devToolsAllowed(true, {})).toBe(false);
  });

  it('生产版本只有显式设置 NOVEL_EDITOR_ENABLE_DEVTOOLS=1 才允许', () => {
    expect(devToolsAllowed(true, { NOVEL_EDITOR_ENABLE_DEVTOOLS: '1' })).toBe(true);
    expect(devToolsAllowed(true, { NOVEL_EDITOR_ENABLE_DEVTOOLS: 'true' })).toBe(false);
  });

  it('默认读取 app.isPackaged', () => {
    const previous = process.env.NOVEL_EDITOR_ENABLE_DEVTOOLS;
    delete process.env.NOVEL_EDITOR_ENABLE_DEVTOOLS;
    try {
      expect(devToolsAllowed()).toBe(false);
    } finally {
      if (previous !== undefined) process.env.NOVEL_EDITOR_ENABLE_DEVTOOLS = previous;
    }
  });
});
