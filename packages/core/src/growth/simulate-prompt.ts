/**
 * AI 成长推演（一）：候选项解析与 prompt 构造
 *
 * 流程：buildGrowthSimulationPrompt → （GUI 调用已配置的 AI / CLI 交给外部 AI agent）
 *      → parseGrowthSimulationResult（见 ./simulate.ts）校验 AI 返回的 JSON 并试算每个分支
 *      → 作者选择「采用此分支」后才调用 applySimulationBranch 写入；推演结果永远不会自动生效
 */
import {
  expForNextLevel,
  findAttributeDef,
  findOptionAnywhere,
  findSkillDef,
  getLevelProgress,
  getSkillProgress,
  latestChapterOfSheet,
} from './engine';
import type { GrowthRuleset, GrowthSheet } from './types';

export type GrowthSimulationMode = 'controlled' | 'free';
export const GROWTH_SIMULATION_MODES: readonly GrowthSimulationMode[] = ['controlled', 'free'];

export interface SimulationCandidate {
  id: string;
  label: string;
  description?: string;
  groupId?: string;
  optionId?: string;
  skillId?: string;
}

export interface BuildSimulationInput {
  ruleset: GrowthRuleset;
  sheet: GrowthSheet;
  /** 候选项：选择项 id/名称、技能 id/名称或任意文字 */
  candidateChoices: Array<string | SimulationCandidate>;
  /** 本次推演额外附加的核心规则 */
  coreRules?: string[];
  mode: GrowthSimulationMode;
  /** 推演的章节数 */
  horizon: number;
  /** 推演起点章节（默认取角色卡中最新章节） */
  currentChapter?: number;
}

export interface GrowthSimulationPrompt {
  systemPrompt: string;
  prompt: string;
  candidates: SimulationCandidate[];
  mode: GrowthSimulationMode;
  horizon: number;
  startChapter: number;
  /** 期望 AI 返回的 JSON 结构说明 */
  schema: Record<string, unknown>;
}

/** AI 返回结构（JSON Schema 简化版），CLI 会原样输出给 AI agent */
export const GROWTH_SIMULATION_RESULT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['branches'],
  properties: {
    branches: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'summary', 'events'],
        properties: {
          id: { type: 'string', description: '分支 id，受控模式下等于候选项 id' },
          candidateId: { type: 'string', description: '对应的候选项 id（自由模式可省略）' },
          title: { type: 'string' },
          summary: { type: 'string', description: '叙事化的成长概述（2~4 句）' },
          events: {
            type: 'array',
            items: {
              type: 'object',
              required: ['type'],
              properties: {
                type: {
                  enum: ['exp', 'level', 'attribute', 'skill', 'skill-exp', 'choice', 'note'],
                },
                chapter: { type: 'integer' },
                target: { type: 'string', description: '属性 key / 技能 id / 选择组 id' },
                value: { type: 'string', description: 'choice 事件的选项 id' },
                delta: { type: 'number' },
                note: { type: 'string', description: '剧情原因' },
              },
            },
          },
          risks: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    recommendation: { type: 'string', description: '推荐的分支 id' },
    overallRisks: { type: 'array', items: { type: 'string' } },
  },
};

/** 把用户给出的候选项解析为规则中的选择项 / 技能 */
export function resolveSimulationCandidates(
  ruleset: GrowthRuleset,
  refs: Array<string | SimulationCandidate>
): SimulationCandidate[] {
  const result: SimulationCandidate[] = [];
  refs.forEach((ref, index) => {
    if (typeof ref !== 'string') {
      result.push(ref);
      return;
    }
    const text = ref.trim();
    if (!text) return;
    const found = findOptionAnywhere(ruleset, text);
    if (found) {
      result.push({
        id: found.option.id,
        label: `${found.group.name} → ${found.option.name}`,
        ...(found.option.description ? { description: found.option.description } : {}),
        groupId: found.group.id,
        optionId: found.option.id,
      });
      return;
    }
    const skill = findSkillDef(ruleset, text);
    if (skill) {
      result.push({
        id: skill.id,
        label: `主修技能「${skill.name}」`,
        ...(skill.description ? { description: skill.description } : {}),
        skillId: skill.id,
      });
      return;
    }
    result.push({ id: `option-${index + 1}`, label: text });
  });
  // id 去重
  const seen = new Set<string>();
  return result.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
}

function describeRuleset(ruleset: GrowthRuleset, sheet: GrowthSheet): string {
  const lines: string[] = [`规则集: ${ruleset.name}`];
  if (ruleset.description) lines.push(ruleset.description);
  lines.push(`等级上限 ${ruleset.levels.maxLevel}`);
  const upcoming: string[] = [];
  for (
    let level = sheet.level;
    level < Math.min(sheet.level + 5, ruleset.levels.maxLevel);
    level += 1
  ) {
    upcoming.push(`${level}→${level + 1}: ${expForNextLevel(ruleset, level)}`);
  }
  if (upcoming.length) lines.push(`升级所需经验: ${upcoming.join('，')}`);
  if (ruleset.attributes.length) {
    lines.push('属性（key 名称 范围 每级成长/每级上限）:');
    for (const attr of ruleset.attributes) {
      lines.push(
        `- ${attr.key} ${attr.name} ${attr.min}~${attr.max} 成长${attr.growthPerLevel}/上限${attr.perLevelCap}`
      );
    }
  }
  if (ruleset.skills.length) {
    lines.push('技能（id 名称 最高等级 每级技能经验 前置 互斥组）:');
    for (const skill of ruleset.skills) {
      const pre = skill.prerequisites;
      const preText = [
        pre?.characterLevel ? `角色${pre.characterLevel}级` : '',
        ...Object.entries(pre?.skills ?? {}).map(([id, lv]) => `${id}≥${lv}`),
        ...Object.entries(pre?.attributes ?? {}).map(([key, v]) => `${key}≥${v}`),
      ]
        .filter(Boolean)
        .join('、');
      lines.push(
        `- ${skill.id} ${skill.name} 最高${skill.maxLevel} 消耗[${skill.costPerLevel.join(',')}]` +
          `${preText ? ` 前置:${preText}` : ''}${skill.exclusiveGroup ? ` 互斥组:${skill.exclusiveGroup}` : ''}`
      );
    }
  }
  if (ruleset.choiceGroups.length) {
    lines.push('能力抉择:');
    for (const group of ruleset.choiceGroups) {
      lines.push(
        `- ${group.id} ${group.name}（选 ${group.pick}）: ${group.options
          .map((option) => `${option.id}=${option.name}`)
          .join(' / ')}`
      );
    }
  }
  const limits = ruleset.limits;
  lines.push(
    `战力限制: 每章最多升 ${limits.maxLevelsPerChapter} 级、单属性每章最多 +${limits.maxAttributeGainPerChapter}、单技能每章最多 +${limits.maxSkillLevelsPerChapter} 级`
  );
  return lines.join('\n');
}

function describeSheet(ruleset: GrowthRuleset, sheet: GrowthSheet): string {
  const progress = getLevelProgress(ruleset, sheet);
  const lines = [
    `角色: ${sheet.name}${sheet.aliases.length ? `（别名 ${sheet.aliases.join('、')}）` : ''}`,
    `等级 ${sheet.level}，累计经验 ${sheet.exp}${progress.isMaxLevel ? '（已满级）' : `，距下一级 ${progress.expToNext}`}`,
  ];
  const attrs = Object.entries(sheet.attributes).map(
    ([key, value]) => `${findAttributeDef(ruleset, key)?.name ?? key}(${key})=${value}`
  );
  if (attrs.length) lines.push(`属性: ${attrs.join('，')}`);
  const skills = sheet.skills.map((entry) => {
    const info = getSkillProgress(ruleset, entry);
    return `${info.name}(${info.id}) ${info.level}/${info.maxLevel}`;
  });
  lines.push(`技能: ${skills.length ? skills.join('，') : '无'}`);
  if (sheet.choices.length) {
    lines.push(`已做抉择: ${sheet.choices.map((c) => `${c.groupId}=${c.optionId}`).join('，')}`);
  }
  if (sheet.notes.length) lines.push(`状态: ${sheet.notes.join('；')}`);
  const recent = sheet.events.slice(-8).map((event) => {
    const where = event.chapter !== undefined ? `第${event.chapter}章 ` : '';
    return `- ${where}${event.type} ${event.target ?? ''}${event.value ? `=${event.value}` : ''} ${event.delta ?? ''} ${event.note ?? ''}`.trim();
  });
  if (recent.length) lines.push('最近成长记录:', ...recent);
  return lines.join('\n');
}

/** 构造推演 prompt（要求 AI 只返回严格 JSON） */
export function buildGrowthSimulationPrompt(input: BuildSimulationInput): GrowthSimulationPrompt {
  const { ruleset, sheet, mode } = input;
  const horizon = Math.max(1, Math.min(200, Math.floor(input.horizon || 10)));
  const candidates = resolveSimulationCandidates(ruleset, input.candidateChoices);
  const startChapter = (input.currentChapter ?? latestChapterOfSheet(sheet)) + 1;
  const endChapter = startChapter + horizon - 1;
  const rules = [
    ...ruleset.coreRules
      .filter(
        (rule) =>
          !rule.appliesTo?.length ||
          rule.appliesTo.includes(sheet.name) ||
          rule.appliesTo.some((name) => sheet.aliases.includes(name))
      )
      .map((rule) => rule.text),
    ...(input.coreRules ?? []).map((text) => text.trim()).filter(Boolean),
  ];

  const modeText =
    mode === 'controlled'
      ? '【受控成长】严格遵守下列核心规则与战力限制；每个候选项各推演一个分支，分支 id 必须等于候选项 id。'
      : '【自由成长】在规则允许的范围内让角色自然成长，可以自行设计 2~3 个有差异的分支；核心规则依然不可违背。';
  const candidateText = candidates.length
    ? candidates
        .map(
          (item) =>
            `- id=${item.id}: ${item.label}${item.description ? `（${item.description}）` : ''}`
        )
        .join('\n')
    : '（作者未指定候选项，请自行提出 2~3 个合理的成长方向）';

  const prompt = [
    modeText,
    '',
    '## 规则之书',
    describeRuleset(ruleset, sheet),
    '',
    '## 核心规则（不可违背）',
    rules.length ? rules.map((text, i) => `${i + 1}. ${text}`).join('\n') : '（无）',
    '',
    '## 角色当前状态',
    describeSheet(ruleset, sheet),
    '',
    `## 推演范围: 第 ${startChapter} 章 ~ 第 ${endChapter} 章（共 ${horizon} 章）`,
    '',
    '## 候选项',
    candidateText,
    '',
    '## 输出要求',
    '只输出一个 JSON 对象，不要输出任何解释或 Markdown。结构如下：',
    JSON.stringify(
      {
        branches: [
          {
            id: candidates[0]?.id ?? 'a',
            candidateId: candidates[0]?.id ?? 'a',
            title: '分支标题',
            summary: '这一分支下角色的成长叙事概述',
            events: [
              { chapter: startChapter, type: 'exp', delta: 300, note: '剧情原因' },
              { chapter: startChapter + 1, type: 'attribute', target: 'str', delta: 1, note: '' },
              { chapter: startChapter + 2, type: 'skill', target: 'skill-id', delta: 1, note: '' },
            ],
            risks: ['可能导致的战力崩溃或剧情风险'],
          },
        ],
        recommendation: candidates[0]?.id ?? 'a',
        overallRisks: ['整体风险'],
      },
      null,
      2
    ),
    '',
    '事件 type 只能是 exp / level / attribute / skill / skill-exp / choice / note；',
    'attribute 的 target 用属性 key，skill / skill-exp 的 target 用技能 id，choice 的 target 为选择组 id、value 为选项 id；',
    `chapter 必须在 ${startChapter}~${endChapter} 之间；经验与属性的增长要符合每章上限，不要一次性暴涨。`,
  ].join('\n');

  return {
    systemPrompt:
      '你是严谨的小说成长体系设计师，熟悉 TRPG/网文的数值平衡。你只输出符合要求的 JSON，不输出其他内容。',
    prompt,
    candidates,
    mode,
    horizon,
    startChapter,
    schema: GROWTH_SIMULATION_RESULT_SCHEMA,
  };
}
