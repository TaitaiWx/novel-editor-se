import { describe, expect, it } from 'vitest';
import { formatChapterContent } from '@/render/utils/chapterFormatter';

describe('formatChapterContent 补充分支', () => {
  it('统一 CRLF、去掉首尾空行并计数', () => {
    const raw = '\r\n\r\n第一章 风起\r\n  林墨推开门。\r\n\r\n';
    const result = formatChapterContent(raw);
    expect(result.content).toBe('第一章 风起\n　　林墨推开门。');
    expect(result.changed).toBe(true);
    expect(result.paragraphCount).toBe(1);
  });

  it('代码块内容原样保留（仅去尾部空白）', () => {
    const raw = ['```', '  缩进保持  ', '', '```', '正文'].join('\n');
    expect(formatChapterContent(raw).content).toBe(
      ['```', '  缩进保持', '', '```', '　　正文'].join('\n')
    );
  });

  it('各类结构行不参与段落合并', () => {
    const raw = [
      '> 引用',
      '| 表格 |',
      '- 列表',
      '* 星号',
      '+ 加号',
      '---',
      '1. 有序',
      '2、中文序号',
      '第三幕 决战',
      '【旁白】',
      '　　“走吧。”苏晴说。',
    ].join('\n');
    const result = formatChapterContent(raw);
    expect(result.content.split('\n')).toEqual([
      '> 引用',
      '| 表格 |',
      '- 列表',
      '* 星号',
      '+ 加号',
      '---',
      '1. 有序',
      '2、中文序号',
      '第三幕 决战',
      '【旁白】',
      '　　“走吧。”苏晴说。',
    ]);
    expect(result.paragraphCount).toBe(1);
  });

  it('已规范的内容 changed=false；空内容也安全', () => {
    expect(formatChapterContent('　　已经规范。').changed).toBe(false);
    expect(formatChapterContent('')).toEqual({
      content: '',
      changed: false,
      paragraphCount: 0,
      mergedLineCount: 0,
      collapsedBlankLineCount: 0,
    });
  });
});
