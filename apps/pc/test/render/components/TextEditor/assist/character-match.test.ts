import { describe, expect, it } from 'vitest';
import { Text } from '@codemirror/state';
import {
  buildCharacterMatcher,
  lineMentions,
  matchLine,
  mentionAt,
  mentionsInRanges,
} from '@/render/components/TextEditor/assist/character-match';

const CHARACTERS = [
  { id: 1, name: '林舟', aliases: ['阿舟', '舟'] },
  { id: 2, name: '苏晴', aliases: [] },
  { id: 3, name: '苏晴儿', aliases: ['晴儿'] },
  { id: 4, name: 'Ann', aliases: [] },
  { id: 5, name: '少年', aliases: [] },
  { id: 6, name: '白鸦', aliases: ['林舟'] },
];

describe('character-match', () => {
  const matcher = buildCharacterMatcher(CHARACTERS);

  it('识别名字与别名，忽略单字与泛称，同名词归先出现的人物', () => {
    expect(matcher.tokens.get('阿舟')).toEqual({ characterId: 1, source: 'alias' });
    expect(matcher.tokens.has('舟')).toBe(false);
    expect(matcher.tokens.has('少年')).toBe(false);
    // 白鸦的别名「林舟」与林舟本名冲突：归林舟
    expect(matcher.tokens.get('林舟')).toEqual({ characterId: 1, source: 'name' });
  });

  it('长名优先、结果不重叠', () => {
    const mentions = matchLine(matcher, '苏晴儿看着苏晴，阿舟喊晴儿', 10);
    expect(mentions.map((item) => [item.token, item.characterId, item.from])).toEqual([
      ['苏晴儿', 3, 10],
      ['苏晴', 2, 15],
      ['阿舟', 1, 18],
      ['晴儿', 3, 21],
    ]);
    for (let i = 1; i < mentions.length; i += 1) {
      expect(mentions[i].from).toBeGreaterThanOrEqual(mentions[i - 1].to);
    }
  });

  it('英文名要求单词边界', () => {
    expect(matchLine(matcher, 'Annie met Ann.').map((item) => item.from)).toEqual([10]);
  });

  it('mentionAt：名字内部与两端都能命中，side 决定紧挨两个名字时取哪个', () => {
    const doc = Text.of(['第一行', '林舟苏晴']);
    const lineStart = doc.line(2).from;
    expect(mentionAt(matcher, doc, lineStart + 1)?.characterId).toBe(1);
    expect(mentionAt(matcher, doc, lineStart + 2, -1)?.characterId).toBe(1);
    expect(mentionAt(matcher, doc, lineStart + 2, 1)?.characterId).toBe(2);
    expect(mentionAt(matcher, doc, 1)).toBeNull();
  });

  it('按文档版本缓存；只扫描传入的范围', () => {
    const doc = Text.of(['林舟', '苏晴', '无人', '阿舟']);
    const first = lineMentions(matcher, doc, 1);
    expect(lineMentions(matcher, doc, 1)).toBe(first);

    const visible = mentionsInRanges(matcher, doc, [{ from: 0, to: doc.line(2).to }]);
    expect(visible.map((item) => item.token)).toEqual(['林舟', '苏晴']);
    const cached = matcher.cache.get(doc);
    expect(Array.from(cached?.keys() ?? []).sort()).toEqual([1, 2]);

    // 新版本文档不复用旧缓存
    const next = doc.replace(0, 0, Text.of(['阿舟']));
    expect(matcher.cache.get(next)).toBeUndefined();
    expect(lineMentions(matcher, next, 1).map((item) => item.token)).toEqual(['阿舟', '林舟']);
  });

  it('可只取某个人物，范围重叠时同一行不重复', () => {
    const doc = Text.of(['林舟与阿舟', '苏晴']);
    const ranges = [
      { from: 0, to: 3 },
      { from: 2, to: doc.length },
    ];
    expect(mentionsInRanges(matcher, doc, ranges, 1).map((item) => item.token)).toEqual([
      '林舟',
      '阿舟',
    ]);
  });

  it('没有人物时不匹配', () => {
    const empty = buildCharacterMatcher([]);
    expect(empty.regex).toBeNull();
    expect(mentionsInRanges(empty, Text.of(['林舟']), [{ from: 0, to: 2 }])).toEqual([]);
  });
});
