/**
 * 成长记录器命令（队伍 / 地图 / 检查 / AI 推演）：
 *   ne growth party|map|check|simulate|apply-sim
 *
 * CLI 不保存 AI Key：`growth simulate` 只输出 prompt 与期望的 JSON 结构，
 * 由驱动 CLI 的 AI agent 自行调用模型，再通过 `growth apply-sim` 把选中的分支写回。
 */
import { readFile } from 'node:fs/promises';
import {
  GROWTH_SIMULATION_MODES,
  addLocation,
  addParty,
  applySimulationBranch,
  buildGrowthSimulationPrompt,
  checkMemory,
  detectForgottenCompanions,
  endParty,
  getLevelProgress,
  latestKnownChapter,
  markCompanionSeen,
  parseGrowthSimulationResult,
  recordVisit,
  removeLocation,
  removeParty,
  resolveSimulationCandidates,
  saveAtlas,
  saveParty,
  saveSheet,
  withObservedAppearances,
  type GrowthSimulationMode,
} from '@novel-editor/core';
import { CliError } from '../errors';
import { renderTable } from '../output';
import type { CommandSpec, ParsedCommandArgs } from '../types';
import { renderSheetText, renderWarnings, requireMemory, requireSheet } from './growth-shared';
import { bool, list, num, requireStr, resolvePath, str } from './util';

function optionalChapter(args: ParsedCommandArgs, name: string): number | undefined {
  const value = num(args, name);
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0) {
    throw new CliError('INVALID_ARGUMENT', `--${name} 必须是非负整数`);
  }
  return value;
}

function positionalChapter(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CliError('INVALID_ARGUMENT', `章节号必须是非负整数: ${value}`);
  }
  return parsed;
}

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function expectArgs(items: string[], count: number, usage: string): void {
  if (items.length < count) throw new CliError('USAGE', `参数不足，用法: ${usage}`);
}

const PARTY_ACTIONS = ['list', 'add', 'end', 'seen', 'remove'] as const;
const MAP_ACTIONS = ['list', 'add', 'visit', 'remove'] as const;

export const growthWorldCommands: CommandSpec[] = [
  {
    path: ['growth', 'party'],
    summary: '队伍与配角记录: list | add <队名> | end <队名> | seen <角色> <章> | remove <队名>',
    positionals: [
      { name: 'action', description: PARTY_ACTIONS.join(' | ') },
      { name: 'args', description: '动作参数', variadic: true },
    ],
    options: [
      { name: 'members', short: 'm', type: 'string', valueName: 'a,b', description: '成员（add）' },
      { name: 'from', type: 'number', valueName: 'n', description: '组队章节（add）' },
      { name: 'to', type: 'number', valueName: 'n', description: '解散章节（add / end）' },
      { name: 'note', type: 'string', valueName: 'text', description: '备注' },
      { name: 'important', type: 'boolean', description: '标记为重点配角（seen）' },
    ],
    examples: [
      'ne growth party add 银月小队 --members 阿尔,莉娜,老铁 --from 3',
      'ne growth party end 银月小队 --to 40',
      'ne growth party seen 莉娜 52 --important',
    ],
    async run(ctx, args) {
      const { root, memory } = await requireMemory(ctx, args);
      const action = str(args, 'action') ?? 'list';
      const rest = list(args, 'args');
      let book = memory.party;
      switch (action) {
        case 'list':
          break;
        case 'add':
          expectArgs(rest, 1, 'ne growth party add <队名> --members a,b');
          book = addParty(book, {
            name: rest[0],
            members: [...splitList(str(args, 'members')), ...rest.slice(1)],
            fromChapter: optionalChapter(args, 'from'),
            toChapter: optionalChapter(args, 'to'),
            notes: str(args, 'note'),
          });
          break;
        case 'end': {
          expectArgs(rest, 1, 'ne growth party end <队名> --to <章>');
          const to = optionalChapter(args, 'to') ?? positionalChapter(rest[1]);
          if (to === undefined) throw new CliError('USAGE', '需要解散章节: --to <章>');
          book = endParty(book, rest[0], to);
          break;
        }
        case 'seen':
          expectArgs(rest, 2, 'ne growth party seen <角色> <章>');
          book = markCompanionSeen(book, rest[0], positionalChapter(rest[1]), {
            ...(bool(args, 'important') ? { important: true } : {}),
            ...(str(args, 'note') ? { note: str(args, 'note') } : {}),
          });
          break;
        case 'remove':
          expectArgs(rest, 1, 'ne growth party remove <队名>');
          book = removeParty(book, rest[0]);
          break;
        default:
          throw new CliError(
            'USAGE',
            `未知动作: ${action}`,
            `可用动作: ${PARTY_ACTIONS.join(', ')}`
          );
      }
      if (action !== 'list') book = await saveParty(root, book);
      const current = latestKnownChapter(book, memory.sheets, memory.atlas);
      const forgotten = detectForgottenCompanions(
        withObservedAppearances(book, memory.sheets, memory.atlas),
        current,
        memory.ruleset.limits.forgottenAfterChapters
      );
      const text = [
        book.parties.length
          ? renderTable(
              ['队伍', '成员', '章节', '备注'],
              book.parties.map((party) => [
                party.name,
                party.members.join('、'),
                `${party.fromChapter ?? '?'} ~ ${party.toChapter ?? '至今'}`,
                party.notes ?? '',
              ])
            )
          : '（还没有队伍记录）',
        forgotten.length
          ? `被遗忘的配角（当前第 ${current} 章）:\n${forgotten
              .map(
                (item) =>
                  `  ${item.important ? '★ ' : ''}${item.name}: 第 ${item.lastSeenChapter} 章后已 ${item.chaptersAbsent} 章未出场`
              )
              .join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      return { data: { ...book, currentChapter: current, forgotten }, text };
    },
  },
  {
    path: ['growth', 'map'],
    summary: '地图记录: list | add <地点> | visit <地点> <角色> | remove <地点>',
    positionals: [
      { name: 'action', description: MAP_ACTIONS.join(' | ') },
      { name: 'args', description: '动作参数', variadic: true },
    ],
    options: [
      { name: 'region', type: 'string', valueName: 'name', description: '所属区域（add）' },
      { name: 'parent', type: 'string', valueName: 'name', description: '上级地点（add）' },
      { name: 'description', type: 'string', valueName: 'text', description: '地点描述（add）' },
      { name: 'chapter', short: 'c', type: 'number', valueName: 'n', description: '章节' },
      { name: 'note', type: 'string', valueName: 'text', description: '备注（visit）' },
    ],
    examples: [
      'ne growth map add 霜城 --region 北境 --chapter 12',
      'ne growth map visit 霜城 阿尔 --chapter 15',
    ],
    async run(ctx, args) {
      const { root, memory } = await requireMemory(ctx, args);
      const action = str(args, 'action') ?? 'list';
      const rest = list(args, 'args');
      let atlas = memory.atlas;
      switch (action) {
        case 'list':
          break;
        case 'add':
          expectArgs(rest, 1, 'ne growth map add <地点>');
          atlas = addLocation(atlas, {
            name: rest[0],
            region: str(args, 'region'),
            parent: str(args, 'parent'),
            description: str(args, 'description'),
            firstChapter: optionalChapter(args, 'chapter'),
          });
          break;
        case 'visit':
          expectArgs(rest, 2, 'ne growth map visit <地点> <角色> --chapter <章>');
          atlas = recordVisit(
            atlas,
            rest[0],
            rest[1],
            optionalChapter(args, 'chapter'),
            str(args, 'note')
          );
          break;
        case 'remove':
          expectArgs(rest, 1, 'ne growth map remove <地点>');
          atlas = removeLocation(atlas, rest[0]);
          break;
        default:
          throw new CliError('USAGE', `未知动作: ${action}`, `可用动作: ${MAP_ACTIONS.join(', ')}`);
      }
      if (action !== 'list') atlas = await saveAtlas(root, atlas);
      const text = atlas.locations.length
        ? renderTable(
            ['地点', '区域', '上级', '首次出现', '到访'],
            atlas.locations.map((loc) => [
              loc.name,
              loc.region ?? '',
              loc.parent ?? '',
              loc.firstChapter ?? '',
              loc.visits
                .map(
                  (visit) =>
                    `${visit.character}${visit.chapter !== undefined ? `@${visit.chapter}` : ''}`
                )
                .join(' '),
            ])
          )
        : '（还没有地点记录）';
      return { data: atlas, text };
    },
  },
  {
    path: ['growth', 'check'],
    summary: '战力一致性检查 + 被遗忘的配角提醒',
    options: [
      {
        name: 'chapter',
        short: 'c',
        type: 'number',
        valueName: 'n',
        description: '当前写到第几章（默认取记忆库中最新章节）',
      },
      {
        name: 'after',
        type: 'number',
        valueName: 'n',
        description: '多少章未出场视为被遗忘（默认取规则）',
      },
      {
        name: 'strict',
        type: 'boolean',
        description: '存在 error 级问题时以退出码 1 结束（适合 CI / AI 校验）',
      },
    ],
    async run(ctx, args) {
      const { memory } = await requireMemory(ctx, args);
      const result = checkMemory(memory, {
        currentChapter: optionalChapter(args, 'chapter'),
        forgottenAfter: optionalChapter(args, 'after'),
      });
      if (bool(args, 'strict') && result.summary.errors > 0) {
        throw new CliError(
          'INVALID_ARGUMENT',
          `发现 ${result.summary.errors} 个战力一致性错误`,
          renderWarnings(result.warnings.filter((w) => w.severity === 'error'))
        );
      }
      const lines = [
        `检查完成（当前第 ${result.currentChapter} 章）: ${result.summary.errors} 个错误，${result.summary.warnings} 个警告，${result.summary.forgotten} 位被遗忘的配角`,
      ];
      if (result.warnings.length) lines.push('', renderWarnings(result.warnings));
      if (result.forgotten.length) {
        lines.push('', '被遗忘的配角:');
        for (const item of result.forgotten) {
          lines.push(
            `  ${item.important ? '★ ' : ''}${item.name}: 第 ${item.lastSeenChapter} 章后已 ${item.chaptersAbsent} 章未出场${
              item.parties.length ? `（曾在 ${item.parties.join('、')}）` : ''
            }`
          );
        }
      }
      return { data: result, text: lines.join('\n') };
    },
  },
  {
    path: ['growth', 'simulate'],
    summary: '生成 AI 成长推演 prompt（二选一/三选一、受控/自由成长）',
    description:
      'CLI 不调用 AI：输出 systemPrompt / prompt / schema，由 AI agent 执行后把 JSON 交给 `ne growth apply-sim`。',
    positionals: [{ name: 'character', description: '角色名或别名', required: true }],
    options: [
      {
        name: 'choices',
        type: 'string',
        valueName: 'a,b[,c]',
        description: '候选项：选择项/技能 id 或任意描述',
      },
      {
        name: 'mode',
        type: 'string',
        choices: GROWTH_SIMULATION_MODES,
        default: 'controlled',
        description: 'controlled=严格受控成长，free=自由成长',
      },
      { name: 'horizon', type: 'number', valueName: 'n', default: 10, description: '推演的章节数' },
      {
        name: 'rule',
        type: 'string',
        valueName: 'text',
        description: '本次额外的核心规则（多条用 ; 分隔）',
      },
      {
        name: 'chapter',
        short: 'c',
        type: 'number',
        valueName: 'n',
        description: '推演起点（默认取最新章节）',
      },
    ],
    examples: [
      'ne growth simulate 阿尔 --choices warrior,mage,priest --horizon 20',
      'ne growth simulate 阿尔 --mode free --json',
    ],
    async run(ctx, args) {
      const { memory } = await requireMemory(ctx, args);
      const sheet = requireSheet(memory, requireStr(args, 'character'));
      const mode = (str(args, 'mode') ?? 'controlled') as GrowthSimulationMode;
      const choices = splitList(str(args, 'choices'));
      if (mode === 'controlled' && choices.length === 0) {
        throw new CliError('USAGE', '受控模式需要 --choices', '或使用 --mode free 让 AI 自由成长');
      }
      const built = buildGrowthSimulationPrompt({
        ruleset: memory.ruleset,
        sheet,
        candidateChoices: choices,
        coreRules: (str(args, 'rule') ?? '').split(/[;；]/),
        mode,
        horizon: num(args, 'horizon') ?? 10,
        currentChapter: optionalChapter(args, 'chapter'),
      });
      const next = `ne growth apply-sim ${sheet.name} <ai-result.json> --branch <id>`;
      const text = [
        '=== system ===',
        built.systemPrompt,
        '',
        '=== prompt ===',
        built.prompt,
        '',
        `把 AI 返回的 JSON 保存为文件后运行: ${next}（加 --dry-run 只预览）`,
      ].join('\n');
      return { data: { character: sheet.name, ...built, next }, text };
    },
  },
  {
    path: ['growth', 'apply-sim'],
    summary: '校验 AI 推演结果并采用其中一个分支（--dry-run 只预览）',
    positionals: [
      { name: 'character', description: '角色名或别名', required: true },
      { name: 'file', description: 'AI 返回结果文件（或使用 --stdin）' },
    ],
    options: [
      {
        name: 'branch',
        short: 'b',
        type: 'string',
        valueName: 'id',
        description: '要采用的分支 id',
      },
      { name: 'stdin', type: 'boolean', description: '从标准输入读取 AI 返回结果' },
      {
        name: 'choices',
        type: 'string',
        valueName: 'a,b[,c]',
        description: '推演时使用的候选项（用于识别抉择分支）',
      },
      { name: 'dry-run', type: 'boolean', description: '只校验与预览，不写入' },
    ],
    examples: [
      'ne growth apply-sim 阿尔 result.json --branch warrior',
      'cat result.json | ne growth apply-sim 阿尔 --stdin --dry-run --json',
    ],
    async run(ctx, args) {
      const { root, memory } = await requireMemory(ctx, args);
      const sheet = requireSheet(memory, requireStr(args, 'character'));
      const file = str(args, 'file');
      if (!file && !bool(args, 'stdin')) {
        throw new CliError('USAGE', '需要结果文件或 --stdin');
      }
      const raw = bool(args, 'stdin')
        ? await ctx.readStdin()
        : await readFile(resolvePath(ctx, file as string), 'utf-8');
      const preliminary = parseGrowthSimulationResult(raw, { ruleset: memory.ruleset, sheet });
      const refs = splitList(str(args, 'choices'));
      const candidates = resolveSimulationCandidates(
        memory.ruleset,
        refs.length
          ? refs
          : preliminary.ok
            ? preliminary.result.branches.map((branch) => branch.id)
            : []
      ).filter((item) => item.groupId || item.skillId);
      const outcome = parseGrowthSimulationResult(raw, {
        ruleset: memory.ruleset,
        sheet,
        candidates,
      });
      if (!outcome.ok) {
        throw new CliError(
          'INVALID_ARGUMENT',
          outcome.error,
          outcome.issues.join('；') || undefined
        );
      }
      const branchId = str(args, 'branch');
      const dryRun = bool(args, 'dry-run');
      if (!branchId) {
        if (!dryRun) {
          throw new CliError(
            'USAGE',
            '需要 --branch <id> 指定采用的分支',
            `可选分支: ${outcome.result.branches.map((b) => b.id).join(', ')}；或加 --dry-run 预览`
          );
        }
        const text = outcome.result.branches
          .map(
            (branch) =>
              `[${branch.id}] ${branch.title} → ${branch.projected.level} 级\n  ${branch.summary}${
                branch.warnings.length ? `\n${renderWarnings(branch.warnings)}` : ''
              }`
          )
          .join('\n\n');
        return { data: { applied: false, ...outcome }, text };
      }
      const branch = outcome.result.branches.find((item) => item.id === branchId);
      if (!branch) {
        throw new CliError(
          'NOT_FOUND',
          `分支不存在: ${branchId}`,
          `可选分支: ${outcome.result.branches.map((b) => b.id).join(', ')}`
        );
      }
      const applied = applySimulationBranch(memory.ruleset, sheet, branch);
      if (!dryRun) await saveSheet(root, applied.sheet);
      const progress = getLevelProgress(memory.ruleset, applied.sheet);
      const text = [
        dryRun ? `预览分支「${branch.title}」（未写入）` : `已采用分支「${branch.title}」`,
        `写入 ${applied.applied.length} 条事件，跳过 ${applied.skipped.length} 条`,
        renderSheetText(memory.ruleset, applied.sheet),
        renderWarnings(applied.warnings),
      ]
        .filter(Boolean)
        .join('\n\n');
      return {
        data: {
          applied: !dryRun,
          branch: branch.id,
          events: applied.applied,
          skipped: applied.skipped,
          warnings: applied.warnings,
          progress,
          sheet: applied.sheet,
        },
        text,
      };
    },
  },
];
