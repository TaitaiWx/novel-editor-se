/**
 * 成长档案界面文案与小工具（纯函数，便于单测）
 */
import {
  findAttributeDef,
  type GrowthEvent,
  type PartyBook,
  latestChapterOfSheet,
  type GrowthEventInput,
  type GrowthRuleset,
  type GrowthSheet,
  type GrowthWarning,
} from '@novel-editor/core/growth';
import type { ForgottenCompanion } from '../../../types/growth-api';

function signed(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

function skillName(ruleset: GrowthRuleset, id: string | undefined): string {
  return ruleset.skills.find((skill) => skill.id === id)?.name ?? id ?? '技能';
}

/**
 * 记一笔成功后的提示，例如「白芷 获得 300 经验，升到 Lv.2」
 */
export function describeRecordResult(input: {
  name: string;
  ruleset: GrowthRuleset;
  event: GrowthEventInput;
  before: GrowthSheet | null;
  after: GrowthSheet | null;
  levelUps: number;
}): string {
  const { name, ruleset, event, before, after, levelUps } = input;
  const delta = event.delta ?? 0;
  let text: string;
  switch (event.type) {
    case 'exp':
      text = delta >= 0 ? `${name} 获得 ${delta} 经验` : `${name} 失去 ${-delta} 经验`;
      break;
    case 'attribute':
      text = `${name} 的${findAttributeDef(ruleset, event.target ?? '')?.name ?? event.target} ${signed(delta)}`;
      break;
    case 'skill': {
      const known = before?.skills.some((skill) => skill.id === event.target && skill.level > 0);
      const level = after?.skills.find((skill) => skill.id === event.target)?.level;
      const skill = skillName(ruleset, event.target);
      text = known ? `${name} 的「${skill}」升到 Lv.${level ?? '?'}` : `${name} 学会了「${skill}」`;
      break;
    }
    case 'skill-exp':
      text = `${name} 的「${skillName(ruleset, event.target)}」技能经验 ${signed(delta)}`;
      break;
    case 'level':
      text = `${name} 等级 ${signed(delta)}`;
      break;
    case 'choice': {
      const group = ruleset.choiceGroups.find((item) => item.id === event.target);
      const option = group?.options.find((item) => item.id === event.value);
      text = `${name} 选择了「${option?.name ?? event.value}」`;
      break;
    }
    default:
      text = `已为 ${name} 记下一笔`;
  }
  if (levelUps > 0 && after && event.type !== 'level') text += `，升到 Lv.${after.level}`;
  return text;
}

/** 与 core/storage 的 toMemoryFileName 保持一致（渲染进程不能引入 node 模块） */
export function toSheetFileName(name: string): string {
  return (
    name
      .trim()
      // eslint-disable-next-line no-control-regex
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/^\.+/, '_')
      .slice(0, 120)
  );
}

/** 记忆库目录下某个角色的成长卡文件（json / md） */
export function sheetFilePaths(memoryDir: string, name: string): string[] {
  const sep = memoryDir.includes('\\') && !memoryDir.includes('/') ? '\\' : '/';
  const base = `${memoryDir.replace(/[\\/]+$/, '')}${sep}角色${sep}${toSheetFileName(name)}`;
  return [`${base}.json`, `${base}.md`];
}

/** 「记一笔」默认章节：当前打开的章节，其次是该角色最近记录的章节 */
export function defaultRecordChapter(
  currentChapter: number | null | undefined,
  sheet: GrowthSheet | null
): number | undefined {
  if (currentChapter && currentChapter > 0) return currentChapter;
  const latest = sheet ? latestChapterOfSheet(sheet) : 0;
  return latest > 0 ? latest : undefined;
}

export interface GrowthAttention {
  errors: number;
  warnings: number;
  forgotten: number;
  total: number;
}

/** 需要作者留意的事项数（info 级提示不计入，避免横幅常驻） */
export function countAttention(
  warnings: GrowthWarning[],
  forgotten: ForgottenCompanion[]
): GrowthAttention {
  const errors = warnings.filter((warning) => warning.severity === 'error').length;
  const warningCount = warnings.filter((warning) => warning.severity === 'warning').length;
  return {
    errors,
    warnings: warningCount,
    forgotten: forgotten.length,
    total: errors + warningCount + forgotten.length,
  };
}

/** 与某个角色相关的「被遗忘的配角」：本人，或曾和他同队的配角 */
export function relevantForgotten(
  forgotten: ForgottenCompanion[],
  party: PartyBook,
  name: string
): ForgottenCompanion[] {
  const myParties = new Set(
    party.parties.filter((item) => item.members.includes(name)).map((item) => item.name)
  );
  return forgotten.filter(
    (item) => item.name === name || item.parties.some((partyName) => myParties.has(partyName))
  );
}

export interface ChapterGroup {
  /** null 表示未关联章节 */
  chapter: number | null;
  events: GrowthEvent[];
}

/** 时间线：最新在上，按章节分组（同一章的多笔记录归在一起，保持写入顺序的倒序） */
export function groupEventsByChapter(events: GrowthEvent[]): ChapterGroup[] {
  const groups: ChapterGroup[] = [];
  for (const event of [...events].reverse()) {
    const chapter = event.chapter ?? null;
    const last = groups[groups.length - 1];
    if (last && last.chapter === chapter) last.events.push(event);
    else groups.push({ chapter, events: [event] });
  }
  return groups;
}
