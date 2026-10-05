/**
 * 记忆库的可读 Markdown 视图（由 JSON 派生，每次保存时重新生成）
 */
import { checkMemory } from './consistency';
import { findAttributeDef, findChoiceGroup, getLevelProgress, getSkillProgress } from './engine';
import { footprintsOf, partiesOf } from './party-map';
import type { GrowthEventInput, GrowthRuleset, GrowthSheet, MemoryBundle } from './types';

const DERIVED_NOTICE =
  '> 本文件由 Novel Editor 根据 JSON 自动生成，请勿手动修改（修改会在下次保存时被覆盖）。';

/** 单条成长事件的中文描述（GUI 时间线与 Markdown 共用） */
export function describeGrowthEvent(ruleset: GrowthRuleset, event: GrowthEventInput): string {
  const delta =
    event.delta !== undefined ? (event.delta >= 0 ? `+${event.delta}` : `${event.delta}`) : '';
  switch (event.type) {
    case 'exp':
      return `经验 ${delta}`;
    case 'level':
      return `等级 ${delta}`;
    case 'attribute':
      return `${findAttributeDef(ruleset, event.target ?? '')?.name ?? event.target} ${delta}`;
    case 'skill':
      return `技能「${ruleset.skills.find((s) => s.id === event.target)?.name ?? event.target}」${delta} 级`;
    case 'skill-exp':
      return `技能经验「${ruleset.skills.find((s) => s.id === event.target)?.name ?? event.target}」${delta}`;
    case 'choice': {
      const group = findChoiceGroup(ruleset, event.target ?? '');
      const option = group?.options.find((item) => item.id === event.value);
      return `抉择「${group?.name ?? event.target}」→ ${option?.name ?? event.value}`;
    }
    default:
      return '备注';
  }
}

export function renderSheetMarkdown(
  ruleset: GrowthRuleset,
  sheet: GrowthSheet,
  bundle?: Pick<MemoryBundle, 'party' | 'atlas'>
): string {
  const progress = getLevelProgress(ruleset, sheet);
  const lines = [
    `# ${sheet.name}`,
    '',
    DERIVED_NOTICE,
    '',
    sheet.aliases.length ? `别名：${sheet.aliases.join('、')}` : '',
    `等级：**${sheet.level}** / ${progress.maxLevel}，累计经验：${sheet.exp}，${
      progress.isMaxLevel ? '已满级' : `距下一级：${progress.expToNext}`
    }`,
    '',
    '## 属性',
    '',
  ];
  if (Object.keys(sheet.attributes).length === 0) lines.push('（无）');
  else {
    lines.push('| 属性 | 数值 |', '| --- | --- |');
    for (const [key, value] of Object.entries(sheet.attributes)) {
      lines.push(`| ${findAttributeDef(ruleset, key)?.name ?? key} | ${value} |`);
    }
  }
  lines.push('', '## 技能', '');
  if (sheet.skills.length === 0) lines.push('（无）');
  else {
    lines.push('| 技能 | 等级 | 下一级需要 |', '| --- | --- | --- |');
    for (const entry of sheet.skills) {
      const info = getSkillProgress(ruleset, entry);
      lines.push(
        `| ${info.name} | ${info.level}/${info.maxLevel} | ${
          info.expToNext === null ? '已满级' : `${info.expToNext} 技能经验`
        } |`
      );
    }
  }
  if (sheet.choices.length) {
    lines.push('', '## 抉择', '');
    for (const choice of sheet.choices) {
      const group = findChoiceGroup(ruleset, choice.groupId);
      const option = group?.options.find((item) => item.id === choice.optionId);
      lines.push(
        `- ${group?.name ?? choice.groupId} → ${option?.name ?? choice.optionId}${
          choice.chapter !== undefined ? `（第 ${choice.chapter} 章）` : ''
        }`
      );
    }
  }
  if (sheet.notes.length)
    lines.push('', '## 状态备注', '', ...sheet.notes.map((note) => `- ${note}`));
  if (bundle) {
    const parties = partiesOf(bundle.party, sheet.name);
    if (parties.length) {
      lines.push('', '## 组队经历', '');
      for (const party of parties) {
        lines.push(
          `- ${party.name}：${party.members.join('、')}（${party.fromChapter ?? '?'} ~ ${
            party.toChapter ?? '至今'
          }）`
        );
      }
    }
    const footprints = footprintsOf(bundle.atlas, sheet.name);
    if (footprints.length) {
      lines.push('', '## 足迹', '');
      for (const item of footprints) {
        lines.push(
          `- ${item.chapter !== undefined ? `第 ${item.chapter} 章 ` : ''}${item.location}`
        );
      }
    }
  }
  if (sheet.events.length) {
    lines.push('', '## 成长记录', '');
    for (const event of sheet.events.slice(-100)) {
      const where = event.chapter !== undefined ? `第 ${event.chapter} 章` : '未标章节';
      const level =
        event.levelBefore !== undefined && event.levelAfter !== undefined
          ? `（${event.levelBefore} → ${event.levelAfter} 级）`
          : '';
      lines.push(
        `- ${where}：${describeGrowthEvent(ruleset, event)}${level}${event.note ? ` — ${event.note}` : ''}`
      );
    }
  }
  return `${lines
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
    .join('\n')
    .trim()}\n`;
}

export function renderMemoryReadme(bundle: MemoryBundle): string {
  const check = checkMemory(bundle);
  const lines = [
    '# 记忆库',
    '',
    DERIVED_NOTICE,
    '',
    '长篇连载的设定记忆：角色成长、能力抉择、组队历史、地图足迹与核心规则。',
    'GUI「成长」面板、`ne growth` 命令与 AI agent 都直接读写本目录的 JSON 文件。',
    '',
    '## 目录',
    '',
    '- `规则.json`：属性、等级经验曲线、技能、二选一/三选一、核心规则、战力限制',
    '- `角色/<角色名>.json`：成长卡（等级、经验、属性、技能、抉择、事件日志），同名 `.md` 为可读摘要',
    '- `队伍.json`：曾经组过的队伍、配角最近出场章节',
    '- `地图.json`：地点与到访记录',
    '- `角色卡/`、`设定/`：从编辑器数据库同步的人物卡与设定快照（只读）',
    '',
    `## 规则：${bundle.ruleset.name}`,
    '',
    `等级上限 ${bundle.ruleset.levels.maxLevel}，属性 ${bundle.ruleset.attributes.length} 项，技能 ${bundle.ruleset.skills.length} 个，抉择 ${bundle.ruleset.choiceGroups.length} 组。`,
  ];
  if (bundle.ruleset.coreRules.length) {
    lines.push('', '### 核心规则', '', ...bundle.ruleset.coreRules.map((rule) => `- ${rule.text}`));
  }
  lines.push('', '## 角色', '');
  if (bundle.sheets.length === 0) lines.push('（还没有角色成长卡）');
  for (const sheet of bundle.sheets) {
    lines.push(
      `- [${sheet.name}](角色/${encodeURIComponent(sheet.name)}.md)：${sheet.level} 级，${sheet.skills.length} 个技能`
    );
  }
  if (check.forgotten.length) {
    lines.push('', '## 被遗忘的配角', '');
    for (const item of check.forgotten) {
      lines.push(
        `- ${item.name}：最近出场第 ${item.lastSeenChapter} 章，已 ${item.chaptersAbsent} 章未出场`
      );
    }
  }
  if (check.warnings.length) {
    lines.push('', '## 一致性提醒', '');
    for (const warning of check.warnings.slice(0, 50)) {
      lines.push(
        `- [${warning.severity}] ${warning.character ? `${warning.character}：` : ''}${warning.message}`
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

// ─── 数据库快照 ─────────────────────────────────────────────────────────────

export interface CharacterSnapshotInput {
  name: string;
  role?: string;
  description?: string;
  aliases?: string[];
  /** 当前状态（例如 位置/伤势/装备），label → value */
  currentState?: Array<{ label: string; value: string }>;
}

export interface SettingSnapshotInput {
  title: string;
  category?: string;
  content?: string;
  tags?: string[];
}

const SNAPSHOT_NOTICE =
  '> 从编辑器数据库同步的只读快照，修改请在编辑器「角色 / 设定」中进行，下次同步会覆盖本文件。';

export function renderCharacterSnapshot(input: CharacterSnapshotInput): string {
  const lines = [`# ${input.name}`, '', SNAPSHOT_NOTICE, ''];
  if (input.role) lines.push(`定位：${input.role}`);
  if (input.aliases?.length) lines.push(`别名：${input.aliases.join('、')}`);
  if (input.description) lines.push('', '## 简介', '', input.description);
  if (input.currentState?.length) {
    lines.push('', '## 当前状态', '');
    for (const item of input.currentState) lines.push(`- ${item.label}：${item.value}`);
  }
  return `${lines.join('\n').trim()}\n`;
}

export function renderSettingSnapshot(input: SettingSnapshotInput): string {
  const lines = [`# ${input.title}`, '', SNAPSHOT_NOTICE, ''];
  if (input.category) lines.push(`分类：${input.category}`);
  if (input.tags?.length) lines.push(`标签：${input.tags.join('、')}`);
  if (input.content) lines.push('', input.content);
  return `${lines.join('\n').trim()}\n`;
}
