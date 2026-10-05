import { describe, expect, it } from 'vitest';
import {
  CoreError,
  addLocation,
  addParty,
  applyGrowthEvent,
  applyGrowthEvents,
  checkMemory,
  checkSheetConsistency,
  createBlankRuleset,
  createDndRuleset,
  createSheet,
  detectForgottenCompanions,
  endParty,
  expForNextLevel,
  footprintsOf,
  getLevelProgress,
  getSkillProgress,
  latestKnownChapter,
  levelFromExp,
  markCompanionSeen,
  normalizeAtlas,
  normalizePartyBook,
  normalizeRuleset,
  normalizeSheet,
  recordVisit,
  removeLocation,
  removeParty,
  renderSheetMarkdown,
  totalExpForLevel,
  type GrowthRuleset,
  type GrowthSheet,
  withObservedAppearances,
  type PartyBook,
} from '../src';

const NOW = '2026-01-01T00:00:00.000Z';

function tableRuleset(): GrowthRuleset {
  const ruleset = createBlankRuleset();
  ruleset.levels = { maxLevel: 5, curve: { kind: 'table', perLevel: [100, 200, 300] } };
  ruleset.attributes = [
    { key: 'str', name: '力量', initial: 10, min: 1, max: 20, growthPerLevel: 1, perLevelCap: 2 },
  ];
  return ruleset;
}

function emptyParty(): PartyBook {
  return { schemaVersion: 1, parties: [], companions: [] };
}

describe('经验曲线', () => {
  it('表格曲线：不够长时重复最后一项', () => {
    const ruleset = tableRuleset();
    expect(expForNextLevel(ruleset, 1)).toBe(100);
    expect(expForNextLevel(ruleset, 3)).toBe(300);
    expect(expForNextLevel(ruleset, 4)).toBe(300);
    expect(totalExpForLevel(ruleset, 1)).toBe(0);
    expect(totalExpForLevel(ruleset, 3)).toBe(300);
    expect(totalExpForLevel(ruleset, 5)).toBe(900);
    // 超过 maxLevel 时按 maxLevel 计算
    expect(totalExpForLevel(ruleset, 99)).toBe(900);
  });

  it('公式曲线 base × factor^(L-1)', () => {
    const ruleset = createBlankRuleset();
    ruleset.levels.curve = { kind: 'formula', base: 100, factor: 2 };
    expect(expForNextLevel(ruleset, 1)).toBe(100);
    expect(expForNextLevel(ruleset, 3)).toBe(400);
    expect(levelFromExp(ruleset, 299)).toBe(2);
    expect(levelFromExp(ruleset, 300)).toBe(3);
  });

  it('等级由累计经验推导，受上限限制', () => {
    const ruleset = tableRuleset();
    expect(levelFromExp(ruleset, 0)).toBe(1);
    expect(levelFromExp(ruleset, 99)).toBe(1);
    expect(levelFromExp(ruleset, 100)).toBe(2);
    expect(levelFromExp(ruleset, 10_000)).toBe(5);
  });

  it('等级进度：距下一级经验与满级', () => {
    const ruleset = tableRuleset();
    const sheet = { ...createSheet(ruleset, '阿尔', { now: NOW }), level: 2, exp: 150 };
    const progress = getLevelProgress(ruleset, sheet);
    expect(progress).toMatchObject({
      level: 2,
      expIntoLevel: 50,
      expForLevel: 200,
      expToNext: 150,
      nextLevelExp: 300,
      isMaxLevel: false,
    });
    expect(progress.ratio).toBeCloseTo(0.25);
    const maxed = getLevelProgress(ruleset, { ...sheet, level: 5, exp: 900 });
    expect(maxed).toMatchObject({ isMaxLevel: true, expToNext: 0, nextLevelExp: null, ratio: 1 });
  });
});

describe('成长事件', () => {
  it('获得经验自动升级，并按规则成长属性', () => {
    const ruleset = tableRuleset();
    const sheet = createSheet(ruleset, '阿尔', { now: NOW });
    const result = applyGrowthEvent(
      ruleset,
      sheet,
      { type: 'exp', delta: 320, chapter: 3 },
      { now: NOW }
    );
    expect(result.sheet.level).toBe(3);
    expect(result.levelUps).toBe(2);
    expect(result.sheet.attributes.str).toBe(12);
    expect(result.event).toMatchObject({ id: 'evt-1', levelBefore: 1, levelAfter: 3, chapter: 3 });
    // 不修改入参
    expect(sheet.level).toBe(1);
    expect(sheet.events).toHaveLength(0);
  });

  it('扣经验不会自动降级', () => {
    const ruleset = tableRuleset();
    let sheet = createSheet(ruleset, '阿尔');
    sheet = applyGrowthEvent(ruleset, sheet, { type: 'exp', delta: 150 }).sheet;
    sheet = applyGrowthEvent(ruleset, sheet, { type: 'exp', delta: -1000 }).sheet;
    expect(sheet.exp).toBe(0);
    expect(sheet.level).toBe(2);
  });

  it('level 事件直接升级并补齐经验；不能超过上限', () => {
    const ruleset = tableRuleset();
    const sheet = createSheet(ruleset, '阿尔');
    const result = applyGrowthEvent(ruleset, sheet, { type: 'level', delta: 2 });
    expect(result.sheet.level).toBe(3);
    expect(result.sheet.exp).toBe(300);
    expect(() => applyGrowthEvent(ruleset, sheet, { type: 'level', delta: 10 })).toThrow(
      /超过规则上限/
    );
    const loose = applyGrowthEvent(ruleset, sheet, { type: 'level', delta: 10 }, { strict: false });
    expect(loose.warnings[0].code).toBe('LEVEL_ABOVE_MAX');
  });

  it('属性：支持用名称引用，越界在严格模式下报错', () => {
    const ruleset = tableRuleset();
    const sheet = createSheet(ruleset, '阿尔');
    const result = applyGrowthEvent(ruleset, sheet, {
      type: 'attribute',
      target: '力量',
      delta: 3,
    });
    expect(result.sheet.attributes.str).toBe(13);
    expect(result.event.target).toBe('str');
    expect(() =>
      applyGrowthEvent(ruleset, sheet, { type: 'attribute', target: 'str', delta: 50 })
    ).toThrow(CoreError);
    expect(() =>
      applyGrowthEvent(ruleset, sheet, { type: 'attribute', target: 'luck', delta: 1 })
    ).toThrow(/没有属性/);
    const loose = applyGrowthEvent(
      ruleset,
      sheet,
      { type: 'attribute', target: 'luck', delta: 1 },
      { strict: false }
    );
    expect(loose.sheet.attributes.luck).toBe(1);
  });

  it('非法 delta 与缺少参数会报错', () => {
    const ruleset = tableRuleset();
    const sheet = createSheet(ruleset, '阿尔');
    expect(() => applyGrowthEvent(ruleset, sheet, { type: 'exp', delta: Number.NaN })).toThrow();
    expect(() => applyGrowthEvent(ruleset, sheet, { type: 'exp' })).toThrow(/delta/);
    expect(() => applyGrowthEvent(ruleset, sheet, { type: 'note' })).toThrow(/note/);
    expect(
      applyGrowthEvent(ruleset, sheet, { type: 'note', note: '断了一条手臂' }).sheet.events
    ).toHaveLength(1);
  });
});

describe('技能', () => {
  it('学习技能需要满足前置条件', () => {
    const ruleset = createDndRuleset();
    const sheet = createSheet(ruleset, '梅林');
    expect(() => applyGrowthEvent(ruleset, sheet, { type: 'skill', target: 'fireball' })).toThrow(
      /角色等级 5/
    );
    const ready = { ...sheet, level: 5, attributes: { ...sheet.attributes, int: 14 } };
    const result = applyGrowthEvent(ruleset, ready, { type: 'skill', target: '火球术', delta: 2 });
    expect(result.sheet.skills).toEqual([{ id: 'fireball', level: 2, exp: 0 }]);
    const progress = getSkillProgress(ruleset, result.sheet.skills[0]);
    expect(progress).toMatchObject({ name: '火球术', nextCost: 800, expToNext: 800, maxLevel: 5 });
  });

  it('互斥组：火球术与冰霜新星只能二选一', () => {
    const ruleset = createDndRuleset();
    const base = createSheet(ruleset, '梅林');
    const ready = { ...base, level: 5, attributes: { ...base.attributes, int: 14 } };
    const withFire = applyGrowthEvent(ruleset, ready, { type: 'skill', target: 'fireball' }).sheet;
    expect(() =>
      applyGrowthEvent(ruleset, withFire, { type: 'skill', target: 'frost-nova' })
    ).toThrow(/互斥/);
    const forced = applyGrowthEvent(
      ruleset,
      withFire,
      { type: 'skill', target: 'frost-nova' },
      { strict: false }
    ).sheet;
    const warnings = checkSheetConsistency(ruleset, forced);
    expect(warnings.some((w) => w.code === 'SKILL_EXCLUSIVE' && w.severity === 'error')).toBe(true);
  });

  it('超过最高等级报错', () => {
    const ruleset = createDndRuleset();
    const sheet = createSheet(ruleset, '战士');
    expect(() =>
      applyGrowthEvent(ruleset, sheet, { type: 'skill', target: 'second-wind', delta: 4 })
    ).toThrow(/超过上限 3/);
  });

  it('技能经验累积到消耗时自动升级，满级后清零', () => {
    const ruleset = createDndRuleset();
    const sheet = createSheet(ruleset, '战士');
    // second-wind 消耗 [0, 200, 500]：0→1 免费，1→2 需 200，2→3 需 500
    let result = applyGrowthEvent(ruleset, sheet, {
      type: 'skill-exp',
      target: 'second-wind',
      delta: 250,
    });
    expect(result.sheet.skills[0]).toEqual({ id: 'second-wind', level: 2, exp: 50 });
    result = applyGrowthEvent(ruleset, result.sheet, {
      type: 'skill-exp',
      target: 'second-wind',
      delta: 9999,
    });
    expect(result.sheet.skills[0]).toEqual({ id: 'second-wind', level: 3, exp: 0 });
  });
});

describe('能力抉择（二选一 / 三选一）', () => {
  it('记录选择并发放奖励', () => {
    const ruleset = createDndRuleset();
    const sheet = createSheet(ruleset, '阿尔');
    const result = applyGrowthEvent(ruleset, sheet, {
      type: 'choice',
      target: 'path',
      value: '战士之道',
      chapter: 12,
    });
    expect(result.sheet.choices).toMatchObject([
      { groupId: 'path', optionId: 'warrior', chapter: 12 },
    ]);
    expect(result.sheet.attributes.str).toBe(12);
    expect(result.sheet.attributes.con).toBe(11);
    expect(result.sheet.skills).toEqual([{ id: 'second-wind', level: 1, exp: 0 }]);
  });

  it('超过可选数量、重复选择、未知选项都会被拒绝', () => {
    const ruleset = createDndRuleset();
    const chosen = applyGrowthEvent(ruleset, createSheet(ruleset, '阿尔'), {
      type: 'choice',
      target: 'path',
      value: 'warrior',
    }).sheet;
    expect(() =>
      applyGrowthEvent(ruleset, chosen, { type: 'choice', target: 'path', value: 'mage' })
    ).toThrow(/只能选择 1 项/);
    expect(() =>
      applyGrowthEvent(ruleset, chosen, { type: 'choice', target: 'path', value: 'warrior' })
    ).toThrow(/已经选择过/);
    expect(() =>
      applyGrowthEvent(ruleset, chosen, { type: 'choice', target: 'path', value: 'bard' })
    ).toThrow(/没有选项/);
    expect(() =>
      applyGrowthEvent(ruleset, chosen, { type: 'choice', target: 'nope', value: 'x' })
    ).toThrow(/没有选择组/);
  });

  it('批量应用事件', () => {
    const ruleset = tableRuleset();
    const { sheet, events } = applyGrowthEvents(ruleset, createSheet(ruleset, '阿尔'), [
      { type: 'exp', delta: 100, chapter: 1 },
      { type: 'attribute', target: 'str', delta: 1, chapter: 1 },
    ]);
    expect(events.map((e) => e.id)).toEqual(['evt-1', 'evt-2']);
    expect(sheet.attributes.str).toBe(12);
  });
});

describe('战力一致性检查', () => {
  it('健康的角色卡没有警告', () => {
    const ruleset = tableRuleset();
    const sheet = applyGrowthEvent(ruleset, createSheet(ruleset, '阿尔'), {
      type: 'exp',
      delta: 100,
      chapter: 1,
    }).sheet;
    expect(checkSheetConsistency(ruleset, sheet)).toEqual([]);
  });

  it('发现等级/经验不符、属性越界与超过每级上限', () => {
    const ruleset = tableRuleset();
    const sheet: GrowthSheet = {
      ...createSheet(ruleset, '阿尔'),
      level: 2,
      exp: 0,
      attributes: { str: 19, wis: 3 },
    };
    const codes = checkSheetConsistency(ruleset, sheet).map((w) => w.code);
    expect(codes).toContain('LEVEL_EXP_MISMATCH');
    // 2 级合理上限 = 10 + 2 × 1 = 12
    expect(codes).toContain('ATTRIBUTE_ABOVE_LEVEL_CAP');
    expect(codes).toContain('UNKNOWN_ATTRIBUTE');
    const outOfRange = checkSheetConsistency(ruleset, { ...sheet, attributes: { str: 25 } });
    expect(outOfRange.find((w) => w.code === 'ATTRIBUTE_OUT_OF_RANGE')?.severity).toBe('error');
  });

  it('抉择奖励计入属性合理上限', () => {
    const ruleset = createDndRuleset();
    const sheet = applyGrowthEvent(ruleset, createSheet(ruleset, '阿尔'), {
      type: 'choice',
      target: 'path',
      value: 'warrior',
    }).sheet;
    expect(
      checkSheetConsistency(ruleset, sheet).filter((w) => w.code === 'ATTRIBUTE_ABOVE_LEVEL_CAP')
    ).toEqual([]);
  });

  it('同一章暴涨：等级、属性、技能', () => {
    const ruleset = tableRuleset();
    ruleset.limits.maxLevelsPerChapter = 1;
    ruleset.limits.maxAttributeGainPerChapter = 1;
    const { sheet } = applyGrowthEvents(
      ruleset,
      createSheet(ruleset, '阿尔'),
      [
        { type: 'exp', delta: 600, chapter: 7 },
        { type: 'attribute', target: 'str', delta: 1, chapter: 7 },
        { type: 'attribute', target: 'str', delta: 1, chapter: 7 },
      ],
      { strict: false }
    );
    const warnings = checkSheetConsistency(ruleset, sheet);
    expect(warnings.find((w) => w.code === 'LEVEL_SPIKE')).toMatchObject({ chapter: 7 });
    expect(warnings.find((w) => w.code === 'ATTRIBUTE_SPIKE')).toMatchObject({ chapter: 7 });
  });

  it('可机器校验的核心规则', () => {
    const ruleset = createDndRuleset();
    ruleset.coreRules.push(
      {
        id: 'r-forbid',
        text: '主角不得学习治愈',
        appliesTo: ['阿尔'],
        check: { kind: 'forbid-skill', skillId: 'healing-word' },
      },
      {
        id: 'r-choice',
        text: '5 级前必须选择道途',
        check: { kind: 'require-choice-by-level', groupId: 'path', level: 5 },
      },
      {
        id: 'r-attr',
        text: '力量不超过 11',
        check: { kind: 'max-attribute', key: 'str', value: 11 },
      }
    );
    const sheet: GrowthSheet = {
      ...createSheet(ruleset, '阿尔'),
      level: 12,
      exp: totalExpForLevel(ruleset, 12),
      attributes: { ...createSheet(ruleset, 'x').attributes, wis: 14, str: 12 },
      skills: [{ id: 'healing-word', level: 1, exp: 0 }],
    };
    const messages = checkSheetConsistency(ruleset, sheet)
      .filter((w) => w.code === 'CORE_RULE')
      .map((w) => w.message);
    expect(messages.some((m) => m.includes('第一卷结束前不得超过 10 级'))).toBe(true);
    expect(messages.some((m) => m.includes('主角不得学习治愈'))).toBe(true);
    expect(messages.some((m) => m.includes('5 级前必须选择道途'))).toBe(true);
    expect(messages.some((m) => m.includes('力量不超过 11'))).toBe(true);
    // appliesTo 只对指定角色生效
    const other = checkSheetConsistency(ruleset, { ...sheet, name: '路人' });
    expect(other.some((w) => w.message.includes('主角不得学习治愈'))).toBe(false);
  });
});

describe('队伍与被遗忘的配角', () => {
  it('组队自动登记成员出场，解散与删除', () => {
    let book = addParty(emptyParty(), {
      name: '银月小队',
      members: ['阿尔', '莉娜', '莉娜'],
      fromChapter: 3,
    });
    expect(book.parties[0]).toMatchObject({
      id: '银月小队',
      members: ['阿尔', '莉娜'],
      fromChapter: 3,
    });
    expect(book.companions.map((c) => c.name)).toEqual(['阿尔', '莉娜']);
    expect(() => addParty(book, { name: '银月小队', members: ['x'] })).toThrow(/已存在/);
    expect(() => addParty(book, { name: '空队', members: [] })).toThrow(/至少/);
    book = endParty(book, '银月小队', 20);
    expect(book.parties[0].toChapter).toBe(20);
    expect(() => endParty(book, '银月小队', 1)).toThrow(/不能早于/);
    expect(removeParty(book, '银月小队').parties).toHaveLength(0);
  });

  it('出场章节只会向后推进', () => {
    let book = markCompanionSeen(emptyParty(), '莉娜', 30);
    book = markCompanionSeen(book, '莉娜', 10, { important: true });
    expect(book.companions[0]).toEqual({ name: '莉娜', lastSeenChapter: 30, important: true });
  });

  it('超过阈值未出场的配角被提醒，重点配角优先', () => {
    let book = emptyParty();
    book = addParty(book, { name: '旧队', members: ['老铁'], fromChapter: 1, toChapter: 5 });
    book = markCompanionSeen(book, '莉娜', 40, { important: true });
    book = markCompanionSeen(book, '路人甲', 90);
    const forgotten = detectForgottenCompanions(book, 100, 30);
    expect(forgotten.map((f) => f.name)).toEqual(['莉娜', '老铁']);
    expect(forgotten[1]).toMatchObject({ chaptersAbsent: 95, parties: ['旧队'] });
    expect(latestKnownChapter(book)).toBe(90);
  });

  it('角色卡事件与地图到访也算出场，不会误报', () => {
    const ruleset = tableRuleset();
    ruleset.limits.forgottenAfterChapters = 10;
    let party = addParty(emptyParty(), {
      name: '队',
      members: ['阿尔', '莉娜', '老铁'],
      fromChapter: 1,
    });
    party = markCompanionSeen(party, '老铁', 2);
    const sheet = applyGrowthEvent(ruleset, createSheet(ruleset, '阿尔', { aliases: ['小阿'] }), {
      type: 'exp',
      delta: 1,
      chapter: 50,
    }).sheet;
    const atlas = recordVisit({ schemaVersion: 1, locations: [] }, '霜城', '莉娜', 48);
    const observed = withObservedAppearances(party, [sheet], atlas);
    expect(observed.companions.map((c) => [c.name, c.lastSeenChapter])).toEqual([
      ['阿尔', 50],
      ['莉娜', 48],
      ['老铁', 2],
    ]);
    // 不修改入参
    expect(party.companions[0].lastSeenChapter).toBe(1);
    const result = checkMemory({ ruleset, sheets: [sheet], party, atlas });
    expect(result.forgotten.map((f) => f.name)).toEqual(['老铁']);
  });

  it('checkMemory 汇总警告与遗忘提醒', () => {
    const ruleset = tableRuleset();
    ruleset.limits.forgottenAfterChapters = 10;
    const sheet = applyGrowthEvent(ruleset, createSheet(ruleset, '阿尔'), {
      type: 'exp',
      delta: 10,
      chapter: 50,
    }).sheet;
    const party = markCompanionSeen(emptyParty(), '莉娜', 5);
    const result = checkMemory({
      ruleset,
      sheets: [sheet, { ...sheet, name: '坏', attributes: { str: 99 } }],
      party,
      atlas: { schemaVersion: 1, locations: [] },
    });
    expect(result.currentChapter).toBe(50);
    expect(result.forgotten.map((f) => f.name)).toEqual(['莉娜']);
    expect(result.summary.errors).toBeGreaterThan(0);
    expect(result.warnings[0].severity).toBe('error');
  });
});

describe('地图', () => {
  it('添加地点、记录到访、足迹排序与删除', () => {
    let atlas = addLocation(
      { schemaVersion: 1, locations: [] },
      { name: '永冬王国', region: '北境' }
    );
    expect(() => addLocation(atlas, { name: '城堡', parent: '不存在' })).toThrow(/上级地点不存在/);
    atlas = addLocation(atlas, { name: '霜城', parent: '永冬王国' });
    atlas = recordVisit(atlas, '霜城', '阿尔', 12);
    atlas = recordVisit(atlas, '迷雾森林', '阿尔', 3, '初遇莉娜');
    expect(atlas.locations.find((l) => l.name === '迷雾森林')?.firstChapter).toBe(3);
    expect(footprintsOf(atlas, '阿尔').map((f) => f.location)).toEqual(['迷雾森林', '霜城']);
    atlas = removeLocation(atlas, '霜城');
    expect(atlas.locations.map((l) => l.name)).toEqual(['永冬王国', '迷雾森林']);
  });
});

describe('schema 校验与迁移', () => {
  it('旧版本（无 schemaVersion、顶层 maxLevel）自动迁移', () => {
    const ruleset = normalizeRuleset({
      name: '旧规则',
      maxLevel: 9,
      expCurve: { perLevel: [10, '20', -5, 'x'] },
      attributes: [{ key: 'str', name: '力量', max: 5, initial: 99 }, { name: '' }, 'bad'],
      skills: [{ name: '剑术' }, { id: 'a', name: 'A', maxLevel: 0 }],
      choiceGroups: [{ name: '天赋', options: ['火', '冰', { name: '雷' }], pick: 9 }],
      coreRules: [
        '不能复活',
        { text: '' },
        { text: '最多 9 级', check: { kind: 'max-level', value: '9' } },
      ],
    });
    expect(ruleset.schemaVersion).toBe(1);
    expect(ruleset.levels).toEqual({ maxLevel: 9, curve: { kind: 'table', perLevel: [10, 20] } });
    expect(ruleset.attributes).toHaveLength(1);
    expect(ruleset.attributes[0].initial).toBe(5);
    expect(ruleset.skills.map((s) => [s.id, s.maxLevel])).toEqual([
      ['剑术', 1],
      ['a', 1],
    ]);
    expect(ruleset.choiceGroups[0].pick).toBe(3);
    expect(ruleset.choiceGroups[0].options.map((o) => o.name)).toEqual(['火', '冰', '雷']);
    expect(ruleset.coreRules).toEqual([
      { id: 'rule-1', text: '不能复活' },
      { id: 'rule-3', text: '最多 9 级', check: { kind: 'max-level', value: 9 } },
    ]);
  });

  it('未来版本拒绝读取，非对象报错', () => {
    expect(() => normalizeRuleset({ schemaVersion: 99 })).toThrow(/高于当前支持的版本/);
    expect(() => normalizeRuleset('x')).toThrow(CoreError);
    expect(() => normalizeSheet({ schemaVersion: 2, name: 'a' })).toThrow(/schemaVersion/);
    expect(() => normalizeSheet({})).toThrow(/缺少 name/);
  });

  it('角色卡/队伍/地图容错', () => {
    const sheet = normalizeSheet(
      {
        aliases: '小阿,阿尔',
        level: 0,
        exp: -5,
        attributes: { str: '12', bad: 'x' },
        skills: [{ id: 'a', level: 2 }, { id: 'a' }, { level: 1 }],
        events: [{ type: 'exp', delta: 5 }, { type: 'boom' }],
      },
      '阿尔'
    );
    expect(sheet).toMatchObject({
      name: '阿尔',
      aliases: ['小阿'],
      level: 1,
      exp: 0,
      attributes: { str: 12 },
    });
    expect(sheet.skills).toEqual([{ id: 'a', level: 2, exp: 0 }]);
    expect(sheet.events).toHaveLength(1);
    const party = normalizePartyBook({
      parties: [{ name: '队', members: 'a,b' }, {}],
      companions: [{ name: 'c', lastSeenChapter: '9' }],
    });
    expect(party.parties[0].members).toEqual(['a', 'b']);
    expect(party.companions[0].lastSeenChapter).toBe(9);
    expect(normalizeAtlas(undefined).locations).toEqual([]);
    expect(
      normalizeAtlas({ locations: [{ name: '城', visits: [{ character: 'a' }, {}] }] }).locations[0]
        .visits
    ).toEqual([{ character: 'a' }]);
  });

  it('Markdown 摘要包含关键信息', () => {
    const ruleset = createDndRuleset();
    const sheet = applyGrowthEvent(ruleset, createSheet(ruleset, '阿尔'), {
      type: 'exp',
      delta: 400,
      chapter: 2,
      note: '击败哥布林',
    }).sheet;
    const md = renderSheetMarkdown(ruleset, sheet);
    expect(md).toContain('# 阿尔');
    expect(md).toContain('距下一级：500');
    expect(md).toContain('第 2 章：经验 +400（1 → 2 级） — 击败哥布林');
  });
});
