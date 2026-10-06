/**
 * 角色成长记录器 / 设定记忆库：数据结构定义
 *
 * 所有数据以 JSON 文件的形式保存在作品的 `<作品>/资料/记忆/` 中（记忆库跟随作品，见 work-scope.ts），
 * 作为成长数据的唯一来源，
 * GUI、CLI 与 AI agent 都直接读写这些文件。每个文件都带 schemaVersion，便于未来迁移。
 *
 *   资料/记忆/
 *   ├── 规则.json            GrowthRuleset：属性、等级经验曲线、技能、二选一/三选一、核心规则、战力限制
 *   ├── 队伍.json            PartyBook：组队历史 + 配角出场记录
 *   ├── 地图.json            Atlas：地点与到访记录
 *   ├── 角色/<角色名>.json   GrowthSheet：等级、经验、属性、技能、选择、事件日志
 *   ├── 角色/<角色名>.md     由 JSON 派生的可读摘要（自动生成，勿手改）
 *   ├── 角色卡/*.md          GUI 数据库人物卡快照（只读，自动生成）
 *   ├── 设定/*.md            GUI 数据库设定快照（只读，自动生成）
 *   └── README.md            记忆库总览（自动生成）
 */

export const GROWTH_SCHEMA_VERSION = 1;

/** 记忆库相对作品作用域根目录（作品目录 / 普通文件夹）的路径片段 */
export const MEMORY_DIR_SEGMENTS = ['资料', '记忆'] as const;
export const MEMORY_RULESET_FILE = '规则.json';
export const MEMORY_PARTY_FILE = '队伍.json';
export const MEMORY_ATLAS_FILE = '地图.json';
export const MEMORY_README_FILE = 'README.md';
export const MEMORY_SHEETS_DIR = '角色';
export const MEMORY_CHARACTER_CARDS_DIR = '角色卡';
export const MEMORY_SETTINGS_DIR = '设定';

// ─── 规则集 ─────────────────────────────────────────────────────────────────

export interface AttributeDef {
  /** 稳定键名，例如 str */
  key: string;
  /** 显示名，例如 力量 */
  name: string;
  description?: string;
  /** 新建角色卡时的初始值 */
  initial: number;
  min: number;
  max: number;
  /** 每次升级自动增加的数值 */
  growthPerLevel: number;
  /** 每升一级允许的最大成长（战力校验：属性 ≤ 初始值 + 上限 × (等级 - 1) + 选择奖励） */
  perLevelCap: number;
}

/**
 * 经验曲线：perLevel[i] 表示从 i+1 级升到 i+2 级需要的经验；表不够长时重复最后一项。
 * formula：从 L 级升到 L+1 级需要 round(base × factor^(L-1)) 经验。
 */
export type ExpCurve =
  | { kind: 'table'; perLevel: number[] }
  | { kind: 'formula'; base: number; factor: number };

export interface LevelRules {
  maxLevel: number;
  curve: ExpCurve;
}

export interface SkillPrerequisites {
  /** 角色等级下限 */
  characterLevel?: number;
  /** 前置技能及其最低等级 */
  skills?: Record<string, number>;
  /** 属性下限 */
  attributes?: Record<string, number>;
}

export interface SkillDef {
  id: string;
  name: string;
  description?: string;
  maxLevel: number;
  /** costPerLevel[i] = 从 i 级升到 i+1 级需要的技能经验（0 → 1 为学会）；不够长时重复最后一项 */
  costPerLevel: number[];
  prerequisites?: SkillPrerequisites;
  /** 互斥组：同组技能只能拥有一个（例如三系法术只能主修其一） */
  exclusiveGroup?: string;
}

export interface ChoiceOptionGrants {
  /** 选择后学会的技能（1 级） */
  skills?: string[];
  /** 选择后获得的属性加成 */
  attributes?: Record<string, number>;
}

export interface ChoiceOption {
  id: string;
  name: string;
  description?: string;
  grants?: ChoiceOptionGrants;
}

/** 二选一 / 三选一 等能力抉择 */
export interface ChoiceGroup {
  id: string;
  name: string;
  description?: string;
  /** 可选数量，默认 1 */
  pick: number;
  /** 建议在该等级前完成选择（可选） */
  unlockLevel?: number;
  options: ChoiceOption[];
}

/** 可被程序自动校验的核心规则 */
export type CoreRuleCheck =
  | { kind: 'max-level'; value: number }
  | { kind: 'max-attribute'; key: string; value: number }
  | { kind: 'max-skill-level'; skillId: string; value: number }
  | { kind: 'forbid-skill'; skillId: string }
  | { kind: 'require-choice-by-level'; groupId: string; level: number };

/** 作者设定的核心规则：文字描述交给 AI 推演，可选的 check 由一致性检查自动校验 */
export interface CoreRule {
  id: string;
  text: string;
  /** 只对这些角色生效（为空表示所有角色） */
  appliesTo?: string[];
  check?: CoreRuleCheck;
}

/** 战力一致性限制 */
export interface PowerLimits {
  /** 同一章内最多提升的等级数 */
  maxLevelsPerChapter: number;
  /** 同一章内单项属性最多提升多少 */
  maxAttributeGainPerChapter: number;
  /** 同一章内单个技能最多提升多少级 */
  maxSkillLevelsPerChapter: number;
  /** 配角多少章未出场视为「被遗忘」 */
  forgottenAfterChapters: number;
}

export interface GrowthRuleset {
  schemaVersion: number;
  name: string;
  description?: string;
  attributes: AttributeDef[];
  levels: LevelRules;
  skills: SkillDef[];
  choiceGroups: ChoiceGroup[];
  coreRules: CoreRule[];
  limits: PowerLimits;
}

// ─── 角色成长卡 ─────────────────────────────────────────────────────────────

export interface SheetSkill {
  id: string;
  level: number;
  /** 当前等级内累积的技能经验 */
  exp: number;
}

export interface SheetChoice {
  groupId: string;
  optionId: string;
  chapter?: number;
  note?: string;
  at: string;
}

export type GrowthEventType =
  | 'exp'
  | 'level'
  | 'attribute'
  | 'skill'
  | 'skill-exp'
  | 'choice'
  | 'note';

export const GROWTH_EVENT_TYPES: readonly GrowthEventType[] = [
  'exp',
  'level',
  'attribute',
  'skill',
  'skill-exp',
  'choice',
  'note',
];

export type GrowthEventSource = 'manual' | 'cli' | 'gui' | 'ai-sim';

/** 应用事件时的输入 */
export interface GrowthEventInput {
  type: GrowthEventType;
  /** 属性键 / 技能 id / 选择组 id */
  target?: string;
  /** 选择项 id（choice） */
  value?: string;
  delta?: number;
  chapter?: number;
  note?: string;
  source?: GrowthEventSource;
}

export interface GrowthEvent extends GrowthEventInput {
  id: string;
  at: string;
  levelBefore?: number;
  levelAfter?: number;
}

export interface GrowthSheet {
  schemaVersion: number;
  name: string;
  aliases: string[];
  level: number;
  /** 累计总经验 */
  exp: number;
  attributes: Record<string, number>;
  skills: SheetSkill[];
  choices: SheetChoice[];
  events: GrowthEvent[];
  /** 状态备注（伤势、装备、心境等） */
  notes: string[];
  createdAt: string;
  updatedAt: string;
}

// ─── 队伍 / 配角 ────────────────────────────────────────────────────────────

export interface PartyRecord {
  id: string;
  name: string;
  members: string[];
  fromChapter?: number;
  /** 解散章节；为空表示仍在队中 */
  toChapter?: number;
  notes?: string;
}

export interface CompanionRecord {
  name: string;
  lastSeenChapter?: number;
  /** 读者喜爱 / 作者重点关注的配角，提醒优先级更高 */
  important?: boolean;
  note?: string;
}

export interface PartyBook {
  schemaVersion: number;
  parties: PartyRecord[];
  companions: CompanionRecord[];
}

// ─── 地图 ───────────────────────────────────────────────────────────────────

export interface LocationVisit {
  character: string;
  chapter?: number;
  note?: string;
}

export interface LocationRecord {
  id: string;
  name: string;
  region?: string;
  /** 上级地点名称 */
  parent?: string;
  description?: string;
  firstChapter?: number;
  visits: LocationVisit[];
}

export interface Atlas {
  schemaVersion: number;
  locations: LocationRecord[];
}

// ─── 校验 / 提醒 ────────────────────────────────────────────────────────────

export type GrowthWarningSeverity = 'error' | 'warning' | 'info';

export interface GrowthWarning {
  severity: GrowthWarningSeverity;
  code: string;
  message: string;
  character?: string;
  chapter?: number;
  hint?: string;
}

export interface ForgottenCompanion {
  name: string;
  lastSeenChapter: number;
  chaptersAbsent: number;
  important: boolean;
  /** 曾经同队的队伍名 */
  parties: string[];
}

/** 记忆库整体快照 */
export interface MemoryBundle {
  ruleset: GrowthRuleset;
  sheets: GrowthSheet[];
  party: PartyBook;
  atlas: Atlas;
}
