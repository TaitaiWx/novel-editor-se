import { describe, it, expect } from 'vitest';
import { extractCharacterTimeline } from '../src';

const STORY = [
  '第一章 下山', // 1
  '林远背着剑下山。', // 2
  '', // 3
  '第二章 重逢', // 4
  '苏晴在渡口等人。', // 5
  '', // 6
  '第三章 夜谈', // 7
  '林远与苏晴彻夜长谈，说起旧事。', // 8
].join('\n');

describe('extractCharacterTimeline — 基础', () => {
  it('空正文或空关键词返回空数组', () => {
    expect(extractCharacterTimeline('', ['林远'])).toEqual([]);
    expect(extractCharacterTimeline('   \n\n ', ['林远'])).toEqual([]);
    expect(extractCharacterTimeline(STORY, [])).toEqual([]);
    expect(extractCharacterTimeline(STORY, ['  ', ''])).toEqual([]);
  });

  it('只保留提到人物的章节，字段完整且按出现顺序', () => {
    const timeline = extractCharacterTimeline(STORY, ['林远']);
    expect(timeline).toEqual([
      {
        key: '1-3-0',
        title: '下山',
        summary: '林远背着剑下山。',
        chapterLabel: '第一章',
        chapterNumber: 1,
        mentionCount: 1,
        startLine: 1,
        endLine: 3,
      },
      {
        key: '7-8-2',
        title: '夜谈',
        summary: '林远与苏晴彻夜长谈，说起旧事。',
        chapterLabel: '第三章',
        chapterNumber: 3,
        mentionCount: 1,
        startLine: 7,
        endLine: 8,
      },
    ]);
  });

  it('不同人物得到不同时间线', () => {
    const timeline = extractCharacterTimeline(STORY, ['苏晴']);
    expect(timeline.map((e) => e.chapterLabel)).toEqual(['第二章', '第三章']);
  });

  it('mentionCount 统计所有别名的出现次数；短别名被长别名包含时去重', () => {
    const text = '第一章 宗门\n林远拜师。林师兄名不虚传。林远笑了，林三也笑了。';
    // “林” 被 “林远” 包含而被剔除，因此 “林三” 不计数
    const timeline = extractCharacterTimeline(text, ['林远', '林师兄', '林', '林远']);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].mentionCount).toBe(3);
  });

  it('关键词匹配计数不区分大小写', () => {
    const text = '1. Prologue\nLIN walked in. lin sat down. Lin left.';
    const timeline = extractCharacterTimeline(text, ['Lin']);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].mentionCount).toBe(3);
    // 数字编号标题以编号作为章节标签，并解析出章节号
    expect(timeline[0].chapterLabel).toBe('1');
    expect(timeline[0].chapterNumber).toBe(1);
  });

  it('数字编号标题（"12. 夜雨"）应保留章节号', () => {
    // 期望：parseChapterMeta 的 numbered 分支解析出 label="12"、chapterNumber=12
    // 实际：extractOutline 对 numbered 节点只返回去掉编号的文本 "夜雨"，
    //       extract-timeline.ts:284 再解析时只能落到 'other' 分支，编号丢失；
    //       selectTimelineAnchors 中 kind === 'numbered' 的判断也因此永远不成立
    const timeline = extractCharacterTimeline('12. 夜雨\n林远撑伞。', ['林远']);
    expect(timeline[0].chapterNumber).toBe(12);
  });

  it('相同摘要（忽略空白与标点）只保留第一次', () => {
    const text = '第一章 甲\n林远沉默。\n第二章 乙\n林远 沉默！\n第三章 丙\n林远离开。';
    const timeline = extractCharacterTimeline(text, ['林远']);
    expect(timeline.map((e) => e.chapterLabel)).toEqual(['第一章', '第三章']);
  });

  it('只有标题没有正文的章节被跳过（标题本身不计入提及）', () => {
    const text = '第一章 林远\n第二章 别离\n林远走了。';
    const timeline = extractCharacterTimeline(text, ['林远']);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].chapterLabel).toBe('第二章');
  });
});

describe('extractCharacterTimeline — 章节号解析', () => {
  it.each([
    ['第十二章 风起', 12],
    ['第二十章 风起', 20],
    ['第一百零五章 风起', 105],
    ['第三千章 风起', 3000],
    ['第128章 风起', 128],
  ])('%s → %d', (heading, expected) => {
    const timeline = extractCharacterTimeline(`${heading}\n林远出场。`, ['林远']);
    expect(timeline[0].chapterNumber).toBe(expected);
  });

  it.each([
    ['第两千零一章 归来', '第两千零一章', 2001],
    ['第一万二千章 终局', '第一万二千章', 12000],
    ['第五回 夜奔', '第五回', 5],
    ['第二卷 江湖', '第二卷', 2],
    ['7.2 林远篇', '7.2', 7],
  ])('fallbackChapterLabel=%s 解析出 %s / %d', (label, chapterLabel, num) => {
    const timeline = extractCharacterTimeline('林远出场。', ['林远'], {
      fallbackChapterLabel: label,
    });
    expect(timeline[0].chapterLabel).toBe(chapterLabel);
    expect(timeline[0].chapterNumber).toBe(num);
  });

  it('无法解析的标签（含非法字符/全零）没有 chapterNumber', () => {
    const a = extractCharacterTimeline('林远出场。', ['林远'], {
      fallbackChapterLabel: '番外 苏晴',
    });
    expect(a[0].chapterLabel).toBe('番外 苏晴');
    expect(a[0].chapterNumber).toBeUndefined();
    // 两个分支都不会被识别：章 0
    const b = extractCharacterTimeline('林远出场。', ['林远'], { fallbackChapterLabel: '第零章' });
    expect(b[0].chapterLabel).toBe('第零章');
    expect(b[0].chapterNumber).toBeUndefined();
  });

  it('fallbackChapterLabel 覆盖整篇，行号从 1 到总行数', () => {
    const text = '林远服下丹药。\n\n苏晴守在门外。\n\n林远突破了。';
    const timeline = extractCharacterTimeline(text, ['林远'], {
      fallbackChapterLabel: '第9章 突破',
    });
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ startLine: 1, endLine: 5, mentionCount: 2, title: '突破' });
  });

  it('fallbackChapterLabel 下人物未出现时返回空', () => {
    expect(
      extractCharacterTimeline('苏晴独坐。', ['林远'], { fallbackChapterLabel: '第1章' })
    ).toEqual([]);
  });
});

describe('extractCharacterTimeline — 锚点选择', () => {
  it('有 章 时忽略 卷 这类容器标题', () => {
    const text = '第一卷 少年\n第一章 下山\n林远下山。\n第二章 入城\n林远入城。';
    const timeline = extractCharacterTimeline(text, ['林远']);
    expect(timeline.map((e) => e.chapterLabel)).toEqual(['第一章', '第二章']);
  });

  it('只有 卷 时退而使用 卷 作为锚点', () => {
    const text = '第一卷 少年\n林远下山。\n第二卷 青年\n林远成名。';
    const timeline = extractCharacterTimeline(text, ['林远']);
    expect(timeline.map((e) => [e.chapterLabel, e.chapterNumber])).toEqual([
      ['第一卷', 1],
      ['第二卷', 2],
    ]);
  });

  it('章与节混用时选择数量最多的层级作为锚点', () => {
    const text = '第一章 起\n第一节 甲\n林远甲。\n第二节 乙\n林远乙。';
    const timeline = extractCharacterTimeline(text, ['林远']);
    expect(timeline.map((e) => e.chapterLabel)).toEqual(['第一节', '第二节']);
  });

  it('Markdown 标题作为锚点', () => {
    const text = '# 楔子\n林远出生。\n# 风雪夜\n林远拜师。';
    const timeline = extractCharacterTimeline(text, ['林远']);
    expect(timeline.map((e) => [e.chapterLabel, e.title])).toEqual([
      ['楔子', '林远出生'],
      ['风雪夜', '林远拜师'],
    ]);
  });

  it('只有启发式标题时退化为正文片段', () => {
    const text =
      '楔子\n\n林远出生在青州城外的一个小村子里，那一年大雪封山，村里的老人都说这孩子命硬。';
    const timeline = extractCharacterTimeline(text, ['林远']);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].chapterLabel).toBe('正文片段 1');
  });
});

describe('extractCharacterTimeline — 标题与摘要', () => {
  it('章节副标题去掉句末标点作为标题', () => {
    const timeline = extractCharacterTimeline('第一章 林远下山！\n林远走了。', ['林远']);
    expect(timeline[0].title).toBe('林远下山');
  });

  it('副标题超过 30 字被截断且不带省略号', () => {
    const sub = '远'.repeat(40);
    const timeline = extractCharacterTimeline(`第一章 ${sub}\n林远走了。`, ['林远']);
    expect(timeline[0].title).toBe('远'.repeat(30));
  });

  it('无副标题时用摘要首句作为标题', () => {
    const timeline = extractCharacterTimeline('第一章\n林远笑了。林远又哭了。', ['林远']);
    expect(timeline[0].title).toBe('林远笑了');
    expect(timeline[0].summary).toBe('林远笑了。 林远又哭了。');
  });

  it('摘要只选包含人物的句子，并按 maxSummaryLength 截止', () => {
    const text = '第一章 试剑\n苏晴来了。林远出剑。风停了。林远收剑。林远离开。';
    const all = extractCharacterTimeline(text, ['林远']);
    expect(all[0].summary).toBe('林远出剑。 林远收剑。 林远离开。');
    const short = extractCharacterTimeline(text, ['林远'], { maxSummaryLength: 10 });
    expect(short[0].summary).toBe('林远出剑。');
  });

  it('单句过长时在靠后的逗号处截断并加省略号', () => {
    const text = '第一章\n林远拔出长剑，剑光如雪，照亮了整座青州城的夜空和城头的旗帜。';
    const timeline = extractCharacterTimeline(text, ['林远'], { maxSummaryLength: 20 });
    expect(timeline[0].summary).toBe('林远拔出长剑，剑光如雪，…');
  });

  it('单句过长且没有合适的软断点时硬截断', () => {
    const text = `第一章\n林远${'走'.repeat(28)}。`;
    const timeline = extractCharacterTimeline(text, ['林远'], { maxSummaryLength: 10 });
    expect(timeline[0].summary).toBe(`林远${'走'.repeat(8)}…`);
  });

  it('大小写不一致时没有“相关句”，摘要退化为整段正文', () => {
    const text = '1. Prologue\nlin yuan walked into the rain';
    const timeline = extractCharacterTimeline(text, ['Lin']);
    expect(timeline[0].summary).toBe('lin yuan walked into the rain');
  });

  it('正文中的换行被折叠为空格', () => {
    const text = '第一章 雨\n林远\n撑伞。';
    const timeline = extractCharacterTimeline(text, ['林远']);
    // 句子正则遇到 \n 前已被替换为空格，所以整段是一句
    expect(timeline[0].summary).toBe('林远 撑伞。');
  });

  it('对白中的人物也能命中（弯引号与直角引号）', () => {
    const text = '第一章 对峙\n“林远，你走吧。”苏晴说。\n「我不走。」林远答。';
    const timeline = extractCharacterTimeline(text, ['林远']);
    expect(timeline[0].mentionCount).toBe(2);
    expect(timeline[0].summary).toContain('林远答');
  });
});

describe('extractCharacterTimeline — 正文片段回退', () => {
  const p = (s: string): string => s.padEnd(10, '。');

  it('段落按 fallbackSegmentChars 贪心合并', () => {
    const text = [p('林远一'), p('林远二'), p('林远三')].join('\n\n');
    const timeline = extractCharacterTimeline(text, ['林远'], { fallbackSegmentChars: 25 });
    expect(timeline.map((e) => e.chapterLabel)).toEqual(['正文片段 1', '正文片段 2']);
    expect(timeline[0].mentionCount).toBe(2);
    expect(timeline[0].chapterNumber).toBeUndefined();
  });

  it('正文片段的 startLine/endLine 应是原文行号而非段落序号', () => {
    // 期望：第 2 段位于原文第 3 行（中间隔一个空行），startLine 应为 3
    // 实际：extract-timeline.ts:343-346 把“已消费段落数”当成行号，
    //       得到 startLine=2，与编辑器跳转行号不一致
    const text = '林远第一段。\n\n林远第二段。\n\n林远第三段。';
    const timeline = extractCharacterTimeline(text, ['林远'], { fallbackSegmentChars: 1 });
    expect(timeline.map((e) => e.startLine)).toEqual([1, 3, 5]);
  });

  it('正文开头有空行时章节行号应与原文对齐', () => {
    // 期望：标题位于原文第 3 行，startLine 应为 3
    // 实际：extract-timeline.ts:385 先对 content 做 trim()，再在去掉前导空行的文本上计算行号，
    //       导致所有行号整体前移
    const text = '\n\n第一章 下山\n林远下山。';
    const timeline = extractCharacterTimeline(text, ['林远']);
    expect(timeline[0].startLine).toBe(3);
  });
});

describe('extractCharacterTimeline — maxEntries', () => {
  const text = Array.from(
    { length: 6 },
    (_, i) => `第${i + 1}章 事件${i + 1}\n林远经历${i + 1}。`
  ).join('\n');

  it('不设置或为 0 时返回全部', () => {
    expect(extractCharacterTimeline(text, ['林远'])).toHaveLength(6);
    expect(extractCharacterTimeline(text, ['林远'], { maxEntries: 0 })).toHaveLength(6);
  });

  it('超出上限时保留头部 ceil(n/2) 与尾部其余', () => {
    const t = extractCharacterTimeline(text, ['林远'], { maxEntries: 3 });
    expect(t.map((e) => e.chapterNumber)).toEqual([1, 2, 6]);
    const t4 = extractCharacterTimeline(text, ['林远'], { maxEntries: 4 });
    expect(t4.map((e) => e.chapterNumber)).toEqual([1, 2, 5, 6]);
  });

  it('上限 ≤2 时只取开头', () => {
    const t = extractCharacterTimeline(text, ['林远'], { maxEntries: 2 });
    expect(t.map((e) => e.chapterNumber)).toEqual([1, 2]);
  });

  it('上限不小于条目数时原样返回', () => {
    expect(extractCharacterTimeline(text, ['林远'], { maxEntries: 6 })).toHaveLength(6);
  });
});
