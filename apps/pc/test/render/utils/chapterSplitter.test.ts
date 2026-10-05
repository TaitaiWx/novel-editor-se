import { describe, expect, it } from 'vitest';
import { isLargeText, splitChapters } from '@/render/utils/chapterSplitter';

describe('splitChapters', () => {
  it('按“第X章”标准标记拆分并计算偏移量', () => {
    const text = [
      '第一章 风起青萍',
      '林墨推开客栈的木门，“掌柜的，来壶酒。”',
      '',
      '第二章 夜雨',
      '雨下了一整夜。',
    ].join('\n');
    const chapters = splitChapters(text);

    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toMatchObject({ index: 0, title: '第一章 风起青萍', offset: 0 });
    expect(chapters[0].content).toBe('林墨推开客栈的木门，“掌柜的，来壶酒。”');
    expect(chapters[1].title).toBe('第二章 夜雨');
    expect(text.slice(chapters[1].offset, chapters[1].offset + chapters[1].length)).toBe(
      '第二章 夜雨\n雨下了一整夜。'
    );
    expect(chapters[0].length).toBe(text.indexOf('第二章') - 1);
  });

  it('识别楔子、尾声、番外与 Chapter N 等标记', () => {
    const text = [
      '楔子',
      '很久以前。',
      'Chapter 1 Begin',
      '开端。',
      '尾声',
      '结束。',
      '番外 苏晴篇',
      '后日谈。',
    ].join('\n');
    const titles = splitChapters(text).map((ch) => ch.title);
    expect(titles).toEqual(['楔子', 'Chapter 1 Begin', '尾声', '番外 苏晴篇']);
  });

  it('首个章节前存在内容时插入“前言”并重新编号', () => {
    const text = ['作者的话：感谢支持。', '', '第1章 开端', '正文一', '第2章 转折', '正文二'].join(
      '\n'
    );
    const chapters = splitChapters(text);

    expect(chapters.map((c) => c.title)).toEqual(['前言', '第1章 开端', '第2章 转折']);
    expect(chapters.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(chapters[0]).toMatchObject({ content: '作者的话：感谢支持。', offset: 0 });
    expect(chapters[1].offset).toBe(text.indexOf('第1章'));
  });

  it('首个章节前只有空行时不插入前言', () => {
    const chapters = splitChapters(['', '  ', '第一章', 'a', '第二章', 'b'].join('\n'));
    expect(chapters.map((c) => c.title)).toEqual(['第一章', '第二章']);
  });

  it('标准标记不足两个时回退到纯数字行', () => {
    const text = ['1', '少年出山。', '02', '初入江湖。'].join('\n');
    const chapters = splitChapters(text);
    expect(chapters.map((c) => c.title)).toEqual(['1', '02']);
    expect(chapters[1].content).toBe('初入江湖。');
  });

  it('没有任何章节标记时整篇视为“全文”', () => {
    const text = '第一章 唯一的一章\n只有一个标题，不足以拆分。';
    expect(splitChapters(text)).toEqual([
      { index: 0, title: '全文', content: text, offset: 0, length: text.length },
    ]);
  });
});

describe('isLargeText', () => {
  it('以 5 万字为阈值判断大文件', () => {
    expect(isLargeText('字'.repeat(50_000))).toBe(false);
    expect(isLargeText('字'.repeat(50_001))).toBe(true);
  });
});
