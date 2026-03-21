import { describe, it, expect } from 'vitest';
import { myersDiff, computeLineDiff, computeCharDiff, collapseContext } from './index';

describe('myersDiff', () => {
  it('returns empty for identical empty arrays', () => {
    expect(myersDiff([], [])).toEqual([]);
  });

  it('returns all adds when old is empty', () => {
    const result = myersDiff([], ['a', 'b']);
    expect(result).toEqual([
      { type: 'add', value: 'a' },
      { type: 'add', value: 'b' },
    ]);
  });

  it('returns all dels when new is empty', () => {
    const result = myersDiff(['a', 'b'], []);
    expect(result).toEqual([
      { type: 'del', value: 'a' },
      { type: 'del', value: 'b' },
    ]);
  });

  it('detects single insertion', () => {
    const result = myersDiff(['a', 'c'], ['a', 'b', 'c']);
    const adds = result.filter((r) => r.type === 'add');
    expect(adds).toHaveLength(1);
    expect(adds[0].value).toBe('b');
  });

  it('detects single deletion', () => {
    const result = myersDiff(['a', 'b', 'c'], ['a', 'c']);
    const dels = result.filter((r) => r.type === 'del');
    expect(dels).toHaveLength(1);
    expect(dels[0].value).toBe('b');
  });

  it('handles identical sequences as all keep', () => {
    const result = myersDiff(['a', 'b', 'c'], ['a', 'b', 'c']);
    expect(result.every((r) => r.type === 'keep')).toBe(true);
    expect(result).toHaveLength(3);
  });
});

describe('computeLineDiff', () => {
  it('returns keep for identical lines', () => {
    const result = computeLineDiff(['hello', 'world'], ['hello', 'world']);
    expect(result.every((l) => l.type === 'keep')).toBe(true);
  });

  it('detects added and deleted lines', () => {
    const result = computeLineDiff(['line1', 'line2'], ['line1', 'modified', 'line2']);
    const adds = result.filter((l) => l.type === 'add');
    expect(adds.length).toBeGreaterThanOrEqual(1);
  });
});

describe('computeCharDiff', () => {
  it('returns all keep for identical strings', () => {
    const result = computeCharDiff('hello', 'hello');
    expect(result.every((s) => s.type === 'keep')).toBe(true);
  });

  it('detects char-level changes', () => {
    const result = computeCharDiff('abc', 'axc');
    const nonKeep = result.filter((s) => s.type !== 'keep');
    expect(nonKeep.length).toBeGreaterThanOrEqual(1);
  });
});

describe('collapseContext', () => {
  it('returns empty for empty input', () => {
    expect(collapseContext([])).toEqual([]);
  });

  it('preserves all lines when few changes', () => {
    const lines = [
      { type: 'keep' as const, text: 'a' },
      { type: 'add' as const, text: 'b' },
      { type: 'keep' as const, text: 'c' },
    ];
    const result = collapseContext(lines, 3);
    expect(result.filter((r) => 'count' in r)).toHaveLength(0);
  });
});
