import { describe, expect, it } from 'vitest';
import { getPathBasename, isPathInside } from '@/render/utils/path';

describe('getPathBasename', () => {
  it('兼容 POSIX 与 Windows 分隔符', () => {
    expect(getPathBasename('/Users/me/novel/第一章.md')).toBe('第一章.md');
    expect(getPathBasename('C:\\Users\\me\\novel\\第一章.md')).toBe('第一章.md');
    expect(getPathBasename('C:\\Users\\me/mixed\\a.txt')).toBe('a.txt');
  });

  it('忽略末尾分隔符，无分隔符时返回原值', () => {
    expect(getPathBasename('/Users/me/novel/')).toBe('novel');
    expect(getPathBasename('C:\\novel\\')).toBe('novel');
    expect(getPathBasename('README')).toBe('README');
    expect(getPathBasename('')).toBe('');
  });
});

describe('isPathInside', () => {
  it('按分隔符边界判断，不误判同前缀兄弟目录', () => {
    expect(isPathInside('/w/正文/a.md', '/w/正文')).toBe(true);
    expect(isPathInside('/w/正文', '/w/正文')).toBe(true);
    expect(isPathInside('/w/正文', '/w/正文/')).toBe(true);
    expect(isPathInside('/w/正文2/a.md', '/w/正文')).toBe(false);
    expect(isPathInside('/w', '/w/正文')).toBe(false);
  });

  it('兼容 Windows 分隔符', () => {
    expect(isPathInside('C:\\w\\正文\\a.md', 'C:\\w\\正文')).toBe(true);
    expect(isPathInside('C:\\w\\正文2\\a.md', 'C:\\w\\正文')).toBe(false);
  });
});
