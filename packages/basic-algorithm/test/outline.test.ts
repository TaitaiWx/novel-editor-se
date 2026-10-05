import { describe, it, expect } from 'vitest';
import { extractOutline, extractActs } from '../src';
import type { OutlineNode } from '../src';

const texts = (nodes: OutlineNode[]): string[] => nodes.map((n) => n.text);

describe('extractOutline — 中文章节标记', () => {
  it('卷/部/章/幕 为 1 级，回/集/节/篇 为 2 级', () => {
    const text = [
      '卷首语',
      '第一卷 潜龙在渊',
      '正文',
      '第一部 少年游',
      '正文',
      '第一章 林远下山',
      '正文',
      '第一节 渡口',
      '正文',
      '第二回 苏晴夜访',
      '正文',
      '第三集 风雪',
      '正文',
      '第四篇 归来',
      '正文',
      '第一幕 开场',
    ].join('\n');
    const result = extractOutline(text, { enableHeuristic: false });
    expect(result.map((n) => [n.text, n.level])).toEqual([
      ['第一卷 潜龙在渊', 1],
      ['第一部 少年游', 1],
      ['第一章 林远下山', 1],
      ['第一节 渡口', 2],
      ['第二回 苏晴夜访', 2],
      ['第三集 风雪', 2],
      ['第四篇 归来', 2],
      ['第一幕 开场', 1],
    ]);
    expect(result.every((n) => n.source === 'chinese-section')).toBe(true);
  });

  it('支持阿拉伯数字与大数汉字（第123章、第一百零八回、第〇章）', () => {
    const text = '第123章 林远破境\n第一百零八回 聚义\n第〇章 楔子';
    expect(texts(extractOutline(text))).toEqual([
      '第123章 林远破境',
      '第一百零八回 聚义',
      '第〇章 楔子',
    ]);
  });

  it('无副标题时只保留标记本身，标记与标题之间无空格也可识别', () => {
    const result = extractOutline('第五章\n正文\n第六章苏晴\n正文', { enableHeuristic: false });
    expect(texts(result)).toEqual(['第五章', '第六章 苏晴']);
  });

  it('行首缩进被 trim 后仍能识别，行号按原文 1-based 计算', () => {
    const text = '\n\n    第二章 夜雨\n林远推开门。';
    const result = extractOutline(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      level: 1,
      text: '第二章 夜雨',
      line: 3,
      source: 'chinese-section',
    });
  });

  it('行中出现“第一章”不算标题（必须位于行首）', () => {
    const text = '林远翻到了第一章，又合上了书。\n苏晴笑道：“看不懂吧？”';
    expect(extractOutline(text, { enableHeuristic: false })).toEqual([]);
  });

  it('“卷一”这种倒装写法不被内置规则识别，可通过 customPatterns 补充', () => {
    const text = '卷一 江湖夜雨\n林远独行。\n卷二 十年灯\n苏晴归来。';
    expect(extractOutline(text, { enableHeuristic: false })).toEqual([]);

    const custom = extractOutline(text, {
      enableHeuristic: false,
      customPatterns: [/^(卷[一二三四五六七八九十]+\s*.*)$/],
    });
    expect(custom).toEqual([
      { level: 1, text: '卷一 江湖夜雨', line: 1, source: 'heuristic' },
      { level: 1, text: '卷二 十年灯', line: 3, source: 'heuristic' },
    ]);
  });

  it('customPatterns 无捕获组时使用整行；多个规则只命中第一个', () => {
    const text = '【番外】苏晴的日记\n正文';
    const result = extractOutline(text, {
      enableHeuristic: false,
      customPatterns: [/^【番外】/, /^(【.+】)/],
    });
    expect(result).toEqual([
      { level: 1, text: '【番外】苏晴的日记', line: 1, source: 'heuristic' },
    ]);
  });

  it('内置规则优先于 customPatterns', () => {
    const result = extractOutline('第一章 开端', {
      customPatterns: [/^(第.+)$/],
    });
    expect(result[0].source).toBe('chinese-section');
  });
});

describe('extractOutline — Markdown / 编号 / 分隔线', () => {
  it('Markdown 1~6 级标题，####### 不是标题；# 后必须有空格', () => {
    const text = [
      '# 一',
      '## 二',
      '### 三',
      '#### 四',
      '##### 五',
      '###### 六',
      '####### 七',
      '#没有空格',
    ].join('\n');
    const result = extractOutline(text, { enableHeuristic: false });
    expect(result.map((n) => n.level)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(texts(result)).toEqual(['一', '二', '三', '四', '五', '六']);
  });

  it('Markdown 包裹中文章节时以 markdown 层级为准', () => {
    const result = extractOutline('### 第三回 林远夜探');
    expect(result[0]).toMatchObject({ level: 3, text: '第三回 林远夜探', source: 'markdown' });
  });

  it('多级编号层级随点号深度增加，最多 6 级', () => {
    const text = '1. 序\n1.2 起\n1.2.3 承\n1.2.3.4.5.6.7 极深';
    const result = extractOutline(text, { enableHeuristic: false });
    expect(result.map((n) => n.level)).toEqual([1, 2, 3, 6]);
    expect(texts(result)).toEqual(['序', '起', '承', '极深']);
  });

  it('支持顿号与右括号编号', () => {
    const result = extractOutline('1、林远出场\n2) 苏晴出场', { enableHeuristic: false });
    expect(texts(result)).toEqual(['林远出场', '苏晴出场']);
    expect(result.every((n) => n.source === 'numbered')).toBe(true);
  });

  it('编号后文本 ≥60 字视为正文而不是标题', () => {
    const longLine = '1. ' + '林'.repeat(60);
    const okLine = '2. ' + '苏'.repeat(59);
    const result = extractOutline(`${longLine}\n${okLine}`, { enableHeuristic: false });
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('苏'.repeat(59));
  });

  it('纯数字行（如字数 123456）不是标题', () => {
    expect(extractOutline('123456', { enableHeuristic: false })).toEqual([]);
  });

  it('日期行 "2024.03.15" 不应被识别为编号标题（源码注释声称已排除）', () => {
    // 期望：注释 "排除纯数字行（如 "123456" 或 "2024.03.15"）" 表明日期行不应成为标题
    // 实际：RE_NUMBERED 回溯为前缀 "2024.03" + 分隔 "." + 文本 "15"，产生 level=2 的 numbered 节点
    expect(extractOutline('2024.03.15', { enableHeuristic: false })).toEqual([]);
  });

  it('分隔线标题支持 --- / *** / === 三种写法', () => {
    const text = '--- 第一幕 ---\n正文\n*** 回忆 ***\n正文\n=== 尾声 ===';
    const result = extractOutline(text, { enableHeuristic: false });
    // 注意：“--- 第一幕 ---” 不以“第”开头，所以走分隔线规则
    expect(result.map((n) => [n.text, n.source])).toEqual([
      ['第一幕', 'separator'],
      ['回忆', 'separator'],
      ['尾声', 'separator'],
    ]);
  });

  it('纯场景分隔符 *** 不被视作标题', () => {
    const text = '林远离开了。\n\n***\n\n三年后，苏晴回到了青州。';
    expect(texts(extractOutline(text))).not.toContain('***');
    expect(extractOutline(text, { enableHeuristic: false })).toEqual([]);
  });
});

describe('extractOutline — 启发式', () => {
  it('被空行包围的短行被识别为 2 级 heuristic 标题', () => {
    const text =
      '楔子\n\n林远站在城头，看着远处的烽火。这一夜，青州城没有人睡得着，连更夫都忘了敲梆子，只有风声。\n\n风起\n\n苏晴提灯而来。';
    const result = extractOutline(text);
    expect(result.map((n) => [n.text, n.line, n.level, n.source])).toEqual([
      ['楔子', 1, 2, 'heuristic'],
      ['风起', 5, 2, 'heuristic'],
      ['苏晴提灯而来。', 7, 2, 'heuristic'],
    ]);
  });

  it('长度边界：1 字不算，2 字算；40 字算，41 字不算', () => {
    const t1 = '\n林\n';
    const t2 = '\n林远\n';
    const t40 = '\n' + '远'.repeat(40) + '\n';
    const t41 = '\n' + '远'.repeat(41) + '\n';
    expect(extractOutline(t1)).toHaveLength(0);
    expect(extractOutline(t2)).toHaveLength(1);
    expect(extractOutline(t40)).toHaveLength(1);
    expect(extractOutline(t41)).toHaveLength(0);
  });

  it('上下有非空行的短行不是标题', () => {
    expect(extractOutline('林远说\n走吧\n苏晴点头')).toEqual([]);
  });

  it('以中文标点开头或纯数字的短行被排除', () => {
    const text = '\n……\n\n，然后呢\n\n123\n\n___\n';
    expect(extractOutline(text)).toEqual([]);
  });

  it('「」直角引号开头的独立对白行不应被识别为标题', () => {
    const result = extractOutline('\n「走吧。」\n');
    expect(result).toHaveLength(0);
  });

  it('以中文弯引号 “ 开头的独立对白行不应被识别为标题', () => {
    // 期望：排除正则的注释写着“不以标点开头”，并试图列出中文引号 “”‘’
    // 实际：源码 extract-outline.ts:154 中的引号是 ASCII 的 "" 和 ''，中文 “ 未被排除，
    //       网文中常见的“空行分隔对白”会被大量误判为标题
    const text = '林远看着她。\n\n“你终于来了。”\n\n苏晴没有回答。';
    expect(extractOutline(text).map((n) => n.text)).not.toContain('“你终于来了。”');
  });

  it('enableHeuristic=false 时完全关闭启发式', () => {
    expect(extractOutline('\n楔子\n', { enableHeuristic: false })).toEqual([]);
  });

  it('CRLF 文本：\\r 被 trim 掉，标题文本不含 \\r', () => {
    const result = extractOutline('第一章 林远\r\n正文\r\n第二章 苏晴\r\n');
    expect(texts(result)).toEqual(['第一章 林远', '第二章 苏晴']);
    expect(result.map((n) => n.line)).toEqual([1, 3]);
  });
});

describe('extractActs — 显式幕/场', () => {
  const script = [
    '第一幕 青州夜雨',
    '（幕前说明，不属于任何场景）',
    '第一场 城门',
    '',
    '林远：“开门！”',
    '守卫：“宵禁了。”',
    '第二场 客栈',
    '苏晴独坐窗前。',
    '第二幕 京城',
    '第一场 金殿',
    '　　皇帝沉默不语。',
  ].join('\n');

  it('构建 幕→场 层级、行号与预览', () => {
    expect(extractActs(script)).toEqual([
      {
        title: '第一幕 青州夜雨',
        line: 1,
        scenes: [
          { title: '第一场 城门', line: 3, preview: '林远：“开门！”' },
          { title: '第二场 客栈', line: 7, preview: '苏晴独坐窗前。' },
        ],
      },
      {
        title: '第二幕 京城',
        line: 9,
        scenes: [{ title: '第一场 金殿', line: 10, preview: '皇帝沉默不语。' }],
      },
    ]);
  });

  it('只有幕没有场时 scenes 为空数组', () => {
    expect(extractActs('第一幕\n独白\n第二幕 终章')).toEqual([
      { title: '第一幕', line: 1, scenes: [] },
      { title: '第二幕 终章', line: 3, scenes: [] },
    ]);
  });

  it('没有幕的场景被挂到“默认幕”下，默认幕行号为首个场景行号', () => {
    const result = extractActs('序言\n第一场 渡口\n林远上船。\n第二场 江心\n');
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('默认幕');
    expect(result[0].line).toBe(2);
    expect(result[0].scenes.map((s) => s.title)).toEqual(['第一场 渡口', '第二场 江心']);
    expect(result[0].scenes[1].preview).toBe('');
  });

  it('预览超过 80 字截断并加省略号，恰好 80 字不截断', () => {
    const long = '林'.repeat(81);
    const exact = '苏'.repeat(80);
    const result = extractActs(`第一幕\n第一场\n${long}\n第二场\n${exact}`);
    expect(result[0].scenes[0].preview).toBe('林'.repeat(80) + '…');
    expect(result[0].scenes[1].preview).toBe(exact);
  });

  it('支持阿拉伯数字幕号', () => {
    const result = extractActs('第3幕 高潮\n第12场 决战');
    expect(result[0].title).toBe('第3幕 高潮');
    expect(result[0].scenes[0].title).toBe('第12场 决战');
  });
});

describe('extractActs — 由章节自动生成', () => {
  it('≤10 章时生成单个“全篇”幕，每章一个场景并带预览', () => {
    const text = '第一章 林远下山\n\n\n山下雾很大。\n第二章 苏晴\n她来了。';
    const result = extractActs(text);
    expect(result).toEqual([
      {
        title: '全篇',
        line: 1,
        scenes: [
          { title: '第一章 林远下山', line: 1, preview: '山下雾很大。' },
          { title: '第二章 苏晴', line: 5, preview: '她来了。' },
        ],
      },
    ]);
  });

  it('25 章时按每 10 章分为 3 幕，命名为 第N幕', () => {
    const text = Array.from(
      { length: 25 },
      (_, i) => `第${i + 1}章 标题${i + 1}\n正文${i + 1}`
    ).join('\n');
    const result = extractActs(text);
    expect(result.map((a) => a.title)).toEqual(['第1幕', '第2幕', '第3幕']);
    expect(result.map((a) => a.scenes.length)).toEqual([10, 10, 5]);
    expect(result[1].line).toBe(21); // 第11章位于第 21 行
    expect(result[2].scenes[4]).toEqual({ title: '第25章 标题25', line: 49, preview: '正文25' });
  });

  it('预览只向后看 5 行，超出则为空', () => {
    const near = '第一章 近\n\n\n\n\n第五行后的正文';
    expect(extractActs(near)[0].scenes[0].preview).toBe('第五行后的正文');
    const text = '第一章 空\n\n\n\n\n\n远处的正文';
    expect(extractActs(text)[0].scenes[0].preview).toBe('');
  });

  it('紧邻的下一个标题会被当作预览（记录当前行为）', () => {
    const result = extractActs('第一章 甲\n第二章 乙\n正文');
    expect(result[0].scenes[0].preview).toBe('第二章 乙');
  });

  it('预览超过 80 字被截断', () => {
    const result = extractActs(`第一章\n${'远'.repeat(100)}`);
    expect(result[0].scenes[0].preview).toBe('远'.repeat(80) + '…');
  });

  it('没有任何标题且不启用启发式时返回空', () => {
    expect(extractActs('林远走了。\n\n苏晴哭了。')).toEqual([]);
  });

  it('自动生成时不使用启发式标题（空行包围的短行不成为场景）', () => {
    expect(extractActs('\n楔子\n\n正文很长很长很长。')).toEqual([]);
  });
});
