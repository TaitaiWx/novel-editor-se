import { describe, it, expect } from 'vitest';
import {
  myersDiff,
  computeLineDiff,
  computeCharDiff,
  collapseContext,
  isCollapsedBlock,
  buildCharDiffMap,
} from '../src';
import type { DiffLine, DisplayItem } from '../src';

/** 经典 DP 计算最长公共子序列长度，用于验证 Myers 结果是最短编辑 */
function lcsLength<T>(a: T[], b: T[]): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/** 确定性的伪随机数（避免测试不稳定） */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const keep = (text: string): DiffLine => ({ type: 'keep', text });
const add = (text: string): DiffLine => ({ type: 'add', text });
const del = (text: string): DiffLine => ({ type: 'del', text });

describe('myersDiff — 正确性与最优性', () => {
  it('随机序列：还原新旧序列，且编辑数等于 n+m-2·LCS', () => {
    const next = rng(42);
    const alphabet = ['林', '远', '苏', '晴', '。'];
    for (let round = 0; round < 200; round++) {
      const a = Array.from(
        { length: Math.floor(next() * 12) },
        () => alphabet[Math.floor(next() * 5)]
      );
      const b = Array.from(
        { length: Math.floor(next() * 12) },
        () => alphabet[Math.floor(next() * 5)]
      );
      const ops = myersDiff(a, b);
      expect(ops.filter((o) => o.type !== 'add').map((o) => o.value)).toEqual(a);
      expect(ops.filter((o) => o.type !== 'del').map((o) => o.value)).toEqual(b);
      const edits = ops.filter((o) => o.type !== 'keep').length;
      expect(edits).toBe(a.length + b.length - 2 * lcsLength(a, b));
    }
  });

  it('完全不同的序列：先删后增', () => {
    expect(myersDiff(['a', 'b'], ['c'])).toEqual([
      { type: 'del', value: 'a' },
      { type: 'del', value: 'b' },
      { type: 'add', value: 'c' },
    ]);
  });

  it('支持自定义相等函数（忽略大小写），keep 时取旧值', () => {
    const ops = myersDiff(
      ['Lin', 'Su'],
      ['lin', 'su', 'x'],
      (x, y) => x.toLowerCase() === y.toLowerCase()
    );
    expect(ops).toEqual([
      { type: 'keep', value: 'Lin' },
      { type: 'keep', value: 'Su' },
      { type: 'add', value: 'x' },
    ]);
  });

  it('支持非字符串元素（数字）', () => {
    const ops = myersDiff([1, 2, 3, 4], [1, 3, 4, 5]);
    expect(ops.map((o) => `${o.type}:${o.value}`)).toEqual([
      'keep:1',
      'del:2',
      'keep:3',
      'keep:4',
      'add:5',
    ]);
  });
});

describe('computeLineDiff — 章节修改', () => {
  it('修改一行表现为 del + add，其余保持', () => {
    const oldLines = ['第一章 下山', '林远背着剑下山。', '苏晴在渡口等他。'];
    const newLines = ['第一章 下山', '林远背着刀下山。', '苏晴在渡口等他。'];
    expect(computeLineDiff(oldLines, newLines)).toEqual([
      keep('第一章 下山'),
      del('林远背着剑下山。'),
      add('林远背着刀下山。'),
      keep('苏晴在渡口等他。'),
    ]);
  });

  it('新增与删除空行也被识别', () => {
    const result = computeLineDiff(['甲', '', '乙'], ['甲', '乙', '']);
    expect(result.filter((l) => l.type !== 'keep')).toHaveLength(2);
  });
});

describe('computeCharDiff', () => {
  it('空字符串边界', () => {
    expect(computeCharDiff('', '')).toEqual([]);
    expect(computeCharDiff('', '林远')).toEqual([{ type: 'add', text: '林远' }]);
    expect(computeCharDiff('苏晴', '')).toEqual([{ type: 'del', text: '苏晴' }]);
  });

  it('相同类型的相邻字符被合并成片段', () => {
    expect(computeCharDiff('林远背着剑下山', '林远背着长刀下山')).toEqual([
      { type: 'keep', text: '林远背着' },
      { type: 'del', text: '剑' },
      { type: 'add', text: '长刀' },
      { type: 'keep', text: '下山' },
    ]);
  });

  it('完全相同时合并为一个 keep 片段', () => {
    expect(computeCharDiff('“走吧。”', '“走吧。”')).toEqual([{ type: 'keep', text: '“走吧。”' }]);
  });

  it('emoji 代理对不会被拆开', () => {
    const segs = computeCharDiff('林远😀', '林远😢');
    expect(segs).toEqual([
      { type: 'keep', text: '林远' },
      { type: 'del', text: '😀' },
      { type: 'add', text: '😢' },
    ]);
  });

  it('片段拼接可还原新旧文本', () => {
    const oldText = '苏晴说：「林远，你来了。」';
    const newText = '苏晴低声说：「林远，你终于来了！」';
    const segs = computeCharDiff(oldText, newText);
    expect(
      segs
        .filter((s) => s.type !== 'add')
        .map((s) => s.text)
        .join('')
    ).toBe(oldText);
    expect(
      segs
        .filter((s) => s.type !== 'del')
        .map((s) => s.text)
        .join('')
    ).toBe(newText);
  });
});

describe('collapseContext', () => {
  const ks = (n: number, prefix = 'k'): DiffLine[] =>
    Array.from({ length: n }, (_, i) => keep(`${prefix}${i}`));

  it('contextSize ≤ 0 时原样返回（同一引用）', () => {
    const lines = [...ks(10), add('x')];
    expect(collapseContext(lines, 0)).toBe(lines);
    expect(collapseContext(lines, -1)).toBe(lines);
  });

  it('全部为变更行时原样返回', () => {
    const lines = [add('a'), del('b')];
    expect(collapseContext(lines)).toBe(lines);
  });

  it('没有变更：超过 2×context 折叠为一个块，否则原样', () => {
    expect(collapseContext(ks(7), 3)).toEqual([{ type: 'collapsed', count: 7 }]);
    const six = ks(6);
    expect(collapseContext(six, 3)).toBe(six);
  });

  it('只保留变更前后 N 行，中间与两端折叠', () => {
    const lines = [...ks(5, 'a'), add('X'), ...ks(10, 'b'), del('Y'), ...ks(4, 'c')];
    const result = collapseContext(lines, 2);
    const shape = result.map((item: DisplayItem) =>
      isCollapsedBlock(item) ? `…${item.count}` : `${item.type}:${item.text}`
    );
    expect(shape).toEqual([
      '…3',
      'keep:a3',
      'keep:a4',
      'add:X',
      'keep:b0',
      'keep:b1',
      '…6',
      'keep:b8',
      'keep:b9',
      'del:Y',
      'keep:c0',
      'keep:c1',
      '…2',
    ]);
  });

  it('上下文窗口重叠时不产生折叠块', () => {
    const lines = [keep('a'), add('X'), keep('b'), keep('c'), del('Y'), keep('d')];
    const result = collapseContext(lines, 2);
    expect(result.some(isCollapsedBlock)).toBe(false);
    expect(result).toHaveLength(6);
  });

  it('默认 contextSize = 3', () => {
    const lines = [...ks(5), add('X')];
    expect(collapseContext(lines)[0]).toEqual({ type: 'collapsed', count: 2 });
  });
});

describe('isCollapsedBlock', () => {
  it('区分折叠块与普通行', () => {
    expect(isCollapsedBlock({ type: 'collapsed', count: 1 })).toBe(true);
    expect(isCollapsedBlock(keep('a'))).toBe(false);
    expect(isCollapsedBlock(add('a'))).toBe(false);
  });
});

describe('buildCharDiffMap', () => {
  it('del→add 一一配对，两侧索引共享同一组片段', () => {
    const lines = [keep('标题'), del('林远拔剑'), add('林远拔刀'), keep('尾')];
    const map = buildCharDiffMap(lines);
    expect([...map.keys()]).toEqual([1, 2]);
    expect(map.get(1)).toBe(map.get(2));
    expect(map.get(1)).toEqual([
      { type: 'keep', text: '林远拔' },
      { type: 'del', text: '剑' },
      { type: 'add', text: '刀' },
    ]);
  });

  it('多删少增时只配对较少的一方', () => {
    const lines = [del('a1'), del('a2'), del('a3'), add('b1')];
    const map = buildCharDiffMap(lines);
    expect([...map.keys()].sort()).toEqual([0, 3]);
  });

  it('多增少删时同样按顺序配对', () => {
    const lines = [del('a1'), add('b1'), add('b2')];
    expect([...buildCharDiffMap(lines).keys()].sort()).toEqual([0, 1]);
  });

  it('单独的 add 或 del 不产生映射；多个替换块分别处理', () => {
    expect(buildCharDiffMap([add('x'), keep('y')]).size).toBe(0);
    expect(buildCharDiffMap([del('x'), keep('y')]).size).toBe(0);
    const lines = [del('a'), add('b'), keep('k'), del('c'), add('d')];
    expect([...buildCharDiffMap(lines).keys()].sort()).toEqual([0, 1, 3, 4]);
  });

  it('空输入返回空 Map', () => {
    expect(buildCharDiffMap([]).size).toBe(0);
  });
});
