/**
 * 规则集模板：`ne growth init --template` 与 GUI 初始化记忆库时使用
 */
import { GROWTH_SCHEMA_VERSION, type GrowthRuleset, type PowerLimits } from './types';

export type GrowthTemplate = 'dnd' | 'blank';
export const GROWTH_TEMPLATES: readonly GrowthTemplate[] = ['dnd', 'blank'];

export const DEFAULT_POWER_LIMITS: PowerLimits = {
  maxLevelsPerChapter: 2,
  maxAttributeGainPerChapter: 3,
  maxSkillLevelsPerChapter: 2,
  forgottenAfterChapters: 30,
};

/** 空白模板：只有一条等级曲线，属性与技能由作者自行添加 */
export function createBlankRuleset(): GrowthRuleset {
  return {
    schemaVersion: GROWTH_SCHEMA_VERSION,
    name: '自定义规则',
    description: '在这里写下你的成长体系：属性、等级、技能与不可违背的核心规则。',
    attributes: [],
    levels: { maxLevel: 20, curve: { kind: 'formula', base: 100, factor: 1.5 } },
    skills: [],
    choiceGroups: [],
    coreRules: [],
    limits: { ...DEFAULT_POWER_LIMITS },
  };
}

const DND_ATTRIBUTES: Array<[string, string, string]> = [
  ['str', '力量', '近战、负重与肉体力量'],
  ['dex', '敏捷', '反应、闪避与精细动作'],
  ['con', '体质', '生命力与耐力'],
  ['int', '智力', '学识、推理与奥术'],
  ['wis', '感知', '洞察、意志与直觉'],
  ['cha', '魅力', '感染力、领导与交涉'],
];

/** DND 模板默认每级自动成长 */
export const DND_GROWTH_PER_LEVEL = 1;
/** DND 模板每级允许的最大成长（自动成长 + 手动加点） */
export const DND_PER_LEVEL_CAP = 2;

/** DND 风格模板：六维属性 + 经典经验表 + 示例技能与三选一 */
export function createDndRuleset(): GrowthRuleset {
  return {
    schemaVersion: GROWTH_SCHEMA_VERSION,
    name: 'DND 风格规则之书',
    description:
      '六维属性（每升一级全属性 +1，单级合理成长上限 +2）、20 级经验表。可按作品需要增删属性、技能与核心规则。',
    attributes: DND_ATTRIBUTES.map(([key, name, description]) => ({
      key,
      name,
      description,
      initial: 10,
      min: 1,
      max: 30,
      // 默认每升一级全属性 +1；上限 +2 为剧情奖励 / 手动加点留出余量，与一致性检查的等级上限一致
      growthPerLevel: DND_GROWTH_PER_LEVEL,
      perLevelCap: DND_PER_LEVEL_CAP,
    })),
    levels: {
      maxLevel: 20,
      // D&D 5e 经验表（相邻等级差值）
      curve: {
        kind: 'table',
        perLevel: [
          300, 600, 1800, 3800, 7500, 9000, 11000, 14000, 16000, 21000, 15000, 20000, 20000, 25000,
          30000, 30000, 40000, 40000, 50000,
        ],
      },
    },
    skills: [
      {
        id: 'second-wind',
        name: '回气',
        description: '战斗中短暂恢复体力',
        maxLevel: 3,
        costPerLevel: [0, 200, 500],
      },
      {
        id: 'fireball',
        name: '火球术',
        description: '范围火焰伤害',
        maxLevel: 5,
        costPerLevel: [0, 400, 800, 1600, 3200],
        prerequisites: { characterLevel: 5, attributes: { int: 13 } },
        exclusiveGroup: 'school',
      },
      {
        id: 'frost-nova',
        name: '冰霜新星',
        description: '冻结周围敌人',
        maxLevel: 5,
        costPerLevel: [0, 400, 800, 1600, 3200],
        prerequisites: { characterLevel: 5, attributes: { int: 13 } },
        exclusiveGroup: 'school',
      },
      {
        id: 'healing-word',
        name: '治愈真言',
        description: '远程治疗队友',
        maxLevel: 5,
        costPerLevel: [0, 300, 600, 1200, 2400],
        prerequisites: { attributes: { wis: 12 } },
      },
    ],
    choiceGroups: [
      {
        id: 'path',
        name: '道途抉择（三选一）',
        description: '3 级时选择成长方向，选定后不可更改',
        pick: 1,
        unlockLevel: 3,
        options: [
          {
            id: 'warrior',
            name: '战士之道',
            description: '力量与体质成长',
            grants: { skills: ['second-wind'], attributes: { str: 2, con: 1 } },
          },
          {
            id: 'mage',
            name: '法师之道',
            description: '智力成长，日后可学习元素法术',
            grants: { attributes: { int: 2, wis: 1 } },
          },
          {
            id: 'priest',
            name: '牧师之道',
            description: '感知成长，获得治疗能力',
            grants: { skills: ['healing-word'], attributes: { wis: 2, cha: 1 } },
          },
        ],
      },
    ],
    coreRules: [
      {
        id: 'rule-1',
        text: '任何角色在第一卷结束前不得超过 10 级',
        check: { kind: 'max-level', value: 10 },
      },
      {
        id: 'rule-2',
        text: '元素法术（火/冰）只能主修其一，主修后不可转修',
      },
    ],
    limits: { ...DEFAULT_POWER_LIMITS },
  };
}

export function createRulesetFromTemplate(template: GrowthTemplate): GrowthRuleset {
  return template === 'dnd' ? createDndRuleset() : createBlankRuleset();
}
