import { describe, expect, it } from 'vitest';
import {
  GROWTH_SIMULATION_RESULT_SCHEMA,
  applyGrowthEvent,
  applySimulationBranch,
  buildGrowthSimulationPrompt,
  createDndRuleset,
  createSheet,
  extractJsonObject,
  normalizeSimulatedEvent,
  parseGrowthSimulationResult,
  resolveSimulationCandidates,
} from '../src';

function setup() {
  const ruleset = createDndRuleset();
  const sheet = applyGrowthEvent(ruleset, createSheet(ruleset, '阿尔', { aliases: ['小阿'] }), {
    type: 'exp',
    delta: 900,
    chapter: 20,
  }).sheet;
  return { ruleset, sheet };
}

describe('候选项解析', () => {
  it('匹配选择项、技能与自由文本', () => {
    const { ruleset } = setup();
    const candidates = resolveSimulationCandidates(ruleset, [
      'warrior',
      '法师之道',
      'fireball',
      '去当海盗',
      'warrior',
    ]);
    expect(candidates).toEqual([
      expect.objectContaining({ id: 'warrior', groupId: 'path', optionId: 'warrior' }),
      expect.objectContaining({ id: 'mage', groupId: 'path', optionId: 'mage' }),
      expect.objectContaining({ id: 'fireball', skillId: 'fireball' }),
      { id: 'option-4', label: '去当海盗' },
    ]);
  });
});

describe('buildGrowthSimulationPrompt', () => {
  it('受控模式包含规则、角色状态、候选项、章节范围与 JSON 要求', () => {
    const { ruleset, sheet } = setup();
    const built = buildGrowthSimulationPrompt({
      ruleset,
      sheet,
      candidateChoices: ['warrior', 'mage'],
      coreRules: ['主角不能死亡'],
      mode: 'controlled',
      horizon: 10,
    });
    expect(built.startChapter).toBe(21);
    expect(built.candidates.map((c) => c.id)).toEqual(['warrior', 'mage']);
    expect(built.prompt).toContain('【受控成长】');
    expect(built.prompt).toContain('第 21 章 ~ 第 30 章');
    expect(built.prompt).toContain('任何角色在第一卷结束前不得超过 10 级');
    expect(built.prompt).toContain('主角不能死亡');
    expect(built.prompt).toContain('角色: 阿尔（别名 小阿）');
    expect(built.prompt).toContain('id=warrior');
    expect(built.prompt).toContain('fireball 火球术');
    expect(built.prompt).toContain('只输出一个 JSON 对象');
    expect(built.systemPrompt).toContain('JSON');
    expect(built.schema).toBe(GROWTH_SIMULATION_RESULT_SCHEMA);
  });

  it('自由模式无候选项时让 AI 自行提出方向，horizon 被限制在合理范围', () => {
    const { ruleset, sheet } = setup();
    const built = buildGrowthSimulationPrompt({
      ruleset,
      sheet,
      candidateChoices: [],
      mode: 'free',
      horizon: 9999,
      currentChapter: 100,
    });
    expect(built.horizon).toBe(200);
    expect(built.startChapter).toBe(101);
    expect(built.prompt).toContain('【自由成长】');
    expect(built.prompt).toContain('自行提出 2~3 个');
  });
});

describe('extractJsonObject', () => {
  it('处理代码块、前后说明文字、字符串中的括号与尾逗号', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('好的，结果如下：{"a":"}{","b":[1,2,],} 希望有帮助')).toEqual({
      a: '}{',
      b: [1, 2],
    });
    expect(extractJsonObject('没有 JSON')).toBeUndefined();
    expect(extractJsonObject('{"a": ')).toBeUndefined();
  });
});

describe('normalizeSimulatedEvent', () => {
  it('兼容中文类型、别名字段与「第N章」', () => {
    expect(
      normalizeSimulatedEvent({
        type: '经验',
        amount: '200',
        chapter: '第12章',
        reason: '击败巨龙',
      })
    ).toEqual({
      type: 'exp',
      delta: 200,
      chapter: 12,
      note: '击败巨龙',
      source: 'ai-sim',
    });
    expect(normalizeSimulatedEvent({ type: 'skill', skillId: 'fireball' })).toMatchObject({
      type: 'skill',
      target: 'fireball',
    });
    expect(
      normalizeSimulatedEvent({ type: 'choice', group: 'path', option: 'mage' })
    ).toMatchObject({
      type: 'choice',
      target: 'path',
      value: 'mage',
    });
  });

  it('无效事件返回 null', () => {
    expect(normalizeSimulatedEvent({ type: 'exp' })).toBeNull();
    expect(normalizeSimulatedEvent({ type: 'attribute', delta: 1 })).toBeNull();
    expect(normalizeSimulatedEvent({ type: 'teleport' })).toBeNull();
    expect(normalizeSimulatedEvent('exp')).toBeNull();
    expect(normalizeSimulatedEvent({ type: 'note' })).toBeNull();
  });
});

describe('parseGrowthSimulationResult', () => {
  const aiText = `\`\`\`json
{
  "branches": [
    {
      "id": "warrior",
      "title": "铁壁",
      "summary": "成为前排",
      "events": [
        { "chapter": 21, "type": "exp", "delta": 2000, "note": "攻城战" },
        { "chapter": 22, "type": "attribute", "target": "str", "delta": 1 },
        { "chapter": 23, "type": "teleport" }
      ],
      "risks": ["前期过强"]
    },
    {
      "id": "mage",
      "title": "元素",
      "summary": "主修火焰",
      "events": [
        { "chapter": 21, "type": "exp", "delta": 14000 },
        { "chapter": 21, "type": "attribute", "target": "int", "delta": 9 },
        { "chapter": 25, "type": "skill", "target": "fireball" },
        { "chapter": 26, "type": "skill", "target": "frost-nova" },
        { "chapter": 27, "type": "choice", "target": "bloodline", "value": "dragon" }
      ]
    }
  ],
  "recommendation": "warrior",
  "overallRisks": ["注意节奏"],
}
\`\`\``;

  it('解析分支、补充抉择事件并试算战力', () => {
    const { ruleset, sheet } = setup();
    const candidates = resolveSimulationCandidates(ruleset, ['warrior', 'mage']);
    const outcome = parseGrowthSimulationResult(aiText, {
      ruleset,
      sheet,
      candidates,
      mode: 'controlled',
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { result, issues } = outcome;
    expect(issues).toEqual(['分支 warrior 的第 3 个事件无效，已忽略']);
    expect(result.recommendation).toBe('warrior');
    expect(result.overallRisks).toEqual(['注意节奏']);
    const [warrior, mage] = result.branches;
    // 自动在开头补一条抉择事件
    expect(warrior.events[0]).toMatchObject({
      type: 'choice',
      target: 'path',
      value: 'warrior',
      chapter: 21,
    });
    expect(warrior.candidateId).toBe('warrior');
    expect(warrior.projected.level).toBeGreaterThan(sheet.level);
    expect(warrior.projected.skills.map((s) => s.id)).toContain('second-wind');
    expect(warrior.risks).toEqual(['前期过强']);
    // 法师分支：同章暴涨、互斥技能会被标出
    const codes = mage.warnings.map((w) => w.code);
    expect(codes).toContain('ATTRIBUTE_SPIKE');
    expect(codes).toContain('LEVEL_SPIKE');
    expect(codes).toContain('EVENT_SKIPPED');
    // 试算不修改原角色卡
    expect(sheet.choices).toHaveLength(0);
  });

  it('畸形 AI 返回给出明确错误', () => {
    const { ruleset, sheet } = setup();
    expect(parseGrowthSimulationResult('抱歉，我无法完成', { ruleset, sheet })).toMatchObject({
      ok: false,
      error: expect.stringContaining('不是有效的 JSON'),
    });
    expect(parseGrowthSimulationResult('{"foo": 1}', { ruleset, sheet })).toMatchObject({
      ok: false,
      error: expect.stringContaining('没有 branches'),
    });
    expect(parseGrowthSimulationResult('{"branches": [1, "x"]}', { ruleset, sheet })).toMatchObject(
      {
        ok: false,
        error: expect.stringContaining('全部无效'),
      }
    );
    expect(parseGrowthSimulationResult({ branches: 'nope' }, { ruleset, sheet }).ok).toBe(false);
  });

  it('分支 id 重复与事件数量限制', () => {
    const { ruleset, sheet } = setup();
    const events = Array.from({ length: 5 }, (_, i) => ({
      type: 'exp',
      delta: 1,
      chapter: 21 + i,
    }));
    const outcome = parseGrowthSimulationResult(
      {
        branches: [
          { id: 'a', events },
          { id: 'a', events: [] },
        ],
      },
      { ruleset, sheet, maxEventsPerBranch: 3 }
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.branches.map((b) => b.id)).toEqual(['a', 'a-2']);
    expect(outcome.result.branches[0].events).toHaveLength(3);
    expect(outcome.issues).toContain('分支 a 事件过多，仅保留前 3 个');
  });

  it('采用分支后写入事件（source=ai-sim），无法应用的事件被跳过', () => {
    const { ruleset, sheet } = setup();
    const candidates = resolveSimulationCandidates(ruleset, ['warrior', 'mage']);
    const outcome = parseGrowthSimulationResult(aiText, { ruleset, sheet, candidates });
    if (!outcome.ok) throw new Error(outcome.error);
    const applied = applySimulationBranch(ruleset, sheet, outcome.result.branches[1]);
    expect(applied.skipped.map((s) => s.event.target)).toEqual(['bloodline']);
    // 互斥技能在采用时只记为警告，由作者决定
    expect(applied.warnings.some((w) => w.code === 'SKILL_PREREQUISITE')).toBe(true);
    expect(applied.sheet.skills.map((s) => s.id)).toEqual(['fireball', 'frost-nova']);
    expect(applied.sheet.choices[0]).toMatchObject({ groupId: 'path', optionId: 'mage' });
    expect(applied.applied.every((event) => event.source === 'ai-sim')).toBe(true);
  });
});
