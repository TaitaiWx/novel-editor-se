/**
 * ne growth 命令共用工具：定位记忆库、渲染角色卡
 */
import {
  findAttributeDef,
  findChoiceGroup,
  findSheet,
  getLevelProgress,
  getSkillProgress,
  loadMemory,
  type GrowthRuleset,
  type GrowthSheet,
  type GrowthWarning,
  type LoadedMemory,
} from '@novel-editor/core';
import { CliError } from '../errors';
import { renderTable } from '../output';
import type { CliContext, OptionSpec, ParsedCommandArgs } from '../types';
import { num, str } from './util';

/** 记忆库所在根目录：优先使用 ne 项目根，否则使用当前目录（兼容 GUI 直接打开的文件夹） */
export async function memoryRoot(ctx: CliContext): Promise<string> {
  return (await ctx.getProject())?.root ?? ctx.cwd;
}

/** 加载已初始化的记忆库 */
export async function requireMemory(
  ctx: CliContext
): Promise<{ root: string; memory: LoadedMemory }> {
  const root = await memoryRoot(ctx);
  const memory = await loadMemory(root);
  if (!memory.initialized) {
    throw new CliError('NOT_FOUND', `记忆库未初始化: ${memory.dir}`, '先运行 `ne growth init`');
  }
  for (const issue of memory.issues) ctx.logger.warn(`已跳过损坏的角色卡 ${issue}`);
  return { root, memory };
}

export function requireSheet(memory: LoadedMemory, name: string): GrowthSheet {
  const sheet = findSheet(memory.sheets, name);
  if (!sheet) {
    throw new CliError(
      'NOT_FOUND',
      `没有角色「${name}」的成长卡`,
      `已有角色: ${memory.sheets.map((item) => item.name).join(', ') || '（无）'}；记录经验等操作会自动创建`
    );
  }
  return sheet;
}

export const CHAPTER_OPTION: OptionSpec = {
  name: 'chapter',
  short: 'c',
  type: 'number',
  valueName: 'n',
  description: '发生在第几章（用于战力暴涨检查与配角提醒）',
};
export const NOTE_OPTION: OptionSpec = {
  name: 'note',
  type: 'string',
  valueName: 'text',
  description: '剧情原因 / 备注',
};
export const FORCE_OPTION: OptionSpec = {
  name: 'force',
  type: 'boolean',
  description: '违反规则时仍然写入（记为警告），由作者负责',
};

export function chapterOf(args: ParsedCommandArgs): number | undefined {
  const chapter = num(args, 'chapter');
  if (chapter === undefined) return undefined;
  if (!Number.isInteger(chapter) || chapter < 0) {
    throw new CliError('INVALID_ARGUMENT', `章节号必须是非负整数: ${chapter}`);
  }
  return chapter;
}

/** 解析数字位置参数（允许 +100 / -3） */
export function parseNumberArg(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (value === undefined || value.trim() === '' || !Number.isFinite(parsed)) {
    throw new CliError('INVALID_ARGUMENT', `${name} 必须是数字，收到: ${value ?? ''}`);
  }
  return parsed;
}

export function noteOf(args: ParsedCommandArgs): string | undefined {
  return str(args, 'note');
}

function bar(ratio: number, width = 20): string {
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * width);
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`;
}

/** 人类可读的角色卡 */
export function renderSheetText(ruleset: GrowthRuleset, sheet: GrowthSheet): string {
  const progress = getLevelProgress(ruleset, sheet);
  const lines = [
    `${sheet.name}${sheet.aliases.length ? `（${sheet.aliases.join('、')}）` : ''}`,
    `等级 ${sheet.level}/${progress.maxLevel}  经验 ${sheet.exp}  ${bar(progress.ratio)} ${
      progress.isMaxLevel ? '已满级' : `距下一级 ${progress.expToNext} 经验`
    }`,
  ];
  const attrs = Object.entries(sheet.attributes);
  if (attrs.length) {
    lines.push(
      '',
      renderTable(
        ['属性', '数值'],
        attrs.map(([key, value]) => [findAttributeDef(ruleset, key)?.name ?? key, value])
      )
    );
  }
  if (sheet.skills.length) {
    lines.push(
      '',
      renderTable(
        ['技能', '等级', '下一级需要'],
        sheet.skills.map((entry) => {
          const info = getSkillProgress(ruleset, entry);
          return [
            `${info.name}${info.known ? '' : '（未定义）'}`,
            `${info.level}/${info.maxLevel}`,
            info.expToNext === null ? '已满级' : `${info.expToNext} 技能经验`,
          ];
        })
      )
    );
  }
  if (sheet.choices.length) {
    lines.push('', '抉择:');
    for (const choice of sheet.choices) {
      const group = findChoiceGroup(ruleset, choice.groupId);
      const option = group?.options.find((item) => item.id === choice.optionId);
      lines.push(
        `  ${group?.name ?? choice.groupId} → ${option?.name ?? choice.optionId}${
          choice.chapter !== undefined ? `（第 ${choice.chapter} 章）` : ''
        }`
      );
    }
  }
  if (sheet.notes.length) lines.push('', `状态: ${sheet.notes.join('；')}`);
  const recent = sheet.events.slice(-5);
  if (recent.length) {
    lines.push('', '最近记录:');
    for (const event of recent) {
      lines.push(
        `  ${event.chapter !== undefined ? `第${event.chapter}章 ` : ''}${event.type} ${
          event.target ?? ''
        }${event.value ? `=${event.value}` : ''} ${event.delta ?? ''}${
          event.note ? ` — ${event.note}` : ''
        }`.trimEnd()
      );
    }
  }
  return lines.join('\n');
}

export function renderWarnings(warnings: GrowthWarning[]): string {
  if (warnings.length === 0) return '';
  const icon = { error: '✗', warning: '!', info: 'i' } as const;
  return warnings
    .map(
      (warning) =>
        `${icon[warning.severity]} ${warning.character ? `${warning.character}: ` : ''}${
          warning.message
        }${warning.hint ? `\n    提示: ${warning.hint}` : ''}`
    )
    .join('\n');
}
