import { describe, it, expect } from 'vitest';
import { formatNumber } from '../src';
import { formatNumber as direct } from '../src/format-number';

describe('formatNumber', () => {
  it('index 导出与源文件导出是同一个函数', () => {
    expect(formatNumber).toBe(direct);
  });

  it.each([
    [0, '0'],
    [7, '7'],
    [999, '999'],
    [1000, '1,000'],
    [12345, '12,345'],
    [1234567, '1,234,567'],
    [1000000000, '1,000,000,000'],
  ])('整数 %d → %s', (input, expected) => {
    expect(formatNumber(input)).toBe(expected);
  });

  it('负数保留负号并分组', () => {
    expect(formatNumber(-1234567)).toBe('-1,234,567');
    expect(formatNumber(-12)).toBe('-12');
  });

  it('小数部分默认最多保留 3 位（四舍五入）', () => {
    expect(formatNumber(1234.5)).toBe('1,234.5');
    expect(formatNumber(1234.5678)).toBe('1,234.568');
    expect(formatNumber(0.1 + 0.2)).toBe('0.3');
  });

  it('不受运行环境默认 locale 影响（固定 en-US）', () => {
    // 德语 locale 会用 "." 作千位分隔，这里确保输出稳定
    expect(formatNumber(98765)).toBe('98,765');
  });

  it('特殊数值', () => {
    expect(formatNumber(Number.NaN)).toBe('NaN');
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('∞');
    expect(formatNumber(-0)).toBe('-0');
  });

  it('适用于小说字数统计的典型值', () => {
    // 一部 300 万字长篇
    expect(formatNumber(3_000_000)).toBe('3,000,000');
  });
});
