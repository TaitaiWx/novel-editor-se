import { describe, expect, it } from 'vitest';
import {
  parseInlineFormatting,
  parseMarkdown,
  parseTableRow,
  segmentsToText,
} from '../../../src/main/document-exporter/markdown';

describe('document-exporter/markdown', () => {
  it('解析行内格式：链接、粗斜体、粗体、斜体、删除线', () => {
    expect(parseInlineFormatting('a [站点](https://x.io) ***b*** **c** *d* ~~e~~ f')).toEqual([
      { text: 'a ' },
      { text: '站点', link: 'https://x.io' },
      { text: ' ' },
      { text: 'b', bold: true, italic: true },
      { text: ' ' },
      { text: 'c', bold: true },
      { text: ' ' },
      { text: 'd', italic: true },
      { text: ' ' },
      { text: 'e', strike: true },
      { text: ' f' },
    ]);
  });

  it('空文本也返回一个片段', () => {
    expect(parseInlineFormatting('')).toEqual([{ text: '' }]);
  });

  it('解析表格行，去除首尾竖线与空白', () => {
    expect(parseTableRow('| 名字 | 等级 |')).toEqual(['名字', '等级']);
    expect(parseTableRow('a|b')).toEqual(['a', 'b']);
  });

  it('解析各类块级节点', () => {
    const md = [
      '# 第一章',
      '',
      '正文第一行',
      '正文第二行',
      '',
      '## 小节',
      '---',
      '```ts',
      'const a = 1;',
      '',
      '```',
      '> 引用一',
      '> 引用二',
      '',
      '| 名字 | 等级 |',
      '| --- | :-: |',
      '| 张三 | 10 |',
      '',
      '- 苹果',
      '* 香蕉',
      '1. 一',
      '2. 二',
    ].join('\n');

    const nodes = parseMarkdown(md);
    expect(nodes.map((n) => n.type)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'hr',
      'code-block',
      'blockquote',
      'table',
      'list',
      'ordered-list',
    ]);
    expect(nodes[0]).toMatchObject({ level: 1 });
    expect(segmentsToText(nodes[1].segments)).toBe('正文第一行\n正文第二行');
    expect(nodes[2]).toMatchObject({ level: 2 });
    expect(nodes[4]).toEqual({ type: 'code-block', text: 'const a = 1;\n', language: 'ts' });
    expect(segmentsToText(nodes[5].segments)).toBe('引用一\n引用二');
    expect(nodes[6].rows).toEqual([
      ['名字', '等级'],
      ['张三', '10'],
    ]);
    expect(nodes[7].items?.map((item) => segmentsToText(item))).toEqual(['苹果', '香蕉']);
    expect(nodes[8].items?.map((item) => segmentsToText(item))).toEqual(['一', '二']);
  });

  it('段落遇到标题/列表时结束', () => {
    const nodes = parseMarkdown('文字\n# 标题\n文字2\n- 项');
    expect(nodes.map((n) => n.type)).toEqual(['paragraph', 'heading', 'paragraph', 'list']);
  });

  it('未闭合的代码块吞掉剩余内容', () => {
    const nodes = parseMarkdown('```\nline1\nline2');
    expect(nodes).toEqual([{ type: 'code-block', text: 'line1\nline2', language: '' }]);
  });
});
