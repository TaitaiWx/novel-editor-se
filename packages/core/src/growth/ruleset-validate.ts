/**
 * 规则之书的字段级校验（纯函数）
 *
 * normalizeRuleset 负责容错（丢弃 / 夹取不合法的字段），这里负责「告诉作者哪里不对」：
 * 每条问题带字段路径（例如 `attributes.2.max`、`skills.0.prerequisites.skills.fireball`），
 * GUI 把错误显示在对应输入框旁；主进程保存时同样调用，有 error 时拒绝写入。
 */
import type { CoreRuleCheck, GrowthRuleset } from './types';

export type RulesetIssueSeverity = 'error' | 'warning';

export interface RulesetIssue {
  path: string;
  severity: RulesetIssueSeverity;
  message: string;
}

/** key / id 不能含空白与路径字符（只做 ASCII 字符排除，不按汉字判断） */
const ID_FORBIDDEN = /[\s/\\:*?"<>|]/;

function isPositiveInt(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validateRuleset(ruleset: GrowthRuleset): RulesetIssue[] {
  const issues: RulesetIssue[] = [];
  const error = (path: string, message: string) =>
    issues.push({ path, severity: 'error', message });
  const warn = (path: string, message: string) =>
    issues.push({ path, severity: 'warning', message });

  if (!ruleset.name.trim()) error('name', '规则之书需要一个名称');

  // ─── 属性 ───
  const attributeKeys = new Set<string>();
  const attributeNames = new Set<string>();
  ruleset.attributes.forEach((attr, index) => {
    const base = `attributes.${index}`;
    const key = attr.key.trim();
    if (key && ID_FORBIDDEN.test(key))
      error(`${base}.key`, '键名不能包含空格或 / \\ : * ? " < > |');
    else if (key && attributeKeys.has(key)) error(`${base}.key`, `键名「${key}」重复`);
    if (key) attributeKeys.add(key);
    const name = attr.name.trim();
    if (!name) error(`${base}.name`, '请填写属性名称');
    else if (attributeNames.has(name)) error(`${base}.name`, `属性「${name}」重复`);
    if (name) attributeNames.add(name);
    if (!finite(attr.min) || !finite(attr.max) || !finite(attr.initial)) {
      error(`${base}.initial`, '数值不能为空');
      return;
    }
    if (attr.max < attr.min) error(`${base}.max`, '最大值不能小于最小值');
    else if (attr.initial < attr.min || attr.initial > attr.max) {
      error(`${base}.initial`, `初始值应在 ${attr.min}–${attr.max} 之间`);
    }
    if (!finite(attr.perLevelCap) || attr.perLevelCap < 0) {
      error(`${base}.perLevelCap`, '每级上限不能小于 0');
    } else if (finite(attr.growthPerLevel) && attr.growthPerLevel > attr.perLevelCap) {
      warn(`${base}.growthPerLevel`, '每级成长超过了每级上限，升级后一致性检查会提示');
    }
  });

  // ─── 等级曲线 ───
  if (!isPositiveInt(ruleset.levels.maxLevel)) error('levels.maxLevel', '最高等级至少为 1');
  const curve = ruleset.levels.curve;
  if (curve.kind === 'table') {
    if (curve.perLevel.length === 0) error('levels.curve', '经验表至少需要一级');
    curve.perLevel.forEach((need, index) => {
      if (!finite(need) || need <= 0) {
        error(`levels.curve.perLevel.${index}`, '升级所需经验必须大于 0');
      }
    });
  } else {
    if (!finite(curve.base) || curve.base <= 0) error('levels.curve.base', '基础经验必须大于 0');
    if (!finite(curve.factor) || curve.factor <= 0) {
      error('levels.curve.factor', '增长倍率必须大于 0');
    }
  }

  // ─── 技能 ───
  const skillIds = new Set(ruleset.skills.map((skill) => skill.id));
  const skillNames = new Set<string>();
  ruleset.skills.forEach((skill, index) => {
    const base = `skills.${index}`;
    const name = skill.name.trim();
    if (!name) error(`${base}.name`, '请填写技能名称');
    else if (skillNames.has(name)) error(`${base}.name`, `技能「${name}」重复`);
    if (name) skillNames.add(name);
    if (!isPositiveInt(skill.maxLevel)) error(`${base}.maxLevel`, '最高等级至少为 1');
    if (skill.costPerLevel.length === 0) error(`${base}.costPerLevel`, '至少需要一级的升级经验');
    skill.costPerLevel.forEach((cost, costIndex) => {
      if (!finite(cost) || cost < 0) {
        error(`${base}.costPerLevel.${costIndex}`, '升级经验不能小于 0');
      }
    });
    const pre = skill.prerequisites;
    if (pre?.characterLevel !== undefined && !isPositiveInt(pre.characterLevel)) {
      error(`${base}.prerequisites.characterLevel`, '角色等级至少为 1');
    }
    for (const [id, level] of Object.entries(pre?.skills ?? {})) {
      const path = `${base}.prerequisites.skills.${id}`;
      const target = ruleset.skills.find((item) => item.id === id);
      if (id === skill.id) error(path, '不能把自己设为前置技能');
      else if (!target) error(path, '前置技能不存在');
      else if (!isPositiveInt(level)) error(path, '前置技能等级至少为 1');
      else if (level > target.maxLevel) {
        warn(path, `「${target.name || target.id}」最高只有 ${target.maxLevel} 级`);
      }
    }
    for (const [key, value] of Object.entries(pre?.attributes ?? {})) {
      const path = `${base}.prerequisites.attributes.${key}`;
      if (!ruleset.attributes.some((attr) => attr.key === key)) error(path, '属性不存在');
      else if (!finite(value)) error(path, '请填写属性下限');
    }
  });

  // ─── 能力抉择 ───
  const groupIds = new Set(ruleset.choiceGroups.map((group) => group.id));
  ruleset.choiceGroups.forEach((group, index) => {
    const base = `choiceGroups.${index}`;
    if (!group.name.trim()) error(`${base}.name`, '请填写抉择名称');
    if (group.options.length < 2) warn(`${base}.options`, '抉择通常至少有两个选项');
    if (!isPositiveInt(group.pick)) error(`${base}.pick`, '至少选择 1 项');
    else if (group.pick > Math.max(1, group.options.length)) {
      error(`${base}.pick`, `只有 ${group.options.length} 个选项，不能选 ${group.pick} 项`);
    }
    if (group.unlockLevel !== undefined && !isPositiveInt(group.unlockLevel)) {
      error(`${base}.unlockLevel`, '建议等级至少为 1');
    }
    const optionNames = new Set<string>();
    group.options.forEach((option, optionIndex) => {
      const optionBase = `${base}.options.${optionIndex}`;
      const name = option.name.trim();
      if (!name) error(`${optionBase}.name`, '请填写选项名称');
      else if (optionNames.has(name)) error(`${optionBase}.name`, `选项「${name}」重复`);
      if (name) optionNames.add(name);
      for (const key of Object.keys(option.grants?.attributes ?? {})) {
        if (!ruleset.attributes.some((attr) => attr.key === key)) {
          error(`${optionBase}.grants.attributes.${key}`, '奖励的属性不存在');
        }
      }
      for (const id of option.grants?.skills ?? []) {
        if (!skillIds.has(id)) error(`${optionBase}.grants.skills.${id}`, '奖励的技能不存在');
      }
    });
  });

  // ─── 核心规则 ───
  ruleset.coreRules.forEach((rule, index) => {
    const base = `coreRules.${index}`;
    if (!rule.text.trim()) error(`${base}.text`, '请填写规则内容');
    if (rule.check) {
      const problem = checkProblem(rule.check, attributeKeys, skillIds, groupIds);
      if (problem) error(`${base}.check`, problem);
    }
  });

  // ─── 战力限制 ───
  for (const [key, value] of Object.entries(ruleset.limits)) {
    if (!isPositiveInt(value)) error(`limits.${key}`, '必须是正整数');
  }

  return issues;
}

function checkProblem(
  check: CoreRuleCheck,
  attributeKeys: Set<string>,
  skillIds: Set<string>,
  groupIds: Set<string>
): string | null {
  switch (check.kind) {
    case 'max-level':
      return isPositiveInt(check.value) ? null : '等级上限至少为 1';
    case 'max-attribute':
      if (!attributeKeys.has(check.key)) return '请选择要限制的属性';
      return finite(check.value) ? null : '请填写属性上限';
    case 'max-skill-level':
      if (!skillIds.has(check.skillId)) return '请选择要限制的技能';
      return check.value >= 0 && Number.isInteger(check.value) ? null : '技能等级上限不能小于 0';
    case 'forbid-skill':
      return skillIds.has(check.skillId) ? null : '请选择禁用的技能';
    case 'require-choice-by-level':
      if (!groupIds.has(check.groupId)) return '请选择抉择';
      return isPositiveInt(check.level) ? null : '等级至少为 1';
    default:
      return null;
  }
}

/** 只保留 error */
export function rulesetErrors(issues: readonly RulesetIssue[]): RulesetIssue[] {
  return issues.filter((issue) => issue.severity === 'error');
}
