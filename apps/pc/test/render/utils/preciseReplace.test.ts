import { describe, expect, it } from 'vitest';
import {
  formatPreciseReplaceReport,
  normalizedSearch,
  preciseReplace,
  preciseReplaceWithReport,
} from '@/render/utils/preciseReplace';

const SOURCE = '　　林墨握紧长剑，\n  低声道：“今夜，\t必须离开青云城。”\n苏晴点了点头。';

describe('normalizedSearch', () => {
  it('忽略空白差异并映射回原文位置', () => {
    const match = normalizedSearch(SOURCE, '低声道：“今夜， 必须离开青云城。”');
    expect(match).not.toBeNull();
    expect(SOURCE.slice(match!.from, match!.to)).toBe('低声道：“今夜，\t必须离开青云城。”');
  });

  it('目标归一化为空或不存在时返回 null', () => {
    expect(normalizedSearch(SOURCE, '   \n ')).toBeNull();
    expect(normalizedSearch(SOURCE, '不存在的句子')).toBeNull();
  });

  it('源文本尾部空白会被裁掉', () => {
    const match = normalizedSearch('结尾一句话。   \n\n', '结尾一句话。');
    expect(match).toEqual({ from: 0, to: 6 });
  });
});

describe('preciseReplaceWithReport', () => {
  it('精确匹配直接替换', () => {
    const result = preciseReplaceWithReport(SOURCE, '苏晴点了点头。', '苏晴轻轻颔首。');
    expect(result.content).toBe(SOURCE.replace('苏晴点了点头。', '苏晴轻轻颔首。'));
    expect(result.report.strategy).toBe('exact');
    expect(result.report.diagnostics.firstExactIndex).toBe(SOURCE.indexOf('苏晴'));
    expect(result.report.suggestions).toEqual([]);
  });

  it('精确匹配失败时回退到空白归一化匹配', () => {
    const result = preciseReplaceWithReport(SOURCE, '林墨握紧长剑， 低声道', '林墨拔剑而起，喝道');
    expect(result.report.strategy).toBe('normalized-window');
    expect(result.report.matched).toBe(true);
    expect(result.content).toBe(
      '　　林墨拔剑而起，喝道：“今夜，\t必须离开青云城。”\n苏晴点了点头。'
    );
    expect(result.report.diagnostics.scannedCandidates).toBe(1);
  });

  it('original 归一化后为空时给出诊断', () => {
    const result = preciseReplaceWithReport('abc', '  \n', 'x');
    expect(result.content).toBeNull();
    expect(result.report.matched).toBe(false);
    expect(result.report.diagnostics.normalizedOriginalLength).toBe(0);
    expect(result.report.suggestions.length).toBeGreaterThan(0);
  });

  it('完全未命中时返回 none 策略', () => {
    const result = preciseReplaceWithReport(SOURCE, '王五拍案而起', 'x');
    expect(result.content).toBeNull();
    expect(result.report.strategy).toBe('none');
    expect(result.report.reason).toContain('未能在当前文件中定位');
  });
});

describe('preciseReplace / formatPreciseReplaceReport', () => {
  it('兼容旧接口只返回文本', () => {
    expect(preciseReplace('甲乙丙', '乙', '丁')).toBe('甲丁丙');
    expect(preciseReplace('甲乙丙', '戊', '丁')).toBeNull();
  });

  it('格式化报告包含诊断与编号建议', () => {
    const { report } = preciseReplaceWithReport(SOURCE, '王五', 'x');
    const text = formatPreciseReplaceReport(report);
    expect(text).toContain('策略: none');
    expect(text).toContain('windowRange=N/A');
    expect(text).toContain('建议:\n1. ');
  });

  it('有窗口范围、无建议时的格式化', () => {
    const { report } = preciseReplaceWithReport('甲乙丙', '乙', '丁');
    const text = formatPreciseReplaceReport({
      ...report,
      diagnostics: { ...report.diagnostics, searchedWindowRange: [3, 9] },
    });
    expect(text).toContain('windowRange=3-9');
    expect(text).not.toContain('建议');
  });
});
