/**
 * 记忆库 JSON 的容错解析、校验与版本迁移
 *
 * 文件可能被作者或 AI 手工编辑，因此解析时：
 *   - 缺失字段用默认值补齐，类型不对的字段丢弃并记录 issue
 *   - schemaVersion 缺失视为旧版本（0），自动迁移到当前版本
 *   - schemaVersion 高于当前版本时抛出 UNSUPPORTED，避免旧程序覆盖新数据
 */
import { CoreError } from '../errors';
import { DEFAULT_POWER_LIMITS, createBlankRuleset } from './templates';
import {
  GROWTH_EVENT_TYPES,
  GROWTH_SCHEMA_VERSION,
  type Atlas,
  type AttributeDef,
  type ChoiceGroup,
  type ChoiceOption,
  type CompanionRecord,
  type CoreRule,
  type CoreRuleCheck,
  type ExpCurve,
  type GrowthEvent,
  type GrowthEventSource,
  type GrowthEventType,
  type GrowthRuleset,
  type GrowthSheet,
  type LocationRecord,
  type PartyBook,
  type PartyRecord,
  type SheetChoice,
  type SheetSkill,
  type SkillDef,
  type SkillPrerequisites,
} from './types';

export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

export function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

export function asStringArray(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(/[,\uff0c\u3001]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter((item): item is string => Boolean(item));
}

function asNumberRecord(value: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (!isRecord(value)) return result;
  for (const [key, raw] of Object.entries(value)) {
    const num = asNumber(raw);
    if (num !== undefined) result[key] = num;
  }
  return result;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function positiveInt(value: unknown, fallback: number): number {
  const num = asNumber(value);
  return num !== undefined && num >= 1 ? Math.floor(num) : fallback;
}

function optionalChapter(value: unknown): number | undefined {
  const num = asNumber(value);
  return num !== undefined && num >= 0 ? Math.floor(num) : undefined;
}

/** 检查 schemaVersion，返回原始版本号 */
function checkVersion(raw: UnknownRecord, label: string): number {
  const version = asNumber(raw.schemaVersion) ?? 0;
  if (version > GROWTH_SCHEMA_VERSION) {
    throw new CoreError(
      'UNSUPPORTED',
      `${label} 的 schemaVersion=${version} 高于当前支持的版本 ${GROWTH_SCHEMA_VERSION}，请升级 Novel Editor`
    );
  }
  return version;
}

/** 生成稳定 id（不依赖随机数，便于测试与 diff） */
export function slugifyId(text: string, fallback: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[\s/\\:*?"<>|]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

// ─── 规则集 ─────────────────────────────────────────────────────────────────

function normalizeAttribute(raw: unknown, index: number): AttributeDef | null {
  if (!isRecord(raw)) return null;
  const key = asString(raw.key) ?? asString(raw.id);
  const name = asString(raw.name) ?? key;
  if (!key || !name) return null;
  const min = asNumber(raw.min) ?? 0;
  const max = Math.max(min, asNumber(raw.max) ?? 100);
  const initial = Math.min(max, Math.max(min, asNumber(raw.initial) ?? min));
  return {
    key: key || `attr-${index + 1}`,
    name,
    ...(asString(raw.description) ? { description: asString(raw.description) } : {}),
    initial,
    min,
    max,
    growthPerLevel: asNumber(raw.growthPerLevel) ?? 0,
    perLevelCap: Math.max(0, asNumber(raw.perLevelCap) ?? 1),
  };
}

function normalizeCurve(raw: unknown): ExpCurve {
  if (isRecord(raw)) {
    if (raw.kind === 'table' || Array.isArray(raw.perLevel)) {
      const perLevel = asArray(raw.perLevel)
        .map(asNumber)
        .filter((item): item is number => item !== undefined && item > 0);
      if (perLevel.length > 0) return { kind: 'table', perLevel };
    }
    const base = asNumber(raw.base);
    if (base !== undefined && base > 0) {
      const factor = asNumber(raw.factor);
      return { kind: 'formula', base, factor: factor !== undefined && factor > 0 ? factor : 1 };
    }
  }
  return { kind: 'formula', base: 100, factor: 1.5 };
}

function normalizePrerequisites(raw: unknown): SkillPrerequisites | undefined {
  if (!isRecord(raw)) return undefined;
  const result: SkillPrerequisites = {};
  const level = asNumber(raw.characterLevel);
  if (level !== undefined && level > 1) result.characterLevel = Math.floor(level);
  const skills = asNumberRecord(raw.skills);
  if (Object.keys(skills).length > 0) result.skills = skills;
  const attributes = asNumberRecord(raw.attributes);
  if (Object.keys(attributes).length > 0) result.attributes = attributes;
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeSkill(raw: unknown, index: number): SkillDef | null {
  if (!isRecord(raw)) return null;
  const name = asString(raw.name) ?? asString(raw.id);
  if (!name) return null;
  const id = asString(raw.id) ?? slugifyId(name, `skill-${index + 1}`);
  const maxLevel = positiveInt(raw.maxLevel, 1);
  const costPerLevel = asArray(raw.costPerLevel)
    .map(asNumber)
    .filter((item): item is number => item !== undefined && item >= 0);
  const prerequisites = normalizePrerequisites(raw.prerequisites);
  const exclusiveGroup = asString(raw.exclusiveGroup);
  return {
    id,
    name,
    ...(asString(raw.description) ? { description: asString(raw.description) } : {}),
    maxLevel,
    costPerLevel: costPerLevel.length > 0 ? costPerLevel : [0],
    ...(prerequisites ? { prerequisites } : {}),
    ...(exclusiveGroup ? { exclusiveGroup } : {}),
  };
}

function normalizeOption(raw: unknown, index: number): ChoiceOption | null {
  if (typeof raw === 'string' && raw.trim()) {
    return { id: slugifyId(raw, `option-${index + 1}`), name: raw.trim() };
  }
  if (!isRecord(raw)) return null;
  const name = asString(raw.name) ?? asString(raw.id);
  if (!name) return null;
  const grantsRaw = isRecord(raw.grants) ? raw.grants : undefined;
  const skills = asStringArray(grantsRaw?.skills);
  const attributes = asNumberRecord(grantsRaw?.attributes);
  const grants =
    skills.length > 0 || Object.keys(attributes).length > 0
      ? {
          ...(skills.length > 0 ? { skills } : {}),
          ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
        }
      : undefined;
  return {
    id: asString(raw.id) ?? slugifyId(name, `option-${index + 1}`),
    name,
    ...(asString(raw.description) ? { description: asString(raw.description) } : {}),
    ...(grants ? { grants } : {}),
  };
}

function normalizeChoiceGroup(raw: unknown, index: number): ChoiceGroup | null {
  if (!isRecord(raw)) return null;
  const name = asString(raw.name) ?? asString(raw.id);
  if (!name) return null;
  const options = asArray(raw.options)
    .map(normalizeOption)
    .filter((item): item is ChoiceOption => item !== null);
  const unlockLevel = asNumber(raw.unlockLevel);
  return {
    id: asString(raw.id) ?? slugifyId(name, `choice-${index + 1}`),
    name,
    ...(asString(raw.description) ? { description: asString(raw.description) } : {}),
    pick: Math.max(1, Math.min(positiveInt(raw.pick, 1), Math.max(1, options.length))),
    ...(unlockLevel !== undefined && unlockLevel >= 1
      ? { unlockLevel: Math.floor(unlockLevel) }
      : {}),
    options,
  };
}

export function normalizeCoreRuleCheck(raw: unknown): CoreRuleCheck | undefined {
  if (!isRecord(raw)) return undefined;
  const value = asNumber(raw.value);
  switch (raw.kind) {
    case 'max-level':
      return value !== undefined ? { kind: 'max-level', value } : undefined;
    case 'max-attribute': {
      const key = asString(raw.key);
      return key && value !== undefined ? { kind: 'max-attribute', key, value } : undefined;
    }
    case 'max-skill-level': {
      const skillId = asString(raw.skillId);
      return skillId && value !== undefined
        ? { kind: 'max-skill-level', skillId, value }
        : undefined;
    }
    case 'forbid-skill': {
      const skillId = asString(raw.skillId);
      return skillId ? { kind: 'forbid-skill', skillId } : undefined;
    }
    case 'require-choice-by-level': {
      const groupId = asString(raw.groupId);
      const level = asNumber(raw.level);
      return groupId && level !== undefined
        ? { kind: 'require-choice-by-level', groupId, level }
        : undefined;
    }
    default:
      return undefined;
  }
}

function normalizeCoreRule(raw: unknown, index: number): CoreRule | null {
  if (typeof raw === 'string' && raw.trim()) return { id: `rule-${index + 1}`, text: raw.trim() };
  if (!isRecord(raw)) return null;
  const text = asString(raw.text);
  if (!text) return null;
  const appliesTo = asStringArray(raw.appliesTo);
  const check = normalizeCoreRuleCheck(raw.check);
  return {
    id: asString(raw.id) ?? `rule-${index + 1}`,
    text,
    ...(appliesTo.length > 0 ? { appliesTo } : {}),
    ...(check ? { check } : {}),
  };
}

/** 去重：同 id 只保留第一个 */
function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = key(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function normalizeRuleset(raw: unknown): GrowthRuleset {
  if (raw === undefined || raw === null) return createBlankRuleset();
  if (!isRecord(raw)) throw new CoreError('INVALID_ARGUMENT', '规则.json 必须是一个 JSON 对象');
  checkVersion(raw, '规则.json');
  const blank = createBlankRuleset();
  const levelsRaw = isRecord(raw.levels) ? raw.levels : {};
  const limitsRaw = isRecord(raw.limits) ? raw.limits : {};
  // v0 兼容：曾把 maxLevel / curve 放在顶层
  const maxLevel = positiveInt(levelsRaw.maxLevel ?? raw.maxLevel, blank.levels.maxLevel);
  const curve = normalizeCurve(levelsRaw.curve ?? raw.curve ?? raw.expCurve);
  return {
    schemaVersion: GROWTH_SCHEMA_VERSION,
    name: asString(raw.name) ?? blank.name,
    ...(asString(raw.description) ? { description: asString(raw.description) } : {}),
    attributes: uniqueBy(
      asArray(raw.attributes)
        .map(normalizeAttribute)
        .filter((item): item is AttributeDef => item !== null),
      (item) => item.key
    ),
    levels: { maxLevel, curve },
    skills: uniqueBy(
      asArray(raw.skills)
        .map(normalizeSkill)
        .filter((item): item is SkillDef => item !== null),
      (item) => item.id
    ),
    choiceGroups: uniqueBy(
      asArray(raw.choiceGroups)
        .map(normalizeChoiceGroup)
        .filter((item): item is ChoiceGroup => item !== null),
      (item) => item.id
    ),
    coreRules: uniqueBy(
      asArray(raw.coreRules)
        .map(normalizeCoreRule)
        .filter((item): item is CoreRule => item !== null),
      (item) => item.id
    ),
    limits: {
      maxLevelsPerChapter: positiveInt(
        limitsRaw.maxLevelsPerChapter,
        DEFAULT_POWER_LIMITS.maxLevelsPerChapter
      ),
      maxAttributeGainPerChapter: positiveInt(
        limitsRaw.maxAttributeGainPerChapter,
        DEFAULT_POWER_LIMITS.maxAttributeGainPerChapter
      ),
      maxSkillLevelsPerChapter: positiveInt(
        limitsRaw.maxSkillLevelsPerChapter,
        DEFAULT_POWER_LIMITS.maxSkillLevelsPerChapter
      ),
      forgottenAfterChapters: positiveInt(
        limitsRaw.forgottenAfterChapters,
        DEFAULT_POWER_LIMITS.forgottenAfterChapters
      ),
    },
  };
}

// ─── 角色卡 ─────────────────────────────────────────────────────────────────

function normalizeEventType(value: unknown): GrowthEventType | undefined {
  return GROWTH_EVENT_TYPES.find((type) => type === value);
}

function normalizeSource(value: unknown): GrowthEventSource | undefined {
  return value === 'manual' || value === 'cli' || value === 'gui' || value === 'ai-sim'
    ? value
    : undefined;
}

function normalizeEvent(raw: unknown, index: number): GrowthEvent | null {
  if (!isRecord(raw)) return null;
  const type = normalizeEventType(raw.type);
  if (!type) return null;
  const event: GrowthEvent = {
    id: asString(raw.id) ?? `evt-${index + 1}`,
    type,
    at: asString(raw.at) ?? new Date(0).toISOString(),
  };
  const target = asString(raw.target);
  const value = asString(raw.value);
  const delta = asNumber(raw.delta);
  const chapter = optionalChapter(raw.chapter);
  const note = asString(raw.note);
  const source = normalizeSource(raw.source);
  const levelBefore = asNumber(raw.levelBefore);
  const levelAfter = asNumber(raw.levelAfter);
  if (target) event.target = target;
  if (value) event.value = value;
  if (delta !== undefined) event.delta = delta;
  if (chapter !== undefined) event.chapter = chapter;
  if (note) event.note = note;
  if (source) event.source = source;
  if (levelBefore !== undefined) event.levelBefore = levelBefore;
  if (levelAfter !== undefined) event.levelAfter = levelAfter;
  return event;
}

export function normalizeSheet(raw: unknown, fallbackName?: string): GrowthSheet {
  if (!isRecord(raw)) {
    throw new CoreError(
      'INVALID_ARGUMENT',
      `角色成长卡格式错误${fallbackName ? `: ${fallbackName}` : ''}`
    );
  }
  checkVersion(raw, `角色/${fallbackName ?? '?'}.json`);
  const name = asString(raw.name) ?? fallbackName;
  if (!name) throw new CoreError('INVALID_ARGUMENT', '角色成长卡缺少 name');
  const now = new Date(0).toISOString();
  const skills = uniqueBy(
    asArray(raw.skills)
      .map((item): SheetSkill | null => {
        if (!isRecord(item)) return null;
        const id = asString(item.id);
        if (!id) return null;
        return {
          id,
          level: Math.max(0, Math.floor(asNumber(item.level) ?? 1)),
          exp: Math.max(0, asNumber(item.exp) ?? 0),
        };
      })
      .filter((item): item is SheetSkill => item !== null),
    (item) => item.id
  );
  const choices = asArray(raw.choices)
    .map((item): SheetChoice | null => {
      if (!isRecord(item)) return null;
      const groupId = asString(item.groupId);
      const optionId = asString(item.optionId);
      if (!groupId || !optionId) return null;
      const chapter = optionalChapter(item.chapter);
      const note = asString(item.note);
      return {
        groupId,
        optionId,
        ...(chapter !== undefined ? { chapter } : {}),
        ...(note ? { note } : {}),
        at: asString(item.at) ?? now,
      };
    })
    .filter((item): item is SheetChoice => item !== null);
  return {
    schemaVersion: GROWTH_SCHEMA_VERSION,
    name,
    aliases: asStringArray(raw.aliases).filter((alias) => alias !== name),
    level: Math.max(1, Math.floor(asNumber(raw.level) ?? 1)),
    exp: Math.max(0, asNumber(raw.exp) ?? 0),
    attributes: asNumberRecord(raw.attributes),
    skills,
    choices,
    events: asArray(raw.events)
      .map(normalizeEvent)
      .filter((item): item is GrowthEvent => item !== null),
    notes: asStringArray(raw.notes),
    createdAt: asString(raw.createdAt) ?? now,
    updatedAt: asString(raw.updatedAt) ?? now,
  };
}

// ─── 队伍 / 地图 ────────────────────────────────────────────────────────────

export function normalizePartyBook(raw: unknown): PartyBook {
  if (raw === undefined || raw === null) {
    return { schemaVersion: GROWTH_SCHEMA_VERSION, parties: [], companions: [] };
  }
  if (!isRecord(raw)) throw new CoreError('INVALID_ARGUMENT', '队伍.json 必须是一个 JSON 对象');
  checkVersion(raw, '队伍.json');
  const parties = asArray(raw.parties)
    .map((item, index): PartyRecord | null => {
      if (!isRecord(item)) return null;
      const name = asString(item.name);
      if (!name) return null;
      const fromChapter = optionalChapter(item.fromChapter);
      const toChapter = optionalChapter(item.toChapter);
      const notes = asString(item.notes);
      return {
        id: asString(item.id) ?? slugifyId(name, `party-${index + 1}`),
        name,
        members: asStringArray(item.members),
        ...(fromChapter !== undefined ? { fromChapter } : {}),
        ...(toChapter !== undefined ? { toChapter } : {}),
        ...(notes ? { notes } : {}),
      };
    })
    .filter((item): item is PartyRecord => item !== null);
  const companions = asArray(raw.companions)
    .map((item): CompanionRecord | null => {
      if (!isRecord(item)) return null;
      const name = asString(item.name);
      if (!name) return null;
      const lastSeenChapter = optionalChapter(item.lastSeenChapter);
      const note = asString(item.note);
      return {
        name,
        ...(lastSeenChapter !== undefined ? { lastSeenChapter } : {}),
        ...(item.important === true ? { important: true } : {}),
        ...(note ? { note } : {}),
      };
    })
    .filter((item): item is CompanionRecord => item !== null);
  return {
    schemaVersion: GROWTH_SCHEMA_VERSION,
    parties: uniqueBy(parties, (item) => item.id),
    companions: uniqueBy(companions, (item) => item.name),
  };
}

export function normalizeAtlas(raw: unknown): Atlas {
  if (raw === undefined || raw === null)
    return { schemaVersion: GROWTH_SCHEMA_VERSION, locations: [] };
  if (!isRecord(raw)) throw new CoreError('INVALID_ARGUMENT', '地图.json 必须是一个 JSON 对象');
  checkVersion(raw, '地图.json');
  const locations = asArray(raw.locations)
    .map((item, index): LocationRecord | null => {
      if (!isRecord(item)) return null;
      const name = asString(item.name);
      if (!name) return null;
      const firstChapter = optionalChapter(item.firstChapter);
      const visits = asArray(item.visits)
        .map((visit) => {
          if (!isRecord(visit)) return null;
          const character = asString(visit.character);
          if (!character) return null;
          const chapter = optionalChapter(visit.chapter);
          const note = asString(visit.note);
          return {
            character,
            ...(chapter !== undefined ? { chapter } : {}),
            ...(note ? { note } : {}),
          };
        })
        .filter((visit): visit is LocationRecord['visits'][number] => visit !== null);
      const region = asString(item.region);
      const parent = asString(item.parent);
      const description = asString(item.description);
      return {
        id: asString(item.id) ?? slugifyId(name, `loc-${index + 1}`),
        name,
        ...(region ? { region } : {}),
        ...(parent ? { parent } : {}),
        ...(description ? { description } : {}),
        ...(firstChapter !== undefined ? { firstChapter } : {}),
        visits,
      };
    })
    .filter((item): item is LocationRecord => item !== null);
  return {
    schemaVersion: GROWTH_SCHEMA_VERSION,
    locations: uniqueBy(locations, (item) => item.id),
  };
}
