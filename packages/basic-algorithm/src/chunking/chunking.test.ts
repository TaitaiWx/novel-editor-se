import { describe, it, expect } from 'vitest';
import { chunkByFixedLength } from './fixed-length';
import { chunkBySentence } from './sentence';
import { chunkByParagraph } from './paragraph';

describe('chunkByFixedLength', () => {
  it('returns empty for empty text', () => {
    expect(chunkByFixedLength('')).toEqual([]);
  });

  it('creates single chunk for short text', () => {
    const result = chunkByFixedLength('hello world', { chunkSize: 100 });
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('hello world');
    expect(result[0].index).toBe(0);
  });

  it('splits long text into multiple chunks', () => {
    const text = 'a'.repeat(100);
    const result = chunkByFixedLength(text, { chunkSize: 30 });
    expect(result.length).toBeGreaterThan(1);
    expect(result[0].text).toHaveLength(30);
  });

  it('handles overlap correctly', () => {
    const text = 'abcdefgh';
    const result = chunkByFixedLength(text, { chunkSize: 6, overlap: 2 });
    // step = 4, chunks: [0,6)="abcdef", [4,8)="efgh"
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('abcdef');
    expect(result[1].text).toBe('efgh');
  });

  it('throws for invalid chunkSize', () => {
    expect(() => chunkByFixedLength('a', { chunkSize: 0 })).toThrow();
  });

  it('throws when overlap >= chunkSize', () => {
    expect(() => chunkByFixedLength('a', { chunkSize: 5, overlap: 5 })).toThrow();
  });
});

describe('chunkBySentence', () => {
  it('returns empty for empty text', () => {
    expect(chunkBySentence('')).toEqual([]);
  });

  it('chunks text by sentences', () => {
    const text = '这是第一句。这是第二句。这是第三句。';
    const result = chunkBySentence(text, { maxChunkSize: 100 });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((c) => c.text.length > 0)).toBe(true);
  });
});

describe('chunkByParagraph', () => {
  it('returns empty for empty text', () => {
    expect(chunkByParagraph('')).toEqual([]);
  });

  it('chunks text by paragraphs', () => {
    const text = '第一段内容\n\n第二段内容\n\n第三段内容';
    const result = chunkByParagraph(text, { maxChunkSize: 100 });
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});
