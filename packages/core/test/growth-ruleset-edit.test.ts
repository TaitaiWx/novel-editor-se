import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyGrowthEvent,
  createAttributeDraft,
  createBlankRuleset,
  createChoiceGroupDraft,
  createCoreRuleDraft,
  createDndRuleset,
  createSheet,
  createSkillDraft,
  expandSkillCosts,
  expForNextLevel,
  finalizeRuleset,
  findRulesetUsage,
  grantsToRewardRows,
  isRulesetEmpty,
  levelCurvePreview,
  moveItem,
  nextSequentialId,
  normalizeRuleset,
  removeFromRuleset,
  rewardRowsToGrants,
  rulesetErrors,
  validateRuleset,
  type GrowthRuleset,
} from '../src';

const SAMPLE_RULES = path.resolve(
  __dirname,
  '../../../apps/pc/sample-data/novels/星河旅人/资料/记忆/规则.json'
);

function errorPaths(ruleset: GrowthRuleset): string[] {
  return rulesetErrors(validateRuleset(ruleset)).map((issue) => issue.path);
}

describe('规则之书编辑：id 生成', () => {
  it('按「前缀-序号」生成，跳过已占用的 id，不从名称推导', () => {
    expect(nextSequentialId('attr', [])).toBe('attr-1');
    expect(nextSequentialId('attr', ['attr-1', 'attr-3'])).toBe('attr-2');
    const dnd = createDndRuleset();
    const attr = createAttributeDraft(dnd);
    expect(attr.key).toBe('attr-1');
    expect(attr.name).toBe('');
    expect(createSkillDraft(dnd).id).toMatch(/^skill-\d+$/);
    const group = createChoiceGroupDraft(dnd);
    expect(group.id).toMatch(/^choice-\d+$/);
    expect(group.options.map((option) => option.id)).toEqual(['option-1', 'option-2']);
    expect(createCoreRuleDraft({ ...dnd, coreRules: [{ id: 'rule-1', text: 'a' }] }, 'b')).toEqual({
      id: 'rule-2',
      text: 'b',
    });
  });

  it('保存前补齐空键名、去掉名称首尾空白', () => {
    const ruleset = createBlankRuleset();
    ruleset.attributes = [
      { ...createAttributeDraft(ruleset), key: 'attr-1', name: ' 气运 ' },
      { ...createAttributeDraft(ruleset), key: '', name: '灵力' },
    ];
    const finalized = finalizeRuleset(ruleset);
    expect(finalized.attributes.map((attr) => [attr.key, attr.name])).toEqual([
      ['attr-1', '气运'],
      ['attr-2', '灵力'],
    ]);
  });

  it('moveItem 移动与越界', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
    expect(isRulesetEmpty(createBlankRuleset())).toBe(true);
    expect(isRulesetEmpty(createDndRuleset())).toBe(false);
  });
});

describe('规则之书编辑：经验曲线与技能经验', () => {
  it('公式预览与 expForNextLevel 一致，受最高等级限制', () => {
    const levels = { maxLevel: 4, curve: { kind: 'formula' as const, base: 100, factor: 2 } };
    expect(levelCurvePreview(levels, 10)).toEqual([
      { level: 1, need: 100, total: 100 },
      { level: 2, need: 200, total: 300 },
      { level: 3, need: 400, total: 700 },
    ]);
    const dnd = createDndRuleset();
    const rows = levelCurvePreview(dnd.levels, 5);
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.need)).toEqual(
      [1, 2, 3, 4, 5].map((level) => expForNextLevel(dnd, level))
    );
  });

  it('经验表比最高等级短时重复最后一项', () => {
    const rows = levelCurvePreview(
      { maxLevel: 5, curve: { kind: 'table', perLevel: [10, 20] } },
      10
    );
    expect(rows.map((row) => row.need)).toEqual([10, 20, 20, 20]);
  });

  it('技能升级经验按最高等级展开', () => {
    expect(expandSkillCosts({ maxLevel: 4, costPerLevel: [0, 100] })).toEqual([0, 100, 100, 100]);
    expect(expandSkillCosts({ maxLevel: 2, costPerLevel: [0, 100, 200] })).toEqual([0, 100]);
  });
});

describe('规则之书编辑：抉择奖励 ↔ 表格行', () => {
  it('往返映射；空属性 / 0 加成丢弃，同属性合并，技能去重', () => {
    const grants = { skills: ['second-wind'], attributes: { str: 2, con: 1 } };
    const rows = grantsToRewardRows(grants);
    expect(rows).toEqual({
      attributes: [
        { key: 'str', amount: 2 },
        { key: 'con', amount: 1 },
      ],
      skills: ['second-wind'],
    });
    expect(rewardRowsToGrants(rows)).toEqual(grants);
    expect(
      rewardRowsToGrants({
        attributes: [
          { key: 'str', amount: 1 },
          { key: 'str', amount: 2 },
          { key: '', amount: 5 },
          { key: 'dex', amount: 0 },
        ],
        skills: ['a', 'a', ''],
      })
    ).toEqual({ skills: ['a'], attributes: { str: 3 } });
    expect(rewardRowsToGrants({ attributes: [], skills: [] })).toBeUndefined();
    expect(grantsToRewardRows(undefined)).toEqual({ attributes: [], skills: [] });
  });
});

describe('规则之书编辑：删除前的引用检查', () => {
  const dnd = createDndRuleset();
  const sheet = applyGrowthEvent(dnd, createSheet(dnd, '林舟'), {
    type: 'choice',
    target: 'path',
    value: 'warrior',
  }).sheet;

  it('属性：成长卡与规则内部引用', () => {
    const usage = findRulesetUsage(dnd, [sheet], { kind: 'attribute', key: 'int' });
    expect(usage.characters).toEqual(['林舟']);
    expect(usage.references.some((text) => text.includes('火球术'))).toBe(true);
    expect(usage.references.some((text) => text.includes('法师之道'))).toBe(true);
  });

  it('技能 / 抉择 / 选项', () => {
    expect(findRulesetUsage(dnd, [sheet], { kind: 'skill', id: 'second-wind' }).characters).toEqual(
      ['林舟']
    );
    expect(findRulesetUsage(dnd, [], { kind: 'skill', id: 'fireball' })).toEqual({
      characters: [],
      references: [],
    });
    expect(findRulesetUsage(dnd, [sheet], { kind: 'choice-group', id: 'path' }).characters).toEqual(
      ['林舟']
    );
    expect(
      findRulesetUsage(dnd, [sheet], { kind: 'choice-option', groupId: 'path', optionId: 'mage' })
        .characters
    ).toEqual([]);
  });

  it('核心规则的自动校验算作引用，删除时一并去掉校验', () => {
    const ruleset: GrowthRuleset = {
      ...dnd,
      coreRules: [
        { id: 'rule-1', text: '不学火球', check: { kind: 'forbid-skill', skillId: 'fireball' } },
      ],
    };
    const usage = findRulesetUsage(ruleset, [], { kind: 'skill', id: 'fireball' });
    expect(usage.references).toEqual(['核心规则「不学火球」的自动校验']);
    const removed = removeFromRuleset(ruleset, { kind: 'skill', id: 'fireball' });
    expect(removed.skills.some((skill) => skill.id === 'fireball')).toBe(false);
    expect(removed.coreRules).toEqual([{ id: 'rule-1', text: '不学火球' }]);
  });

  it('删除属性时清理前置条件与奖励，结果仍能通过校验', () => {
    const removed = removeFromRuleset(dnd, { kind: 'attribute', key: 'int' });
    expect(removed.attributes.some((attr) => attr.key === 'int')).toBe(false);
    for (const skill of removed.skills) {
      expect(skill.prerequisites?.attributes?.int).toBeUndefined();
    }
    const mage = removed.choiceGroups[0].options.find((option) => option.id === 'mage');
    expect(mage?.grants).toEqual({ attributes: { wis: 1 } });
    expect(errorPaths(removed)).toEqual([]);
  });

  it('删除选项后可选数量不超过剩余选项', () => {
    const ruleset: GrowthRuleset = {
      ...dnd,
      choiceGroups: [{ ...dnd.choiceGroups[0], pick: 3 }],
    };
    const removed = removeFromRuleset(ruleset, {
      kind: 'choice-option',
      groupId: 'path',
      optionId: 'mage',
    });
    expect(removed.choiceGroups[0].options).toHaveLength(2);
    expect(removed.choiceGroups[0].pick).toBe(2);
  });
});

describe('规则之书校验', () => {
  it('模板与示例作品集的规则没有错误', () => {
    expect(errorPaths(createDndRuleset())).toEqual([]);
    expect(errorPaths(createBlankRuleset())).toEqual([]);
    const sample = normalizeRuleset(JSON.parse(readFileSync(SAMPLE_RULES, 'utf-8')));
    expect(errorPaths(sample)).toEqual([]);
  });

  it('字段级错误带路径', () => {
    const dnd = createDndRuleset();
    const broken: GrowthRuleset = {
      ...dnd,
      name: ' ',
      attributes: [
        { ...dnd.attributes[0], max: 0, min: 5, initial: 5 },
        { ...dnd.attributes[1], key: 'str', name: '力量' },
        { ...dnd.attributes[2], key: 'a b', name: '' },
      ],
      levels: { maxLevel: 0, curve: { kind: 'table', perLevel: [100, 0] } },
      skills: [
        {
          ...dnd.skills[0],
          name: '',
          costPerLevel: [-1],
          prerequisites: { skills: { [dnd.skills[0].id]: 1, ghost: 1 }, attributes: { int: 1 } },
        },
      ],
      choiceGroups: [
        {
          id: 'g',
          name: '',
          pick: 3,
          options: [
            { id: 'o1', name: 'A', grants: { attributes: { nope: 1 }, skills: ['ghost'] } },
            { id: 'o2', name: 'A' },
          ],
        },
      ],
      coreRules: [
        { id: 'rule-1', text: '', check: { kind: 'max-attribute', key: 'missing', value: 3 } },
      ],
      limits: { ...dnd.limits, maxLevelsPerChapter: 0 },
    };
    const paths = errorPaths(broken);
    expect(paths).toEqual(
      expect.arrayContaining([
        'name',
        'attributes.0.max',
        'attributes.1.key',
        'attributes.1.name',
        'attributes.2.key',
        'attributes.2.name',
        'levels.maxLevel',
        'levels.curve.perLevel.1',
        'skills.0.name',
        'skills.0.costPerLevel.0',
        `skills.0.prerequisites.skills.${dnd.skills[0].id}`,
        'skills.0.prerequisites.skills.ghost',
        'skills.0.prerequisites.attributes.int',
        'choiceGroups.0.name',
        'choiceGroups.0.pick',
        'choiceGroups.0.options.1.name',
        'choiceGroups.0.options.0.grants.attributes.nope',
        'choiceGroups.0.options.0.grants.skills.ghost',
        'coreRules.0.text',
        'coreRules.0.check',
        'limits.maxLevelsPerChapter',
      ])
    );
  });

  it('只有一个选项、每级成长超过上限是提醒而不是错误', () => {
    const dnd = createDndRuleset();
    const ruleset: GrowthRuleset = {
      ...dnd,
      attributes: [{ ...dnd.attributes[0], growthPerLevel: 5, perLevelCap: 2 }],
      choiceGroups: [{ id: 'g', name: '唯一', pick: 1, options: [{ id: 'o', name: 'A' }] }],
      skills: [],
      coreRules: [],
    };
    const issues = validateRuleset(ruleset);
    expect(rulesetErrors(issues)).toEqual([]);
    expect(issues.map((issue) => issue.path)).toEqual([
      'attributes.0.growthPerLevel',
      'choiceGroups.0.options',
    ]);
  });
});
