/**
 * 成长记录器命令（角色卡与规则）：
 *   ne growth init|list|show|exp|attr|skill|choose|note|rules
 *
 * 数据位于作品的 `<作品>/资料/记忆/`（`--novel` 指定作品，普通文件夹为 `<folder>/资料/记忆/`），
 * 与 GUI「成长」面板共用 @novel-editor/core 的同一套逻辑。
 */
import {
  GROWTH_TEMPLATES,
  applyGrowthEvent,
  checkSheetConsistency,
  ensureSheet,
  getLevelProgress,
  initMemory,
  saveRuleset,
  saveSheet,
  type GrowthEventInput,
  type GrowthTemplate,
} from '@novel-editor/core';
import { CliError } from '../errors';
import { displayPath, renderTable } from '../output';
import type { CliContext, CommandResult, CommandSpec, ParsedCommandArgs } from '../types';
import {
  CHAPTER_OPTION,
  FORCE_OPTION,
  NOTE_OPTION,
  chapterOf,
  memoryRoot,
  noteOf,
  parseNumberArg,
  renderSheetText,
  renderWarnings,
  requireMemory,
  requireSheet,
} from './growth-shared';
import { bool, num, requireStr, str } from './util';

const CHARACTER_ARG = { name: 'character', description: '角色名或别名', required: true };

/** 应用一条事件并保存角色卡（角色卡不存在时自动创建） */
async function applyEvent(
  ctx: CliContext,
  args: ParsedCommandArgs,
  input: GrowthEventInput
): Promise<CommandResult> {
  const { root, memory } = await requireMemory(ctx, args);
  const name = requireStr(args, 'character');
  const { sheet, created } = await ensureSheet(root, name);
  const result = applyGrowthEvent(
    memory.ruleset,
    sheet,
    {
      ...input,
      chapter: chapterOf(args),
      ...(noteOf(args) ? { note: noteOf(args) } : {}),
      source: 'cli',
    },
    { strict: !bool(args, 'force') }
  );
  const saved = await saveSheet(root, result.sheet);
  const warnings = [
    ...result.warnings,
    ...checkSheetConsistency(memory.ruleset, saved).filter(
      (item) => !result.warnings.some((w) => w.message === item.message)
    ),
  ];
  const progress = getLevelProgress(memory.ruleset, saved);
  const head = [
    created ? `已为「${saved.name}」创建成长卡` : '',
    result.levelUps > 0
      ? `升级！${saved.name} ${saved.level - result.levelUps} → ${saved.level} 级`
      : '',
  ].filter(Boolean);
  const text = [...head, renderSheetText(memory.ruleset, saved), renderWarnings(warnings)]
    .filter(Boolean)
    .join('\n\n');
  return {
    data: {
      character: saved.name,
      created,
      event: result.event,
      levelUps: result.levelUps,
      progress,
      sheet: saved,
      warnings,
    },
    text,
  };
}

export const growthCommands: CommandSpec[] = [
  {
    path: ['growth', 'init'],
    summary: '初始化作品的记忆库（<作品>/资料/记忆/：规则、角色、队伍、地图）',
    options: [
      {
        name: 'template',
        short: 't',
        type: 'string',
        choices: GROWTH_TEMPLATES,
        default: 'dnd',
        description: '规则模板',
      },
      { name: 'force', type: 'boolean', description: '用模板覆盖已有的 规则.json' },
    ],
    examples: ['ne growth init', 'ne growth init --novel 星河旅人 --template blank'],
    async run(ctx, args) {
      const root = await memoryRoot(ctx, args);
      const result = await initMemory(root, {
        template: (str(args, 'template') ?? 'dnd') as GrowthTemplate,
        force: bool(args, 'force'),
      });
      const lines = [`记忆库: ${displayPath(result.dir, ctx.cwd)}`];
      for (const file of result.created) lines.push(`  + ${displayPath(file, ctx.cwd)}`);
      for (const file of result.skipped)
        lines.push(`  = ${displayPath(file, ctx.cwd)}（已存在，跳过）`);
      return { data: result, text: lines.join('\n') };
    },
  },
  {
    path: ['growth', 'list'],
    summary: '列出所有角色成长卡',
    async run(ctx, args) {
      const { memory } = await requireMemory(ctx, args);
      const rows = memory.sheets.map((sheet) => {
        const progress = getLevelProgress(memory.ruleset, sheet);
        return {
          name: sheet.name,
          aliases: sheet.aliases,
          level: sheet.level,
          exp: sheet.exp,
          expToNext: progress.isMaxLevel ? null : progress.expToNext,
          skills: sheet.skills.length,
          events: sheet.events.length,
        };
      });
      const text = rows.length
        ? renderTable(
            ['角色', '等级', '经验', '距下一级', '技能', '记录'],
            rows.map((row) => [
              row.name,
              row.level,
              row.exp,
              row.expToNext ?? '满级',
              row.skills,
              row.events,
            ])
          )
        : '（还没有角色成长卡，使用 `ne growth exp <角色> <经验>` 记录第一笔成长）';
      return { data: { dir: memory.dir, characters: rows }, text };
    },
  },
  {
    path: ['growth', 'show'],
    summary: '查看角色成长卡（等级、经验、属性、技能、抉择）',
    positionals: [CHARACTER_ARG],
    async run(ctx, args) {
      const { memory } = await requireMemory(ctx, args);
      const sheet = requireSheet(memory, requireStr(args, 'character'));
      const warnings = checkSheetConsistency(memory.ruleset, sheet);
      return {
        data: { sheet, progress: getLevelProgress(memory.ruleset, sheet), warnings },
        text: [renderSheetText(memory.ruleset, sheet), renderWarnings(warnings)]
          .filter(Boolean)
          .join('\n\n'),
      };
    },
  },
  {
    path: ['growth', 'exp'],
    summary: '记录经验获取（自动升级并按规则成长属性）',
    positionals: [
      CHARACTER_ARG,
      { name: 'amount', description: '经验值（可为负）', required: true },
    ],
    options: [CHAPTER_OPTION, NOTE_OPTION, FORCE_OPTION],
    examples: ['ne growth exp 阿尔 300 --chapter 12 --note "击败哥布林首领"'],
    run: (ctx, args) =>
      applyEvent(ctx, args, { type: 'exp', delta: parseNumberArg(str(args, 'amount'), 'amount') }),
  },
  {
    path: ['growth', 'level'],
    summary: '直接调整等级（剧情传承、降级诅咒等）',
    positionals: [
      CHARACTER_ARG,
      { name: 'delta', description: '等级变化，如 1 或 -1', required: true },
    ],
    options: [CHAPTER_OPTION, NOTE_OPTION, FORCE_OPTION],
    run: (ctx, args) =>
      applyEvent(ctx, args, { type: 'level', delta: parseNumberArg(str(args, 'delta'), 'delta') }),
  },
  {
    path: ['growth', 'attr'],
    summary: '调整属性',
    positionals: [
      CHARACTER_ARG,
      { name: 'key', description: '属性 key 或名称（如 str / 力量）', required: true },
      { name: 'delta', description: '变化量（可为负）', required: true },
    ],
    options: [CHAPTER_OPTION, NOTE_OPTION, FORCE_OPTION],
    examples: ['ne growth attr 阿尔 力量 1 --chapter 15'],
    run: (ctx, args) =>
      applyEvent(ctx, args, {
        type: 'attribute',
        target: requireStr(args, 'key'),
        delta: parseNumberArg(str(args, 'delta'), 'delta'),
      }),
  },
  {
    path: ['growth', 'skill'],
    summary: '学习/升级技能，或增加技能经验（--exp）',
    positionals: [CHARACTER_ARG, { name: 'skill', description: '技能 id 或名称', required: true }],
    options: [
      {
        name: 'levels',
        short: 'l',
        type: 'number',
        valueName: 'n',
        description: '提升的等级数（默认 1）',
      },
      {
        name: 'exp',
        type: 'number',
        valueName: 'n',
        description: '改为增加技能经验，满足消耗时自动升级',
      },
      CHAPTER_OPTION,
      NOTE_OPTION,
      FORCE_OPTION,
    ],
    examples: [
      'ne growth skill 阿尔 fireball',
      'ne growth skill 阿尔 火球术 --exp 400 --chapter 30',
    ],
    run(ctx, args) {
      const exp = num(args, 'exp');
      const levels = num(args, 'levels');
      if (exp !== undefined && levels !== undefined) {
        throw new CliError('USAGE', '--levels 与 --exp 不能同时使用');
      }
      if (levels !== undefined && !Number.isInteger(levels)) {
        throw new CliError('INVALID_ARGUMENT', '--levels 必须是整数');
      }
      return applyEvent(
        ctx,
        args,
        exp !== undefined
          ? { type: 'skill-exp', target: requireStr(args, 'skill'), delta: exp }
          : { type: 'skill', target: requireStr(args, 'skill'), delta: levels ?? 1 }
      );
    },
  },
  {
    path: ['growth', 'choose'],
    summary: '记录二选一 / 三选一等能力抉择（发放规则中的奖励）',
    positionals: [
      CHARACTER_ARG,
      { name: 'group', description: '选择组 id 或名称', required: true },
      { name: 'option', description: '选项 id 或名称', required: true },
    ],
    options: [CHAPTER_OPTION, NOTE_OPTION, FORCE_OPTION],
    examples: ['ne growth choose 阿尔 path warrior --chapter 18'],
    run: (ctx, args) =>
      applyEvent(ctx, args, {
        type: 'choice',
        target: requireStr(args, 'group'),
        value: requireStr(args, 'option'),
      }),
  },
  {
    path: ['growth', 'note'],
    summary: '为角色追加一条成长备注（伤势、装备、心境等）',
    positionals: [CHARACTER_ARG, { name: 'text', description: '备注内容', required: true }],
    options: [
      CHAPTER_OPTION,
      { name: 'status', type: 'boolean', description: '同时写入角色卡的「状态备注」' },
    ],
    async run(ctx, args) {
      const text = requireStr(args, 'text');
      const result = await applyEvent(ctx, args, { type: 'note', note: text });
      if (bool(args, 'status')) {
        const { root, memory } = await requireMemory(ctx, args);
        const sheet = requireSheet(memory, requireStr(args, 'character'));
        await saveSheet(root, { ...sheet, notes: [...sheet.notes, text] });
      }
      return result;
    },
  },
  {
    path: ['growth', 'rules'],
    summary: '查看规则之书，或增删作者的核心规则',
    options: [
      { name: 'add', type: 'string', valueName: 'text', description: '追加一条核心规则' },
      { name: 'remove', type: 'string', valueName: 'id', description: '删除核心规则（按 id）' },
    ],
    examples: ['ne growth rules', 'ne growth rules --add "主角在第三卷前不能学会飞行"'],
    async run(ctx, args) {
      const { root, memory } = await requireMemory(ctx, args);
      let ruleset = memory.ruleset;
      const add = str(args, 'add');
      const remove = str(args, 'remove');
      if (add) {
        const taken = new Set(ruleset.coreRules.map((rule) => rule.id));
        let index = ruleset.coreRules.length + 1;
        while (taken.has(`rule-${index}`)) index += 1;
        ruleset = await saveRuleset(root, {
          ...ruleset,
          coreRules: [...ruleset.coreRules, { id: `rule-${index}`, text: add }],
        });
      }
      if (remove) {
        if (!ruleset.coreRules.some((rule) => rule.id === remove)) {
          throw new CliError('NOT_FOUND', `核心规则不存在: ${remove}`);
        }
        ruleset = await saveRuleset(root, {
          ...ruleset,
          coreRules: ruleset.coreRules.filter((rule) => rule.id !== remove),
        });
      }
      const lines = [
        `${ruleset.name}（等级上限 ${ruleset.levels.maxLevel}）`,
        `属性: ${ruleset.attributes.map((attr) => `${attr.name}(${attr.key})`).join('、') || '无'}`,
        `技能: ${ruleset.skills.map((skill) => `${skill.name}(${skill.id})`).join('、') || '无'}`,
        `抉择: ${
          ruleset.choiceGroups
            .map((group) => `${group.name}[${group.options.map((o) => o.id).join('/')}]`)
            .join('、') || '无'
        }`,
        '核心规则:',
        ...(ruleset.coreRules.length
          ? ruleset.coreRules.map(
              (rule) =>
                `  ${rule.id}  ${rule.text}${rule.check ? `  (自动校验: ${rule.check.kind})` : ''}`
            )
          : ['  （无）']),
      ];
      return { data: ruleset, text: lines.join('\n') };
    },
  },
];
