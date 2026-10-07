/**
 * 成长档案 → AI 写作上下文的摘要（GUI 续写与 CLI `ne ai continue` 共用，保证两边带给模型的内容一致）
 */
import type { GrowthRuleset, GrowthSheet } from './types';

export interface GrowthContextSummary {
  name: string;
  level: number;
  /** 属性、技能、状态备注的一行摘要 */
  summary: string;
}

/** 成长卡摘要：属性、技能与最近 2 条状态备注；都没有时为「暂无记录」 */
export function summarizeSheetForContext(
  sheet: GrowthSheet,
  ruleset: GrowthRuleset
): GrowthContextSummary {
  const attrName = new Map(ruleset.attributes.map((item) => [item.key, item.name]));
  const skillName = new Map(ruleset.skills.map((item) => [item.id, item.name]));
  const attributes = Object.entries(sheet.attributes)
    .map(([key, value]) => `${attrName.get(key) ?? key} ${value}`)
    .join('，');
  const skills = sheet.skills
    .map((skill) => `${skillName.get(skill.id) ?? skill.id} Lv${skill.level}`)
    .join('、');
  const notes = sheet.notes.slice(-2).join('；');
  const parts = [
    attributes && `属性：${attributes}`,
    skills && `技能：${skills}`,
    notes && `状态：${notes}`,
  ].filter(Boolean);
  return { name: sheet.name, level: sheet.level, summary: parts.join('；') || '暂无记录' };
}

/** 对某个角色生效的核心规则文本（appliesTo 为空表示所有角色） */
export function coreRuleTexts(ruleset: GrowthRuleset, names?: readonly string[]): string[] {
  const wanted = names ? new Set(names) : null;
  return ruleset.coreRules
    .filter(
      (rule) =>
        !wanted || !rule.appliesTo?.length || rule.appliesTo.some((name) => wanted.has(name))
    )
    .map((rule) => rule.text.trim())
    .filter(Boolean);
}
