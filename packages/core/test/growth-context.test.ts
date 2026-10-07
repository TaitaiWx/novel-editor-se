import { describe, expect, it } from 'vitest';
import {
  coreRuleTexts,
  createDndRuleset,
  createSheet,
  summarizeSheetForContext,
} from '../src/growth';

describe('summarizeSheetForContext', () => {
  it('属性用名称、技能带等级、只取最近 2 条状态备注', () => {
    const ruleset = createDndRuleset();
    const sheet = createSheet(ruleset, '林舟', { now: '2026-01-01T00:00:00.000Z' });
    sheet.level = 4;
    sheet.notes = ['旧伤', '左臂受伤', '得到星图'];
    const firstAttr = ruleset.attributes[0];
    const summary = summarizeSheetForContext(sheet, ruleset);
    expect(summary.name).toBe('林舟');
    expect(summary.level).toBe(4);
    expect(summary.summary).toContain(`${firstAttr.name} ${firstAttr.initial}`);
    expect(summary.summary).toContain('状态：左臂受伤；得到星图');
    expect(summary.summary).not.toContain('旧伤');
  });

  it('什么都没有时为「暂无记录」', () => {
    const ruleset = { ...createDndRuleset(), attributes: [] };
    const sheet = createSheet(ruleset, '路人');
    expect(summarizeSheetForContext(sheet, ruleset).summary).toBe('暂无记录');
  });
});

describe('coreRuleTexts', () => {
  it('按角色过滤 appliesTo，去掉空规则', () => {
    const ruleset = {
      ...createDndRuleset(),
      coreRules: [
        { id: 'a', text: '全员规则' },
        { id: 'b', text: '只对林舟', appliesTo: ['林舟'] },
        { id: 'c', text: '  ' },
      ],
    };
    expect(coreRuleTexts(ruleset)).toEqual(['全员规则', '只对林舟']);
    expect(coreRuleTexts(ruleset, ['苏晴'])).toEqual(['全员规则']);
    expect(coreRuleTexts(ruleset, ['林舟'])).toEqual(['全员规则', '只对林舟']);
  });
});
