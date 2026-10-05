/**
 * 战力一致性检查：发现「战力崩溃」苗头与违反核心规则的设定
 *
 * 检查项：
 *   - 等级超过上限 / 等级与累计经验不符
 *   - 属性超出取值范围、超过「每级成长上限」推算出的合理值
 *   - 技能超过最高等级、技能未在规则中定义、前置条件未满足、互斥技能同时掌握
 *   - 抉择超过可选数量、到达解锁等级后仍未做出抉择
 *   - 同一章内等级 / 属性 / 技能暴涨（PowerLimits）
 *   - 可机器校验的核心规则（CoreRule.check）
 */
import {
  checkSkillPrerequisites,
  findAttributeDef,
  findChoiceGroup,
  findSkillDef,
  levelFromExp,
} from './engine';
import {
  detectForgottenCompanions,
  latestKnownChapter,
  withObservedAppearances,
} from './party-map';
import type {
  CoreRule,
  ForgottenCompanion,
  GrowthRuleset,
  GrowthSheet,
  GrowthWarning,
  MemoryBundle,
} from './types';

function ruleApplies(rule: CoreRule, sheet: GrowthSheet): boolean {
  if (!rule.appliesTo || rule.appliesTo.length === 0) return true;
  return rule.appliesTo.some((name) => name === sheet.name || sheet.aliases.includes(name));
}

/** 抉择奖励给某属性带来的加成总和 */
function choiceAttributeBonus(ruleset: GrowthRuleset, sheet: GrowthSheet, key: string): number {
  let bonus = 0;
  for (const choice of sheet.choices) {
    const group = findChoiceGroup(ruleset, choice.groupId);
    const option = group?.options.find((item) => item.id === choice.optionId);
    bonus += option?.grants?.attributes?.[key] ?? 0;
  }
  return bonus;
}

function checkCoreRules(
  ruleset: GrowthRuleset,
  sheet: GrowthSheet,
  push: (warning: Omit<GrowthWarning, 'character'>) => void
): void {
  for (const rule of ruleset.coreRules) {
    const check = rule.check;
    if (!check || !ruleApplies(rule, sheet)) continue;
    const message = `违反核心规则「${rule.text}」`;
    switch (check.kind) {
      case 'max-level':
        if (sheet.level > check.value) {
          push({
            severity: 'error',
            code: 'CORE_RULE',
            message: `${message}: 当前 ${sheet.level} 级`,
          });
        }
        break;
      case 'max-attribute': {
        const def = findAttributeDef(ruleset, check.key);
        const value = sheet.attributes[def?.key ?? check.key];
        if (value !== undefined && value > check.value) {
          push({
            severity: 'error',
            code: 'CORE_RULE',
            message: `${message}: ${def?.name ?? check.key} = ${value}`,
          });
        }
        break;
      }
      case 'max-skill-level': {
        const level = sheet.skills.find((item) => item.id === check.skillId)?.level ?? 0;
        if (level > check.value) {
          push({ severity: 'error', code: 'CORE_RULE', message: `${message}: 当前 ${level} 级` });
        }
        break;
      }
      case 'forbid-skill':
        if (sheet.skills.some((item) => item.id === check.skillId && item.level > 0)) {
          push({ severity: 'error', code: 'CORE_RULE', message: `${message}: 已掌握该技能` });
        }
        break;
      case 'require-choice-by-level':
        if (
          sheet.level >= check.level &&
          !sheet.choices.some((choice) => choice.groupId === check.groupId)
        ) {
          push({
            severity: 'warning',
            code: 'CORE_RULE',
            message: `${message}: 已到 ${sheet.level} 级仍未做出抉择`,
          });
        }
        break;
    }
  }
}

/** 同一章内的暴涨检查 */
function checkChapterSpikes(
  ruleset: GrowthRuleset,
  sheet: GrowthSheet,
  push: (warning: Omit<GrowthWarning, 'character'>) => void
): void {
  const levels = new Map<number, number>();
  const attributes = new Map<string, number>();
  const skills = new Map<string, number>();
  for (const event of sheet.events) {
    if (event.chapter === undefined) continue;
    const chapter = event.chapter;
    if (event.levelBefore !== undefined && event.levelAfter !== undefined) {
      levels.set(chapter, (levels.get(chapter) ?? 0) + (event.levelAfter - event.levelBefore));
    }
    if (event.type === 'attribute' && event.target && (event.delta ?? 0) > 0) {
      const key = `${chapter}\u0000${event.target}`;
      attributes.set(key, (attributes.get(key) ?? 0) + (event.delta ?? 0));
    }
    if (event.type === 'skill' && event.target && (event.delta ?? 0) > 0) {
      const key = `${chapter}\u0000${event.target}`;
      skills.set(key, (skills.get(key) ?? 0) + (event.delta ?? 0));
    }
  }
  const limits = ruleset.limits;
  for (const [chapter, gained] of levels) {
    if (gained > limits.maxLevelsPerChapter) {
      push({
        severity: 'warning',
        code: 'LEVEL_SPIKE',
        chapter,
        message: `第 ${chapter} 章连升 ${gained} 级（上限 ${limits.maxLevelsPerChapter}）`,
        hint: '考虑把成长分散到多章，或在规则中调高 maxLevelsPerChapter',
      });
    }
  }
  for (const [key, gained] of attributes) {
    const [chapterText, attrKey] = key.split('\u0000');
    if (gained > limits.maxAttributeGainPerChapter) {
      const name = findAttributeDef(ruleset, attrKey)?.name ?? attrKey;
      push({
        severity: 'warning',
        code: 'ATTRIBUTE_SPIKE',
        chapter: Number(chapterText),
        message: `第 ${chapterText} 章${name}提升 ${gained}（上限 ${limits.maxAttributeGainPerChapter}）`,
      });
    }
  }
  for (const [key, gained] of skills) {
    const [chapterText, skillId] = key.split('\u0000');
    if (gained > limits.maxSkillLevelsPerChapter) {
      const name = findSkillDef(ruleset, skillId)?.name ?? skillId;
      push({
        severity: 'warning',
        code: 'SKILL_SPIKE',
        chapter: Number(chapterText),
        message: `第 ${chapterText} 章「${name}」提升 ${gained} 级（上限 ${limits.maxSkillLevelsPerChapter}）`,
      });
    }
  }
}

/** 检查单个角色卡 */
export function checkSheetConsistency(ruleset: GrowthRuleset, sheet: GrowthSheet): GrowthWarning[] {
  const warnings: GrowthWarning[] = [];
  const push = (warning: Omit<GrowthWarning, 'character'>) =>
    warnings.push({ ...warning, character: sheet.name });

  // 等级
  if (sheet.level > ruleset.levels.maxLevel) {
    push({
      severity: 'error',
      code: 'LEVEL_ABOVE_MAX',
      message: `等级 ${sheet.level} 超过规则上限 ${ruleset.levels.maxLevel}`,
    });
  }
  const derived = levelFromExp(ruleset, sheet.exp);
  if (derived !== sheet.level && sheet.level <= ruleset.levels.maxLevel) {
    push({
      severity: 'warning',
      code: 'LEVEL_EXP_MISMATCH',
      message: `等级 ${sheet.level} 与累计经验 ${sheet.exp}（对应 ${derived} 级）不一致`,
      hint: '可能是手动改过等级，确认是否为剧情安排（如传承、降级诅咒）',
    });
  }

  // 属性
  for (const attr of ruleset.attributes) {
    const value = sheet.attributes[attr.key];
    if (value === undefined) continue;
    if (value > attr.max || value < attr.min) {
      push({
        severity: 'error',
        code: 'ATTRIBUTE_OUT_OF_RANGE',
        message: `${attr.name} ${value} 超出取值范围 ${attr.min}~${attr.max}`,
      });
      continue;
    }
    const perLevel = Math.max(attr.perLevelCap, attr.growthPerLevel);
    const cap =
      attr.initial + perLevel * (sheet.level - 1) + choiceAttributeBonus(ruleset, sheet, attr.key);
    if (value > cap) {
      push({
        severity: 'warning',
        code: 'ATTRIBUTE_ABOVE_LEVEL_CAP',
        message: `${attr.name} ${value} 高于 ${sheet.level} 级的合理上限 ${cap}`,
        hint: `规则：初始 ${attr.initial} + 每级最多 ${perLevel} + 抉择奖励`,
      });
    }
  }
  for (const key of Object.keys(sheet.attributes)) {
    if (!ruleset.attributes.some((attr) => attr.key === key)) {
      push({
        severity: 'info',
        code: 'UNKNOWN_ATTRIBUTE',
        message: `属性「${key}」未在规则中定义`,
      });
    }
  }

  // 技能
  const exclusiveOwners = new Map<string, string[]>();
  for (const entry of sheet.skills) {
    const def = findSkillDef(ruleset, entry.id);
    if (!def) {
      push({
        severity: 'info',
        code: 'UNKNOWN_SKILL',
        message: `技能「${entry.id}」未在规则中定义`,
      });
      continue;
    }
    if (entry.level > def.maxLevel) {
      push({
        severity: 'error',
        code: 'SKILL_ABOVE_MAX',
        message: `「${def.name}」${entry.level} 级超过上限 ${def.maxLevel}`,
      });
    }
    // 互斥由下方统一检查，这里只看等级/属性/前置技能
    const problems = checkSkillPrerequisites(ruleset, sheet, { ...def, exclusiveGroup: undefined });
    if (entry.level > 0 && problems.length > 0) {
      push({
        severity: 'warning',
        code: 'SKILL_PREREQUISITE',
        message: `「${def.name}」前置条件未满足: ${problems.join('；')}`,
      });
    }
    if (def.exclusiveGroup && entry.level > 0) {
      const owners = exclusiveOwners.get(def.exclusiveGroup) ?? [];
      owners.push(def.name);
      exclusiveOwners.set(def.exclusiveGroup, owners);
    }
  }
  for (const [group, owners] of exclusiveOwners) {
    if (owners.length > 1) {
      push({
        severity: 'error',
        code: 'SKILL_EXCLUSIVE',
        message: `互斥技能同时掌握（${group}）: ${owners.join('、')}`,
      });
    }
  }

  // 抉择
  for (const group of ruleset.choiceGroups) {
    const made = sheet.choices.filter((choice) => choice.groupId === group.id);
    if (made.length > group.pick) {
      push({
        severity: 'error',
        code: 'CHOICE_LIMIT',
        message: `「${group.name}」只能选 ${group.pick} 项，实际选了 ${made.length} 项`,
      });
    }
    if (group.unlockLevel && sheet.level > group.unlockLevel && made.length === 0) {
      push({
        severity: 'info',
        code: 'CHOICE_PENDING',
        message: `已超过 ${group.unlockLevel} 级，「${group.name}」尚未抉择`,
      });
    }
  }
  for (const choice of sheet.choices) {
    if (!findChoiceGroup(ruleset, choice.groupId)) {
      push({
        severity: 'info',
        code: 'UNKNOWN_CHOICE',
        message: `选择组「${choice.groupId}」未在规则中定义`,
      });
    }
  }

  checkChapterSpikes(ruleset, sheet, push);
  checkCoreRules(ruleset, sheet, push);
  return warnings;
}

export interface MemoryCheckResult {
  currentChapter: number;
  warnings: GrowthWarning[];
  forgotten: ForgottenCompanion[];
  summary: { errors: number; warnings: number; infos: number; forgotten: number };
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

/** 检查整个记忆库 */
export function checkMemory(
  bundle: MemoryBundle,
  options: { currentChapter?: number; forgottenAfter?: number } = {}
): MemoryCheckResult {
  const warnings = bundle.sheets
    .flatMap((sheet) => checkSheetConsistency(bundle.ruleset, sheet))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const currentChapter =
    options.currentChapter ?? latestKnownChapter(bundle.party, bundle.sheets, bundle.atlas);
  const forgotten = detectForgottenCompanions(
    withObservedAppearances(bundle.party, bundle.sheets, bundle.atlas),
    currentChapter,
    options.forgottenAfter ?? bundle.ruleset.limits.forgottenAfterChapters
  );
  return {
    currentChapter,
    warnings,
    forgotten,
    summary: {
      errors: warnings.filter((w) => w.severity === 'error').length,
      warnings: warnings.filter((w) => w.severity === 'warning').length,
      infos: warnings.filter((w) => w.severity === 'info').length,
      forgotten: forgotten.length,
    },
  };
}
