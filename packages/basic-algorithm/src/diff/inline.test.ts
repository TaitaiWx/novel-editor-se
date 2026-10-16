import { describe, expect, it } from 'vitest';
import { computeInlineTextDiff } from './inline';

describe('character form inline diff', () => {
  it.each([
    ['', '', []],
    ['原文', '原文', [{ type: 'keep', text: '原文', from: 0, to: 2 }]],
    ['', '新\n文', [{ type: 'add', text: '新\n文', from: 0, to: 3 }]],
    ['旧\n文', '', [{ type: 'del', text: '旧\n文', from: 0, to: 0 }]],
    [
      '林舟\n怕水',
      '林舟\n怕火',
      [
        { type: 'keep', text: '林舟\n怕', from: 0, to: 4 },
        { type: 'del', text: '水', from: 4, to: 4 },
        { type: 'add', text: '火', from: 4, to: 5 },
      ],
    ],
    [
      'A👩‍🚀e\u0301尾',
      'A👨‍🚀é尾',
      [
        { type: 'keep', text: 'A', from: 0, to: 1 },
        { type: 'del', text: '👩‍🚀e\u0301', from: 1, to: 1 },
        { type: 'add', text: '👨‍🚀é', from: 1, to: 7 },
        { type: 'keep', text: '尾', from: 7, to: 8 },
      ],
    ],
    [
      '前🇨🇳后',
      '前后',
      [
        { type: 'keep', text: '前', from: 0, to: 1 },
        { type: 'del', text: '🇨🇳', from: 1, to: 1 },
        { type: 'keep', text: '后', from: 1, to: 2 },
      ],
    ],
  ])('preserves complete graphemes and UTF-16 offsets: %j → %j', (before, after, want) => {
    expect(computeInlineTextDiff(before as string, after as string)).toEqual(want);
  });

  it.each([
    ['第一行\r\n第二行\r\n末行', '第一行\r\n插入\r\n第二行改\r\n末行'],
    ['甲乙甲乙甲乙', '乙甲乙丙甲乙'],
    ['👩🏽‍💻看着e\u0301和🇨🇳。', '👩🏽‍💻说：é和🇯🇵！'],
  ])('reconstructs both documents and anchors every current-text range', (before, after) => {
    const changes = computeInlineTextDiff(before, after);
    expect(
      changes
        .filter((c) => c.type !== 'add')
        .map((c) => c.text)
        .join('')
    ).toBe(before);
    expect(
      changes
        .filter((c) => c.type !== 'del')
        .map((c) => c.text)
        .join('')
    ).toBe(after);
    let offset = 0;
    for (const change of changes) {
      expect(change.from).toBe(offset);
      if (change.type === 'del') expect(change.to).toBe(offset);
      else expect(after.slice(change.from, change.to)).toBe(change.text);
      offset = change.to;
    }
    expect(offset).toBe(after.length);
  });

  it('bounds unrelated long rewrites while retaining the common prefix and suffix', () => {
    const before = `开头\n${'旧'.repeat(20_000)}\n结尾`;
    const after = `开头\n${'新'.repeat(20_000)}\n结尾`;
    const started = performance.now();
    const changes = computeInlineTextDiff(before, after);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(changes).toEqual([
      { type: 'keep', text: '开头\n', from: 0, to: 3 },
      { type: 'del', text: '旧'.repeat(20_000), from: 3, to: 3 },
      { type: 'add', text: '新'.repeat(20_000), from: 3, to: 20_003 },
      { type: 'keep', text: '\n结尾', from: 20_003, to: 20_006 },
    ]);
  });
});
