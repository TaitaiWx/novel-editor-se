/**
 * 规则之书的可视化编辑辅助（纯函数，GUI 与 CLI 共用）
 *
 * - 新条目的 id 一律按「前缀-序号」生成（attr-1 / skill-2 / choice-1 / option-3 / rule-4），
 *   不从名称（可能是汉字）推导任何 id 或逻辑
 * - 经验曲线预览、抉择奖励 ↔ 表格行的映射
 * - 删除前的引用检查（成长卡 + 规则内部引用）与删除后的引用清理
 */
import { expForNextLevel, skillCostForLevel } from './engine';
import type {
  AttributeDef,
  ChoiceGroup,
  ChoiceOption,
  ChoiceOptionGrants,
  CoreRule,
  CoreRuleCheck,
  GrowthRuleset,
  GrowthSheet,
  LevelRules,
  SkillDef,
} from './types';

// ─── id 生成 ────────────────────────────────────────────────────────────────

/** 生成 `<prefix>-<n>`：n 从 1 起，跳过已占用的 id */
export function nextSequentialId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let index = 1;
  while (used.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

export function createAttributeDraft(ruleset: GrowthRuleset): AttributeDef {
  return {
    key: nextSequentialId(
      'attr',
      ruleset.attributes.map((item) => item.key)
    ),
    name: '',
    initial: 0,
    min: 0,
    max: 100,
    growthPerLevel: 0,
    perLevelCap: 1,
  };
}

export function createSkillDraft(ruleset: GrowthRuleset): SkillDef {
  return {
    id: nextSequentialId(
      'skill',
      ruleset.skills.map((item) => item.id)
    ),
    name: '',
    maxLevel: 1,
    costPerLevel: [0],
  };
}

export function createChoiceOptionDraft(group: Pick<ChoiceGroup, 'options'>): ChoiceOption {
  return {
    id: nextSequentialId(
      'option',
      group.options.map((item) => item.id)
    ),
    name: '',
  };
}

/** 新抉择默认二选一：带两个空选项 */
export function createChoiceGroupDraft(ruleset: GrowthRuleset): ChoiceGroup {
  const first = createChoiceOptionDraft({ options: [] });
  const second = createChoiceOptionDraft({ options: [first] });
  return {
    id: nextSequentialId(
      'choice',
      ruleset.choiceGroups.map((item) => item.id)
    ),
    name: '',
    pick: 1,
    options: [first, second],
  };
}

export function createCoreRuleDraft(ruleset: GrowthRuleset, text = ''): CoreRule {
  return {
    id: nextSequentialId(
      'rule',
      ruleset.coreRules.map((item) => item.id)
    ),
    text,
  };
}

/** 规则里是否还没有任何内容（属性 / 技能 / 抉择 / 核心规则都为空） */
export function isRulesetEmpty(ruleset: GrowthRuleset): boolean {
  return (
    ruleset.attributes.length === 0 &&
    ruleset.skills.length === 0 &&
    ruleset.choiceGroups.length === 0 &&
    ruleset.coreRules.length === 0
  );
}

/** 列表内移动一项（越界时原样返回） */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

// ─── 经验曲线预览 ───────────────────────────────────────────────────────────

export interface LevelCurveRow {
  /** 从 level 级升到 level+1 级 */
  level: number;
  need: number;
  /** 到达 level+1 级的累计经验 */
  total: number;
}

/** 前 count 次升级的经验需求（不超过最高等级） */
export function levelCurvePreview(levels: LevelRules, count = 10): LevelCurveRow[] {
  const probe = { levels } as GrowthRuleset;
  const rows: LevelCurveRow[] = [];
  let total = 0;
  const last = Math.min(levels.maxLevel - 1, count);
  for (let level = 1; level <= last; level += 1) {
    const need = expForNextLevel(probe, level);
    total += need;
    rows.push({ level, need, total });
  }
  return rows;
}

/** 技能升级经验按最高等级展开：costs[i] 是 i 级升到 i+1 级（0 → 1 为学会），不够长时重复最后一项 */
export function expandSkillCosts(skill: Pick<SkillDef, 'maxLevel' | 'costPerLevel'>): number[] {
  return Array.from({ length: Math.max(1, Math.floor(skill.maxLevel) || 1) }, (_, index) =>
    skillCostForLevel(skill as SkillDef, index)
  );
}

// ─── 抉择奖励 ↔ 表格行 ──────────────────────────────────────────────────────

export interface AttributeRewardRow {
  /** 属性 key；'' 表示还没选 */
  key: string;
  amount: number;
}

export interface RewardRows {
  attributes: AttributeRewardRow[];
  skills: string[];
}

export function grantsToRewardRows(grants: ChoiceOptionGrants | undefined): RewardRows {
  return {
    attributes: Object.entries(grants?.attributes ?? {}).map(([key, amount]) => ({ key, amount })),
    skills: [...(grants?.skills ?? [])],
  };
}

/** 表格行 → grants：未选属性或加成为 0 的行丢弃，同一属性多行合并求和，技能去重 */
export function rewardRowsToGrants(rows: RewardRows): ChoiceOptionGrants | undefined {
  const attributes: Record<string, number> = {};
  for (const row of rows.attributes) {
    if (!row.key || !Number.isFinite(row.amount) || row.amount === 0) continue;
    attributes[row.key] = (attributes[row.key] ?? 0) + row.amount;
  }
  for (const key of Object.keys(attributes)) if (attributes[key] === 0) delete attributes[key];
  const skills = [...new Set(rows.skills.filter(Boolean))];
  const hasAttributes = Object.keys(attributes).length > 0;
  if (!hasAttributes && skills.length === 0) return undefined;
  return {
    ...(skills.length > 0 ? { skills } : {}),
    ...(hasAttributes ? { attributes } : {}),
  };
}

// ─── 引用检查与清理 ─────────────────────────────────────────────────────────

export type RulesetRef =
  | { kind: 'attribute'; key: string }
  | { kind: 'skill'; id: string }
  | { kind: 'choice-group'; id: string }
  | { kind: 'choice-option'; groupId: string; optionId: string };

export interface RulesetUsage {
  /** 成长卡里用到它的角色 */
  characters: string[];
  /** 规则内部引用它的地方（可读描述） */
  references: string[];
}

/** 核心规则的自动校验是否引用了 ref */
function checkReferences(check: CoreRuleCheck, ref: RulesetRef): boolean {
  switch (ref.kind) {
    case 'attribute':
      return check.kind === 'max-attribute' && check.key === ref.key;
    case 'skill':
      return (
        (check.kind === 'max-skill-level' || check.kind === 'forbid-skill') &&
        check.skillId === ref.id
      );
    case 'choice-group':
      return check.kind === 'require-choice-by-level' && check.groupId === ref.id;
    default:
      return false;
  }
}

export function findRulesetUsage(
  ruleset: GrowthRuleset,
  sheets: readonly GrowthSheet[],
  ref: RulesetRef
): RulesetUsage {
  const characters: string[] = [];
  const references: string[] = [];
  for (const sheet of sheets) {
    const used =
      ref.kind === 'attribute'
        ? Object.prototype.hasOwnProperty.call(sheet.attributes, ref.key)
        : ref.kind === 'skill'
          ? sheet.skills.some((item) => item.id === ref.id)
          : ref.kind === 'choice-group'
            ? sheet.choices.some((item) => item.groupId === ref.id)
            : sheet.choices.some(
                (item) => item.groupId === ref.groupId && item.optionId === ref.optionId
              );
    if (used) characters.push(sheet.name);
  }
  if (ref.kind === 'attribute' || ref.kind === 'skill') {
    for (const skill of ruleset.skills) {
      const pre = skill.prerequisites;
      const hit =
        ref.kind === 'attribute'
          ? pre?.attributes?.[ref.key] !== undefined
          : skill.id !== ref.id && pre?.skills?.[ref.id] !== undefined;
      if (hit) references.push(`技能「${skill.name || skill.id}」的前置条件`);
    }
    for (const group of ruleset.choiceGroups) {
      for (const option of group.options) {
        const hit =
          ref.kind === 'attribute'
            ? option.grants?.attributes?.[ref.key] !== undefined
            : option.grants?.skills?.includes(ref.id);
        if (hit) {
          references.push(
            `抉择「${group.name || group.id}」选项「${option.name || option.id}」的奖励`
          );
        }
      }
    }
  }
  for (const rule of ruleset.coreRules) {
    if (rule.check && checkReferences(rule.check, ref))
      references.push(`核心规则「${rule.text}」的自动校验`);
  }
  return { characters, references };
}

function withoutKey(record: Record<string, number> | undefined, key: string) {
  if (!record || record[key] === undefined) return record;
  const next = { ...record };
  delete next[key];
  return Object.keys(next).length > 0 ? next : undefined;
}

function cleanGrants(grants: ChoiceOptionGrants | undefined, ref: RulesetRef) {
  if (!grants) return undefined;
  const attributes =
    ref.kind === 'attribute' ? withoutKey(grants.attributes, ref.key) : grants.attributes;
  const skills =
    ref.kind === 'skill' ? grants.skills?.filter((id) => id !== ref.id) : grants.skills;
  return rewardRowsToGrants({
    attributes: Object.entries(attributes ?? {}).map(([key, amount]) => ({ key, amount })),
    skills: skills ?? [],
  });
}

function setOptional<T extends object, K extends keyof T>(
  item: T,
  key: K,
  value: T[K] | undefined
) {
  const next = { ...item };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

/** 删除一项并清理规则内部对它的引用（前置条件、抉择奖励、核心规则的自动校验） */
export function removeFromRuleset(ruleset: GrowthRuleset, ref: RulesetRef): GrowthRuleset {
  const attributes =
    ref.kind === 'attribute'
      ? ruleset.attributes.filter((item) => item.key !== ref.key)
      : ruleset.attributes;
  const skills = (
    ref.kind === 'skill' ? ruleset.skills.filter((item) => item.id !== ref.id) : ruleset.skills
  ).map((skill) => {
    if (!skill.prerequisites || (ref.kind !== 'attribute' && ref.kind !== 'skill')) return skill;
    const pre =
      ref.kind === 'attribute'
        ? setOptional(
            skill.prerequisites,
            'attributes',
            withoutKey(skill.prerequisites.attributes, ref.key)
          )
        : setOptional(
            skill.prerequisites,
            'skills',
            withoutKey(skill.prerequisites.skills, ref.id)
          );
    return setOptional(skill, 'prerequisites', Object.keys(pre).length > 0 ? pre : undefined);
  });
  const choiceGroups = ruleset.choiceGroups
    .filter((group) => !(ref.kind === 'choice-group' && group.id === ref.id))
    .map((group) => {
      const options = group.options
        .filter(
          (option) =>
            !(
              ref.kind === 'choice-option' &&
              ref.groupId === group.id &&
              option.id === ref.optionId
            )
        )
        .map((option) => setOptional(option, 'grants', cleanGrants(option.grants, ref)));
      return { ...group, options, pick: Math.max(1, Math.min(group.pick, options.length || 1)) };
    });
  const coreRules = ruleset.coreRules.map((rule) =>
    rule.check && checkReferences(rule.check, ref) ? setOptional(rule, 'check', undefined) : rule
  );
  return { ...ruleset, attributes, skills, choiceGroups, coreRules };
}

/** 保存前整理：去掉名称首尾空白，空 key / id 按序号补齐 */
export function finalizeRuleset(ruleset: GrowthRuleset): GrowthRuleset {
  const attributeKeys = ruleset.attributes.map((item) => item.key.trim()).filter(Boolean);
  const attributes = ruleset.attributes.map((item) => {
    const key = item.key.trim();
    if (key) return { ...item, key, name: item.name.trim() };
    const generated = nextSequentialId('attr', attributeKeys);
    attributeKeys.push(generated);
    return { ...item, key: generated, name: item.name.trim() };
  });
  return {
    ...ruleset,
    name: ruleset.name.trim(),
    attributes,
    skills: ruleset.skills.map((item) => ({ ...item, name: item.name.trim() })),
    choiceGroups: ruleset.choiceGroups.map((group) => ({
      ...group,
      name: group.name.trim(),
      options: group.options.map((option) => ({ ...option, name: option.name.trim() })),
    })),
    coreRules: ruleset.coreRules.map((rule) => ({ ...rule, text: rule.text.trim() })),
  };
}
