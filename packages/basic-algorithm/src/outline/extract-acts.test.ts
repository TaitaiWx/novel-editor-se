import { describe, it, expect } from 'vitest';
import { extractActs } from './extract-acts';

describe('extractActs', () => {
  it('returns empty array for empty text', () => {
    expect(extractActs('')).toEqual([]);
  });

  it('extracts explicit act/scene structure', () => {
    const text = '第一幕 开端\n内容\n第一场 初见\n场景内容\n第二场 冲突\n场景内容';
    const result = extractActs(text);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].title).toContain('第一幕');
  });

  it('auto-generates acts from chapters when no act markers', () => {
    const chapters = Array.from({ length: 15 }, (_, i) => `第${i + 1}章 标题${i + 1}\n内容`).join(
      '\n'
    );
    const result = extractActs(chapters);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});
