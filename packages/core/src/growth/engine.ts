/**
 * 成长计算引擎（纯函数，不读写磁盘）
 *
 * - 经验曲线：等级 ↔ 累计经验换算、距下一级所需经验
 * - 事件应用：经验获取自动升级（并按规则成长属性）、属性变化、技能学习/升级、技能经验、能力抉择
 * - 严格模式（默认）下违反规则会抛出 INVALID_ARGUMENT；非严格模式只记录 warnings（用于 AI 推演预览与 --force）
 */
import { CoreError } from '../errors';
import type {
  ChoiceGroup,
  ChoiceOption,
  GrowthEvent,
  GrowthEventInput,
  GrowthRuleset,
  GrowthSheet,
  GrowthWarning,
  SheetSkill,
  SkillDef,
} from './types';
import { GROWTH_SCHEMA_VERSION } from './types';

// ─── 经验曲线 ───────────────────────────────────────────────────────────────

/** 从 level 级升到 level+1 级需要的经验 */
export function expForNextLevel(ruleset: GrowthRuleset, level: number): number {
  const curve = ruleset.levels.curve;
  if (curve.kind === 'table') {
    const index = Math.max(0, level - 1);
    return curve.perLevel[Math.min(index, curve.perLevel.length - 1)] ?? 0;
  }
  return Math.round(curve.base * Math.pow(curve.factor, Math.max(0, level - 1)));
}

/** 到达 level 级需要的累计经验（1 级为 0） */
export function totalExpForLevel(ruleset: GrowthRuleset, level: number): number {
  const target = Math.min(Math.max(1, Math.floor(level)), ruleset.levels.maxLevel);
  let total = 0;
  for (let current = 1; current < target; current += 1) total += expForNextLevel(ruleset, current);
  return total;
}

/** 累计经验对应的等级（受 maxLevel 限制） */
export function levelFromExp(ruleset: GrowthRuleset, exp: number): number {
  let level = 1;
  let total = 0;
  while (level < ruleset.levels.maxLevel) {
    const need = expForNextLevel(ruleset, level);
    if (need <= 0 || total + need > exp) break;
    total += need;
    level += 1;
  }
  return level;
}

export interface LevelProgress {
  level: number;
  maxLevel: number;
  isMaxLevel: boolean;
  /** 当前等级起点的累计经验 */
  levelStartExp: number;
  /** 下一级所需的累计经验（满级时为 null） */
  nextLevelExp: number | null;
  /** 当前等级内已获得的经验 */
  expIntoLevel: number;
  /** 当前等级升级所需经验 */
  expForLevel: number;
  /** 距下一级还差多少经验 */
  expToNext: number;
  /** 0..1 */
  ratio: number;
}

/** 等级进度（以角色卡上的等级为准，与经验不一致时仍给出合理值） */
export function getLevelProgress(ruleset: GrowthRuleset, sheet: GrowthSheet): LevelProgress {
  const maxLevel = ruleset.levels.maxLevel;
  const level = Math.min(sheet.level, maxLevel);
  const levelStartExp = totalExpForLevel(ruleset, level);
  if (level >= maxLevel) {
    return {
      level,
      maxLevel,
      isMaxLevel: true,
      levelStartExp,
      nextLevelExp: null,
      expIntoLevel: Math.max(0, sheet.exp - levelStartExp),
      expForLevel: 0,
      expToNext: 0,
      ratio: 1,
    };
  }
  const expForLevel = expForNextLevel(ruleset, level);
  const expIntoLevel = Math.max(0, sheet.exp - levelStartExp);
  return {
    level,
    maxLevel,
    isMaxLevel: false,
    levelStartExp,
    nextLevelExp: levelStartExp + expForLevel,
    expIntoLevel,
    expForLevel,
    expToNext: Math.max(0, expForLevel - expIntoLevel),
    ratio: expForLevel > 0 ? Math.min(1, expIntoLevel / expForLevel) : 1,
  };
}

// ─── 查找 ───────────────────────────────────────────────────────────────────

export function findSkillDef(ruleset: GrowthRuleset, ref: string): SkillDef | undefined {
  const key = ref.trim().toLowerCase();
  return (
    ruleset.skills.find((skill) => skill.id.toLowerCase() === key) ??
    ruleset.skills.find((skill) => skill.name.toLowerCase() === key)
  );
}

export function findChoiceGroup(ruleset: GrowthRuleset, ref: string): ChoiceGroup | undefined {
  const key = ref.trim().toLowerCase();
  return (
    ruleset.choiceGroups.find((group) => group.id.toLowerCase() === key) ??
    ruleset.choiceGroups.find((group) => group.name.toLowerCase() === key)
  );
}

export function findChoiceOption(group: ChoiceGroup, ref: string): ChoiceOption | undefined {
  const key = ref.trim().toLowerCase();
  return (
    group.options.find((option) => option.id.toLowerCase() === key) ??
    group.options.find((option) => option.name.toLowerCase() === key)
  );
}

/** 在所有抉择组中查找某个选项 */
export function findOptionAnywhere(
  ruleset: GrowthRuleset,
  ref: string
): { group: ChoiceGroup; option: ChoiceOption } | undefined {
  for (const group of ruleset.choiceGroups) {
    const option = findChoiceOption(group, ref);
    if (option) return { group, option };
  }
  return undefined;
}

export function findAttributeDef(ruleset: GrowthRuleset, ref: string) {
  const key = ref.trim().toLowerCase();
  return (
    ruleset.attributes.find((attr) => attr.key.toLowerCase() === key) ??
    ruleset.attributes.find((attr) => attr.name.toLowerCase() === key)
  );
}

/** 按名字或别名匹配角色卡 */
export function findSheet(sheets: GrowthSheet[], ref: string): GrowthSheet | undefined {
  const key = ref.trim();
  return (
    sheets.find((sheet) => sheet.name === key) ??
    sheets.find((sheet) => sheet.aliases.includes(key))
  );
}

// ─── 技能 ───────────────────────────────────────────────────────────────────

/** 技能从 level 级升到 level+1 级需要的技能经验 */
export function skillCostForLevel(skill: SkillDef, level: number): number {
  const index = Math.max(0, Math.floor(level));
  return skill.costPerLevel[Math.min(index, skill.costPerLevel.length - 1)] ?? 0;
}

export interface SkillProgress {
  id: string;
  name: string;
  level: number;
  maxLevel: number;
  exp: number;
  /** 下一级需要的技能经验（满级为 null） */
  nextCost: number | null;
  expToNext: number | null;
  known: boolean;
}

export function getSkillProgress(ruleset: GrowthRuleset, entry: SheetSkill): SkillProgress {
  const def = findSkillDef(ruleset, entry.id);
  if (!def) {
    return {
      id: entry.id,
      name: entry.id,
      level: entry.level,
      maxLevel: entry.level,
      exp: entry.exp,
      nextCost: null,
      expToNext: null,
      known: false,
    };
  }
  const maxed = entry.level >= def.maxLevel;
  const nextCost = maxed ? null : skillCostForLevel(def, entry.level);
  return {
    id: def.id,
    name: def.name,
    level: entry.level,
    maxLevel: def.maxLevel,
    exp: entry.exp,
    nextCost,
    expToNext: nextCost === null ? null : Math.max(0, nextCost - entry.exp),
    known: true,
  };
}

/** 检查学习/升级技能的前置条件，返回不满足的原因 */
export function checkSkillPrerequisites(
  ruleset: GrowthRuleset,
  sheet: GrowthSheet,
  skill: SkillDef
): string[] {
  const problems: string[] = [];
  const pre = skill.prerequisites;
  if (pre?.characterLevel && sheet.level < pre.characterLevel) {
    problems.push(`需要角色等级 ${pre.characterLevel}（当前 ${sheet.level}）`);
  }
  for (const [skillId, level] of Object.entries(pre?.skills ?? {})) {
    const owned = sheet.skills.find((item) => item.id === skillId)?.level ?? 0;
    if (owned < level) {
      const name = findSkillDef(ruleset, skillId)?.name ?? skillId;
      problems.push(`需要前置技能「${name}」${level} 级（当前 ${owned}）`);
    }
  }
  for (const [key, min] of Object.entries(pre?.attributes ?? {})) {
    const value = sheet.attributes[key] ?? 0;
    if (value < min) {
      const name = findAttributeDef(ruleset, key)?.name ?? key;
      problems.push(`需要${name} ≥ ${min}（当前 ${value}）`);
    }
  }
  if (skill.exclusiveGroup) {
    const conflict = sheet.skills.find((item) => {
      if (item.id === skill.id || item.level <= 0) return false;
      return findSkillDef(ruleset, item.id)?.exclusiveGroup === skill.exclusiveGroup;
    });
    if (conflict) {
      const name = findSkillDef(ruleset, conflict.id)?.name ?? conflict.id;
      problems.push(`与已掌握的「${name}」互斥（互斥组 ${skill.exclusiveGroup}）`);
    }
  }
  return problems;
}

// ─── 角色卡 ─────────────────────────────────────────────────────────────────

export function createSheet(
  ruleset: GrowthRuleset,
  name: string,
  options: { aliases?: string[]; now?: string } = {}
): GrowthSheet {
  const trimmed = name.trim();
  if (!trimmed) throw new CoreError('INVALID_ARGUMENT', '角色名不能为空');
  const now = options.now ?? new Date().toISOString();
  return {
    schemaVersion: GROWTH_SCHEMA_VERSION,
    name: trimmed,
    aliases: (options.aliases ?? []).map((item) => item.trim()).filter((a) => a && a !== trimmed),
    level: 1,
    exp: 0,
    attributes: Object.fromEntries(ruleset.attributes.map((attr) => [attr.key, attr.initial])),
    skills: [],
    choices: [],
    events: [],
    notes: [],
    createdAt: now,
    updatedAt: now,
  };
}

export interface ApplyEventOptions {
  /** 严格模式：违反规则时抛错（默认 true） */
  strict?: boolean;
  now?: string;
}

export interface ApplyEventResult {
  sheet: GrowthSheet;
  event: GrowthEvent;
  /** 本次事件导致的升级次数 */
  levelUps: number;
  warnings: GrowthWarning[];
}

function cloneSheet(sheet: GrowthSheet): GrowthSheet {
  return JSON.parse(JSON.stringify(sheet)) as GrowthSheet;
}

/** 升级时按规则成长属性 */
function applyLevelGrowth(ruleset: GrowthRuleset, sheet: GrowthSheet, levels: number): void {
  if (levels <= 0) return;
  for (const attr of ruleset.attributes) {
    if (!attr.growthPerLevel) continue;
    const current = sheet.attributes[attr.key] ?? attr.initial;
    sheet.attributes[attr.key] = Math.min(attr.max, current + attr.growthPerLevel * levels);
  }
}

function nextEventId(sheet: GrowthSheet): string {
  let max = 0;
  for (const event of sheet.events) {
    const match = /^evt-(\d+)$/.exec(event.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `evt-${max + 1}`;
}

/**
 * 应用一条成长事件，返回新的角色卡（不修改入参）
 */
export function applyGrowthEvent(
  ruleset: GrowthRuleset,
  input: GrowthSheet,
  eventInput: GrowthEventInput,
  options: ApplyEventOptions = {}
): ApplyEventResult {
  const strict = options.strict !== false;
  const now = options.now ?? new Date().toISOString();
  const sheet = cloneSheet(input);
  const warnings: GrowthWarning[] = [];
  const violate = (code: string, message: string, hint?: string) => {
    if (strict) {
      throw new CoreError('INVALID_ARGUMENT', hint ? `${message}（${hint}）` : message);
    }
    warnings.push({ severity: 'error', code, message, character: sheet.name, hint });
  };
  const levelBefore = sheet.level;
  const delta = eventInput.delta;
  if (delta !== undefined && !Number.isFinite(delta)) {
    throw new CoreError('INVALID_ARGUMENT', '事件的 delta 必须是有限数字');
  }

  const event: GrowthEvent = {
    id: nextEventId(sheet),
    at: now,
    type: eventInput.type,
    ...(eventInput.target ? { target: eventInput.target } : {}),
    ...(eventInput.value ? { value: eventInput.value } : {}),
    ...(delta !== undefined ? { delta } : {}),
    ...(eventInput.chapter !== undefined ? { chapter: eventInput.chapter } : {}),
    ...(eventInput.note ? { note: eventInput.note } : {}),
    ...(eventInput.source ? { source: eventInput.source } : {}),
  };

  switch (eventInput.type) {
    case 'exp': {
      if (delta === undefined) throw new CoreError('INVALID_ARGUMENT', '经验事件需要 delta');
      sheet.exp = Math.max(0, sheet.exp + delta);
      const derived = levelFromExp(ruleset, sheet.exp);
      // 经验只会让等级上升；扣经验不自动降级（降级需显式 level 事件）
      if (derived > sheet.level) {
        applyLevelGrowth(ruleset, sheet, derived - sheet.level);
        sheet.level = derived;
      }
      break;
    }
    case 'level': {
      const step = Math.trunc(delta ?? 1);
      const target = sheet.level + step;
      if (target < 1) throw new CoreError('INVALID_ARGUMENT', '等级不能低于 1');
      if (target > ruleset.levels.maxLevel) {
        violate('LEVEL_ABOVE_MAX', `等级 ${target} 超过规则上限 ${ruleset.levels.maxLevel}`);
      }
      applyLevelGrowth(ruleset, sheet, step);
      sheet.level = target;
      sheet.exp = Math.max(sheet.exp, totalExpForLevel(ruleset, target));
      break;
    }
    case 'attribute': {
      const ref = eventInput.target;
      if (!ref || delta === undefined) {
        throw new CoreError('INVALID_ARGUMENT', '属性事件需要 target（属性键）与 delta');
      }
      const def = findAttributeDef(ruleset, ref);
      const key = def?.key ?? ref;
      if (!def) violate('UNKNOWN_ATTRIBUTE', `规则中没有属性「${ref}」`, '先在 规则.json 中定义');
      const next = (sheet.attributes[key] ?? def?.initial ?? 0) + delta;
      if (def && next > def.max)
        violate('ATTRIBUTE_ABOVE_MAX', `${def.name} ${next} 超过上限 ${def.max}`);
      if (def && next < def.min)
        violate('ATTRIBUTE_BELOW_MIN', `${def.name} ${next} 低于下限 ${def.min}`);
      sheet.attributes[key] = next;
      event.target = key;
      break;
    }
    case 'skill': {
      const ref = eventInput.target;
      if (!ref) throw new CoreError('INVALID_ARGUMENT', '技能事件需要 target（技能 id）');
      const def = findSkillDef(ruleset, ref);
      const steps = Math.trunc(delta ?? 1);
      if (!def) violate('UNKNOWN_SKILL', `规则中没有技能「${ref}」`, '先在 规则.json 中定义');
      const id = def?.id ?? ref;
      const entry = sheet.skills.find((item) => item.id === id);
      const current = entry?.level ?? 0;
      const target = current + steps;
      if (target < 0) throw new CoreError('INVALID_ARGUMENT', '技能等级不能低于 0');
      if (def && steps > 0) {
        const problems = checkSkillPrerequisites(ruleset, sheet, def);
        if (problems.length > 0) {
          violate('SKILL_PREREQUISITE', `无法提升「${def.name}」: ${problems.join('；')}`);
        }
        if (target > def.maxLevel) {
          violate('SKILL_ABOVE_MAX', `「${def.name}」${target} 级超过上限 ${def.maxLevel}`);
        }
      }
      if (entry) {
        entry.level = target;
        entry.exp = 0;
      } else if (target > 0) {
        sheet.skills.push({ id, level: target, exp: 0 });
      }
      sheet.skills = sheet.skills.filter((item) => item.level > 0);
      event.target = id;
      event.delta = steps;
      break;
    }
    case 'skill-exp': {
      const ref = eventInput.target;
      if (!ref || delta === undefined) {
        throw new CoreError('INVALID_ARGUMENT', '技能经验事件需要 target 与 delta');
      }
      const def = findSkillDef(ruleset, ref);
      if (!def) {
        violate('UNKNOWN_SKILL', `规则中没有技能「${ref}」`);
        break;
      }
      let entry = sheet.skills.find((item) => item.id === def.id);
      if (!entry) {
        const problems = checkSkillPrerequisites(ruleset, sheet, def);
        if (problems.length > 0) {
          violate('SKILL_PREREQUISITE', `尚未掌握「${def.name}」: ${problems.join('；')}`);
        }
        entry = { id: def.id, level: 0, exp: 0 };
        sheet.skills.push(entry);
      }
      entry.exp = Math.max(0, entry.exp + delta);
      // 技能经验满足消耗时自动升级
      while (entry.level < def.maxLevel) {
        const cost = skillCostForLevel(def, entry.level);
        if (entry.exp < cost) break;
        entry.exp -= cost;
        entry.level += 1;
      }
      if (entry.level >= def.maxLevel) entry.exp = 0;
      sheet.skills = sheet.skills.filter((item) => item.level > 0 || item.exp > 0);
      event.target = def.id;
      break;
    }
    case 'choice': {
      const groupRef = eventInput.target;
      const optionRef = eventInput.value;
      if (!groupRef || !optionRef) {
        throw new CoreError('INVALID_ARGUMENT', '抉择事件需要 target（选择组）与 value（选项）');
      }
      const group = findChoiceGroup(ruleset, groupRef);
      if (!group) throw new CoreError('NOT_FOUND', `规则中没有选择组「${groupRef}」`);
      const option = findChoiceOption(group, optionRef);
      if (!option) {
        throw new CoreError('NOT_FOUND', `选择组「${group.name}」没有选项「${optionRef}」`);
      }
      const made = sheet.choices.filter((choice) => choice.groupId === group.id);
      if (made.some((choice) => choice.optionId === option.id)) {
        throw new CoreError('ALREADY_EXISTS', `已经选择过「${option.name}」`);
      }
      if (made.length >= group.pick) {
        violate(
          'CHOICE_LIMIT',
          `「${group.name}」只能选择 ${group.pick} 项，已选: ${made.map((c) => c.optionId).join(', ')}`
        );
      }
      sheet.choices.push({
        groupId: group.id,
        optionId: option.id,
        ...(eventInput.chapter !== undefined ? { chapter: eventInput.chapter } : {}),
        ...(eventInput.note ? { note: eventInput.note } : {}),
        at: now,
      });
      for (const [key, gain] of Object.entries(option.grants?.attributes ?? {})) {
        const def = findAttributeDef(ruleset, key);
        sheet.attributes[def?.key ?? key] =
          (sheet.attributes[def?.key ?? key] ?? def?.initial ?? 0) + gain;
      }
      for (const skillId of option.grants?.skills ?? []) {
        if (!sheet.skills.some((item) => item.id === skillId && item.level > 0)) {
          sheet.skills = sheet.skills.filter((item) => item.id !== skillId);
          sheet.skills.push({ id: skillId, level: 1, exp: 0 });
        }
      }
      event.target = group.id;
      event.value = option.id;
      break;
    }
    case 'note':
      if (!eventInput.note) throw new CoreError('INVALID_ARGUMENT', '备注事件需要 note');
      break;
    default:
      throw new CoreError('INVALID_ARGUMENT', `未知事件类型: ${String(eventInput.type)}`);
  }

  if (sheet.level !== levelBefore) {
    event.levelBefore = levelBefore;
    event.levelAfter = sheet.level;
  }
  sheet.events.push(event);
  sheet.updatedAt = now;
  return { sheet, event, levelUps: Math.max(0, sheet.level - levelBefore), warnings };
}

/** 依次应用多条事件 */
export function applyGrowthEvents(
  ruleset: GrowthRuleset,
  sheet: GrowthSheet,
  events: GrowthEventInput[],
  options: ApplyEventOptions = {}
): { sheet: GrowthSheet; events: GrowthEvent[]; warnings: GrowthWarning[] } {
  let current = sheet;
  const applied: GrowthEvent[] = [];
  const warnings: GrowthWarning[] = [];
  for (const input of events) {
    const result = applyGrowthEvent(ruleset, current, input, options);
    current = result.sheet;
    applied.push(result.event);
    warnings.push(...result.warnings);
  }
  return { sheet: current, events: applied, warnings };
}

/** 角色卡里出现过的最大章节号 */
export function latestChapterOfSheet(sheet: GrowthSheet): number {
  let latest = 0;
  for (const event of sheet.events) latest = Math.max(latest, event.chapter ?? 0);
  for (const choice of sheet.choices) latest = Math.max(latest, choice.chapter ?? 0);
  return latest;
}
