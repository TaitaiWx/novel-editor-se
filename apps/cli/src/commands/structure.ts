/**
 * 正文结构规则：ne structure list|test|add|remove|preset
 *
 * 章 / 幕 / 场的识别规则（中文 / English / 数字序号预设 + 自定义正则），与 GUI「设置 → 正文结构」读写同一份配置：
 * `ne init` 项目写在 `.novel-editor/config.json` 的 `structure` 字段，普通文件夹写在
 * `.novel-editor/structure.json`（core structure-config）。ne lint / ne stats 也按这份规则识别结构行。
 */
import {
  compileStructureRules,
  findStructureConfigRoot,
  matchStructureLine,
  nextCustomRuleId,
  readStructureConfig,
  STRUCTURE_LINE_KINDS,
  STRUCTURE_PRESET_IDS,
  STRUCTURE_PRESET_INFO,
  validateCustomStructureRule,
  writeStructureConfig,
  type StructureConfig,
  type StructureConfigReadResult,
  type StructurePresetId,
  type StructureRuleSet,
} from '@novel-editor/core';
import { CliError } from '../errors';
import { displayPath, renderTable } from '../output';
import type { CliContext, CommandSpec } from '../types';
import { bool, list, requireStr, str } from './util';

const KIND_LABELS: Record<string, string> = { chapter: '章', act: '幕', scene: '场' };

/** 结构配置所在的目录：当前项目根 → 向上找到的已保存配置的文件夹 → 当前目录 */
export async function resolveStructureRoot(ctx: CliContext): Promise<string> {
  const project = await ctx.getProject();
  if (project) return project.root;
  return (await findStructureConfigRoot(ctx.cwd)) ?? ctx.cwd;
}

/** 当前目录适用的结构规则（ne lint / ne stats 使用）；读取失败时退回默认规则 */
export async function loadStructureRules(ctx: CliContext): Promise<StructureRuleSet> {
  const root = await resolveStructureRoot(ctx);
  const result = await readStructureConfig(root).catch(() => null);
  for (const warning of result?.warnings ?? []) ctx.logger.warn(`正文结构配置：${warning}`);
  return compileStructureRules(result?.config);
}

function describeConfig(result: StructureConfigReadResult, ctx: CliContext) {
  return {
    root: result.location.root,
    file: result.location.file,
    location: result.location.kind,
    stored: result.stored,
    presets: STRUCTURE_PRESET_IDS.map((id) => ({
      id,
      enabled: result.config.presets.includes(id),
      label: STRUCTURE_PRESET_INFO[id].label,
      description: STRUCTURE_PRESET_INFO[id].description,
      examples: STRUCTURE_PRESET_INFO[id].examples,
    })),
    custom: result.config.custom,
    warnings: result.warnings,
    display: displayPath(result.location.file, ctx.cwd),
  };
}

function renderConfig(data: ReturnType<typeof describeConfig>): string {
  const lines = [
    `配置：${data.display}${data.stored ? '' : '（未保存，使用默认规则）'}`,
    '',
    '预设:',
    ...data.presets.map(
      (preset) =>
        `  [${preset.enabled ? 'x' : ' '}] ${preset.id.padEnd(9)}${preset.label} — ${preset.examples.join(' / ')}`
    ),
    '',
  ];
  if (data.custom.length === 0) {
    lines.push('自定义规则: 无（ne structure add --kind scene --pattern "^=== (.+) ===$"）');
  } else {
    lines.push(
      '自定义规则:',
      renderTable(
        ['id', '类型', '正则', '标志'],
        data.custom.map((rule) => [rule.id, KIND_LABELS[rule.kind], rule.pattern, rule.flags ?? ''])
      )
    );
  }
  for (const warning of data.warnings) lines.push(`警告: ${warning}`);
  return lines.join('\n');
}

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function assertPresets(ids: string[]): StructurePresetId[] {
  for (const id of ids) {
    if (!(STRUCTURE_PRESET_IDS as readonly string[]).includes(id)) {
      throw new CliError(
        'INVALID_ARGUMENT',
        `未知的预设：${id}`,
        `可选：${STRUCTURE_PRESET_IDS.join(', ')}`
      );
    }
  }
  return ids as StructurePresetId[];
}

async function save(ctx: CliContext, root: string, config: StructureConfig) {
  const result = await writeStructureConfig(root, config);
  const data = describeConfig(result, ctx);
  return { data, text: renderConfig(data) };
}

export const structureCommands: CommandSpec[] = [
  {
    path: ['structure', 'list'],
    summary: '查看正文结构规则（预设开关与自定义规则）',
    examples: ['ne structure list', 'ne structure list --json'],
    async run(ctx) {
      const result = await readStructureConfig(await resolveStructureRoot(ctx));
      const data = describeConfig(result, ctx);
      return { data, text: renderConfig(data) };
    },
  },
  {
    path: ['structure', 'test'],
    summary: '测试哪些行会被识别为 章 / 幕 / 场',
    positionals: [{ name: 'lines', description: '要测试的行（每个参数一行）', variadic: true }],
    options: [{ name: 'stdin', type: 'boolean', description: '从标准输入读取（每行一条）' }],
    examples: [
      'ne structure test "Chapter 1: The Harbor" "Act II" "Scene 3"',
      'cat 001-开端.md | ne structure test --stdin --json',
    ],
    async run(ctx, args) {
      const lines = [...list(args, 'lines')];
      if (bool(args, 'stdin')) lines.push(...(await ctx.readStdin()).split(/\r?\n/));
      const input = lines.filter((line) => line.trim());
      if (input.length === 0) throw new CliError('USAGE', '请提供要测试的行（参数或 --stdin）');
      const rules = await loadStructureRules(ctx);
      const results = input.map((line) => {
        const match = matchStructureLine(line, rules);
        return { line, kind: match?.kind ?? null, rule: match?.ruleId ?? null };
      });
      const text = results
        .map((item) =>
          item.kind ? `${KIND_LABELS[item.kind]}  ${item.line}  (${item.rule})` : `-   ${item.line}`
        )
        .join('\n');
      return { data: { results }, text };
    },
  },
  {
    path: ['structure', 'add'],
    summary: '添加自定义规则（正则，匹配整行去掉首尾空白后的文字）',
    options: [
      {
        name: 'kind',
        type: 'string',
        choices: STRUCTURE_LINE_KINDS,
        description: '识别为 chapter（章）/ act（幕）/ scene（场）',
      },
      { name: 'pattern', type: 'string', valueName: 'regex', description: '正则（不含两侧的 /）' },
      { name: 'ignore-case', short: 'i', type: 'boolean', description: '不区分大小写' },
      { name: 'id', type: 'string', description: '规则 id（默认 custom-N）' },
    ],
    examples: [
      'ne structure add --kind scene --pattern "^=== (.+) ===$"',
      'ne structure add --kind chapter --pattern "^Episode \\d+" -i',
    ],
    async run(ctx, args) {
      const kind = requireStr(args, 'kind');
      const pattern = requireStr(args, 'pattern');
      const root = await resolveStructureRoot(ctx);
      const current = await readStructureConfig(root);
      const id = str(args, 'id') ?? nextCustomRuleId(current.config.custom);
      if (current.config.custom.some((rule) => rule.id === id)) {
        throw new CliError('ALREADY_EXISTS', `规则 id 已存在：${id}`);
      }
      const validation = validateCustomStructureRule({
        id,
        kind,
        pattern,
        ...(bool(args, 'ignore-case') ? { flags: 'i' } : {}),
      });
      if (!validation.ok) throw new CliError('INVALID_ARGUMENT', validation.error);
      return save(ctx, root, {
        presets: current.config.presets,
        custom: [...current.config.custom, validation.rule],
      });
    },
  },
  {
    path: ['structure', 'remove'],
    summary: '删除自定义规则',
    positionals: [{ name: 'id', description: '规则 id（ne structure list 查看）', required: true }],
    examples: ['ne structure remove custom-1'],
    async run(ctx, args) {
      const id = requireStr(args, 'id');
      const root = await resolveStructureRoot(ctx);
      const current = await readStructureConfig(root);
      if (!current.config.custom.some((rule) => rule.id === id)) {
        throw new CliError('NOT_FOUND', `没有这条自定义规则：${id}`);
      }
      return save(ctx, root, {
        presets: current.config.presets,
        custom: current.config.custom.filter((rule) => rule.id !== id),
      });
    },
  },
  {
    path: ['structure', 'preset'],
    summary: '开启 / 关闭预设（zh 中文、en English、numbered 数字序号）',
    options: [
      { name: 'enable', type: 'string', valueName: 'a,b', description: '开启的预设' },
      { name: 'disable', type: 'string', valueName: 'a,b', description: '关闭的预设' },
    ],
    examples: [
      'ne structure preset --enable en',
      'ne structure preset --enable numbered --disable en',
    ],
    async run(ctx, args) {
      const enable = assertPresets(splitList(str(args, 'enable')));
      const disable = assertPresets(splitList(str(args, 'disable')));
      if (enable.length === 0 && disable.length === 0) {
        throw new CliError('USAGE', '请用 --enable / --disable 指定预设', '例如 --enable en');
      }
      const both = enable.find((id) => disable.includes(id));
      if (both) throw new CliError('USAGE', `不能同时开启和关闭 ${both}`);
      const root = await resolveStructureRoot(ctx);
      const current = await readStructureConfig(root);
      const presets = STRUCTURE_PRESET_IDS.filter(
        (id) =>
          (current.config.presets.includes(id) || enable.includes(id)) && !disable.includes(id)
      );
      return save(ctx, root, { presets, custom: current.config.custom });
    },
  },
];

/** 供测试 / 其他命令使用：一个文件里各类结构行的数量 */
export function countStructureLines(
  text: string,
  rules: StructureRuleSet
): { chapters: number; acts: number; scenes: number } {
  const counts = { chapters: 0, acts: 0, scenes: 0 };
  for (const line of text.split(/\r?\n/)) {
    const match = matchStructureLine(line, rules);
    if (match?.kind === 'chapter') counts.chapters += 1;
    else if (match?.kind === 'act') counts.acts += 1;
    else if (match?.kind === 'scene') counts.scenes += 1;
  }
  return counts;
}
