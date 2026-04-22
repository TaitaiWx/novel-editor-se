import { describe, expect, it } from 'vitest';
import { extractCharacterTimeline } from './extract-timeline';

describe('extractCharacterTimeline', () => {
  it('按章节顺序提取人物经历', () => {
    const text = `第一章 初入宗门
沈岳在山门外领到杂役腰牌，第一次见到天玄城的修士。

第二章 试炼开始
沈岳在矿洞里躲开追杀，顺手捡到一枚残缺玉简。

第三章 丹炉异动
长老命沈岳守炉，沈岳借机摸清了炼药房的规矩。`;

    const timeline = extractCharacterTimeline(text, ['沈岳']);

    expect(timeline).toHaveLength(3);
    expect(timeline[0]?.chapterLabel).toContain('第一章');
    expect(timeline[0]?.title).toContain('初入宗门');
    expect(timeline[1]?.summary).toContain('矿洞');
    expect(timeline[2]?.summary).toContain('炼药房');
  });

  it('支持别名命中并去重重复摘要', () => {
    const text = `第一章
沈岳拜入外门。沈师兄拜入外门。

第二章
众人称沈师兄为怪人，沈师兄仍然独自炼体。`;

    const timeline = extractCharacterTimeline(text, ['沈岳', '沈师兄']);

    expect(timeline).toHaveLength(2);
    expect(timeline[0]?.chapterLabel).toContain('第一章');
    expect(timeline[0]?.summary).toContain('沈岳拜入外门');
    expect(timeline[1]?.summary).toContain('独自炼体');
  });

  it('没有章节标题时退化为正文片段时间线', () => {
    const text = `沈岳第一次下山，险些在黑市被人盯上。

他回到住处后开始清点收获，并决定暂避锋芒。

数日后，沈岳在丹堂通过考核，正式拿到外门供奉资格。`;

    const timeline = extractCharacterTimeline(text, ['沈岳']);

    expect(timeline.length).toBeGreaterThan(0);
    expect(timeline[0]?.chapterLabel).toContain('正文片段');
  });

  it('支持用文件名作为章节标签回退', () => {
    const text = `沈岳服下玄灵丹，成功突破练气后期。

随后他打开储物袋，开始整理刚得到的剑修传承。`;

    const timeline = extractCharacterTimeline(text, ['沈岳'], {
      fallbackChapterLabel: '第23章 服用玄灵丹',
    });

    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.chapterLabel).toBe('第23章');
    expect(timeline[0]?.chapterNumber).toBe(23);
  });
});
