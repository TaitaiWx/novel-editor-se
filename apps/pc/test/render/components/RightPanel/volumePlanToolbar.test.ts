import { describe, expect, it } from 'vitest';
import { deriveVolumeOutline } from '@novel-editor/basic-algorithm';
import {
  buildActSegments,
  countWords,
  formatWordCount,
} from '@/render/components/RightPanel/VolumePlanView/VolumeOverview';
import {
  describeStructure,
  structureOptions,
} from '@/render/components/RightPanel/VolumePlanView/PlanToolbar';

describe('卷纲总览与结构菜单（纯函数）', () => {
  it('formatWordCount：千字用 k，万字用 万，去掉多余的 .0', () => {
    expect(formatWordCount(0)).toBe('0');
    expect(formatWordCount(999)).toBe('999');
    expect(formatWordCount(1000)).toBe('1k');
    expect(formatWordCount(1250)).toBe('1.3k');
    expect(formatWordCount(10_000)).toBe('1 万');
    expect(formatWordCount(23_456)).toBe('2.3 万');
  });

  it('countWords：不计空白（与状态栏同一口径）', () => {
    expect(countWords('林舟 背起\n行囊。\t')).toBe(7);
    expect(countWords('   ')).toBe(0);
  });

  it('buildActSegments：章数与幕标题一致（切开的章两幕都算），字数只计首次出现的幕', () => {
    const outline = deriveVolumeOutline(
      [
        {
          path: '/a.md',
          title: '一',
          content: '# 一\n第一幕 起\n第一场 港口\n甲乙丙\n第二幕 转\n第一场 夜航\n丁戊',
        },
        { path: '/b.md', title: '二', content: '第一场 入林\n己庚辛壬' },
      ],
      { structure: 'markers' }
    );
    const words = new Map([
      ['/a.md', 10],
      ['/b.md', 4],
    ]);
    const segments = buildActSegments(outline, words);
    expect(segments.map((item) => [item.title, item.chapters, item.words, item.tone])).toEqual([
      ['第一幕 起', 1, 10, 0],
      ['第二幕 转', 2, 4, 1],
    ]);
  });

  it('结构选项：没有幕标记时不提供「按正文幕标记」；说明列出各段', () => {
    expect(structureOptions(true)).toEqual([
      'markers',
      'three-act',
      'kishotenketsu',
      'hero-journey',
    ]);
    expect(structureOptions(false)).toEqual(['three-act', 'kishotenketsu', 'hero-journey']);
    expect(describeStructure('markers')).toBe('按正文里的「第X幕」分段');
    expect(describeStructure('kishotenketsu')).toBe('起 → 承 → 转 → 合');
  });
});
