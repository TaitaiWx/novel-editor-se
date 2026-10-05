import { describe, expect, it } from 'vitest';
import {
  moveStoryPathRelative,
  parseStoryOrderMap,
  remapStoryOrderMapPaths,
} from '@/render/app/storyOrder';

describe('parseStoryOrderMap', () => {
  it('空值、非法 JSON、数组与 null 返回空对象', () => {
    expect(parseStoryOrderMap(null)).toEqual({});
    expect(parseStoryOrderMap('{')).toEqual({});
    expect(parseStoryOrderMap('[]')).toEqual({});
    expect(parseStoryOrderMap('null')).toEqual({});
  });

  it('过滤非字符串、空白项并去重', () => {
    const raw = JSON.stringify({
      '/n': ['/n/第2章.md', '/n/第1章.md', '/n/第2章.md', 3, '  '],
      '/n/第一卷': 'not-array',
    });
    expect(parseStoryOrderMap(raw)).toEqual({
      '/n': ['/n/第2章.md', '/n/第1章.md'],
      '/n/第一卷': [],
    });
  });
});

describe('remapStoryOrderMapPaths', () => {
  it('重命名目录后同时更新键与值并去重', () => {
    const map = {
      '/n/卷一': ['/n/卷一/a.md', '/n/卷一/b.md'],
      '/n': ['/n/卷一', '/n/卷1', '/n/卷二'],
    };
    expect(remapStoryOrderMapPaths(map, '/n/卷一', '/n/卷1')).toEqual({
      '/n/卷1': ['/n/卷1/a.md', '/n/卷1/b.md'],
      '/n': ['/n/卷1', '/n/卷二'],
    });
  });
});

describe('moveStoryPathRelative', () => {
  const order = ['第1章', '第2章', '第3章', '第4章'];

  it('移动到目标之前 / 之后', () => {
    expect(moveStoryPathRelative(order, '第4章', '第2章', 'before')).toEqual([
      '第1章',
      '第4章',
      '第2章',
      '第3章',
    ]);
    expect(moveStoryPathRelative(order, '第1章', '第3章', 'after')).toEqual([
      '第2章',
      '第3章',
      '第1章',
      '第4章',
    ]);
    expect(order).toEqual(['第1章', '第2章', '第3章', '第4章']);
  });

  it('源或目标不存在、或相同时原样返回', () => {
    expect(moveStoryPathRelative(order, '第9章', '第1章', 'before')).toBe(order);
    expect(moveStoryPathRelative(order, '第1章', '第9章', 'before')).toBe(order);
    expect(moveStoryPathRelative(order, '第1章', '第1章', 'after')).toBe(order);
  });

  it('源路径为空字符串时原样返回', () => {
    const withEmpty = ['', 'a'];
    expect(moveStoryPathRelative(withEmpty, '', 'a', 'after')).toBe(withEmpty);
  });
});
