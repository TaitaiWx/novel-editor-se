import { describe, it, expect } from 'vitest';
import { extractOutline } from './extract-outline';

describe('extractOutline', () => {
  it('returns empty array for empty text', () => {
    expect(extractOutline('')).toEqual([]);
  });

  it('extracts Markdown headings', () => {
    const text = '# 第一章 开始\n正文内容\n## 第一节 起缘\n更多内容';
    const result = extractOutline(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ level: 1, text: '第一章 开始', line: 1, source: 'markdown' });
    expect(result[1]).toMatchObject({ level: 2, text: '第一节 起缘', line: 3, source: 'markdown' });
  });

  it('extracts Chinese section markers', () => {
    const text = '第一章 序幕\n正文\n第二章 风起\n正文';
    const result = extractOutline(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      level: 1,
      text: '第一章 序幕',
      line: 1,
      source: 'chinese-section',
    });
    expect(result[1]).toMatchObject({
      level: 1,
      text: '第二章 风起',
      line: 3,
      source: 'chinese-section',
    });
  });

  it('extracts numbered headings', () => {
    const text = '1. 引言\n正文\n2. 主题\n正文';
    const result = extractOutline(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ level: 1, text: '引言', source: 'numbered' });
    expect(result[1]).toMatchObject({ level: 1, text: '主题', source: 'numbered' });
  });

  it('extracts separator-style titles', () => {
    const text = '--- 第一幕 ---\n正文内容';
    const result = extractOutline(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ level: 1, text: '第一幕', source: 'separator' });
  });

  it('handles mixed heading styles', () => {
    const text = '# 序章\n正文\n第一章 始\n正文\n## 1.1 段落\n正文';
    const result = extractOutline(text);
    expect(result).toHaveLength(3);
    expect(result[0].source).toBe('markdown');
    expect(result[1].source).toBe('chinese-section');
    expect(result[2].source).toBe('markdown');
  });

  it('respects enableHeuristic=false', () => {
    const text = '正常文本\n\n短行\n\n正常文本';
    const result = extractOutline(text, { enableHeuristic: false });
    expect(result).toHaveLength(0);
  });

  it('assigns correct line numbers', () => {
    const text = '\n\n# 标题A\n\n\n# 标题B\n';
    const result = extractOutline(text);
    expect(result[0].line).toBe(3);
    expect(result[1].line).toBe(6);
  });

  it('handles multi-level Chinese sections', () => {
    const text = '第一卷 天下\n内容\n第一回 始\n内容\n第二回 续\n内容';
    const result = extractOutline(text);
    expect(result).toHaveLength(3);
    expect(result[0].level).toBe(1); // 卷
    expect(result[1].level).toBe(2); // 回
    expect(result[2].level).toBe(2); // 回
  });
});
