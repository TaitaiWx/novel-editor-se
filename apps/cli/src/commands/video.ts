/**
 * ne video storyboard / validate —— 场景文字 → 分镜（与 GUI「场景视频」共用提示词与校验）
 *
 * - storyboard：有 Key 时调用文本服务生成分镜并校验；没有 Key（或 --prompt-only）时输出提示词 + JSON Schema，
 *   由 AI agent 执行后把结果交给 `ne video validate`
 * - validate：校验 / 规范化 AI 返回的分镜 JSON（容忍代码块、字段别名），输出 Markdown 分镜表
 * 视频生成本身需要异步任务队列与落盘，只在 GUI 中进行。
 */
import { readFile } from 'node:fs/promises';
import { writeTextFile, withWorkspaceLease } from '@novel-editor/core';
import {
  buildStoryboardPrompt,
  parseStoryboardResponse,
  type StoryboardParseResult,
} from '@novel-editor/ai';
import { ASPECT_RATIOS, storyboardToMarkdown, type AspectRatio } from '@novel-editor/video';
import { CliError } from '../errors';
import type { CliContext, CommandResult, CommandSpec, ParsedCommandArgs } from '../types';
import {
  createTextProvider,
  MODEL_OPTION,
  PROMPT_ONLY_OPTION,
  PROVIDER_OPTION,
  resolveTextProviderConfig,
  runStream,
} from './ai-shared';
import { bool, num, resolvePath, str } from './util';

const STDIN_OPTION = { name: 'stdin', type: 'boolean' as const, description: '从标准输入读取' };
const OUT_OPTION = {
  name: 'out',
  short: 'o',
  type: 'string' as const,
  valueName: 'file',
  description: '把分镜 JSON 保存到文件',
};

async function readInput(ctx: CliContext, args: ParsedCommandArgs, what: string): Promise<string> {
  const file = str(args, 'file');
  if (bool(args, 'stdin')) return ctx.readStdin();
  if (!file) throw new CliError('USAGE', `缺少${what}：传入文件路径或使用 --stdin`);
  try {
    const target = resolvePath(ctx, file);
    return await withWorkspaceLease(() => readFile(target, 'utf-8'), { resources: [target] });
  } catch {
    throw new CliError('NOT_FOUND', `文件不存在: ${file}`);
  }
}

async function finishStoryboard(
  ctx: CliContext,
  args: ParsedCommandArgs,
  parsed: StoryboardParseResult,
  extra: Record<string, unknown>
): Promise<CommandResult> {
  if (!parsed.ok) {
    throw new CliError(
      'INVALID_ARGUMENT',
      `分镜无效: ${parsed.errors.join('；')}`,
      '调整提示词后重试，或手动修正 JSON 后运行 `ne video validate`'
    );
  }
  for (const warning of parsed.warnings) ctx.logger.warn(warning);
  const out = str(args, 'out');
  if (out) {
    const target = resolvePath(ctx, out);
    await writeTextFile(target, `${JSON.stringify(parsed.storyboard, null, 2)}\n`);
    ctx.logger.info(`已保存分镜: ${target}`);
  }
  return {
    data: { ...extra, storyboard: parsed.storyboard, warnings: parsed.warnings },
    text: storyboardToMarkdown(parsed.storyboard),
  };
}

export const videoCommands: CommandSpec[] = [
  {
    path: ['video', 'storyboard'],
    summary: '把场景文字拆成分镜（景别 / 时长 / 画面 / 运镜），输出 Markdown 分镜表或 JSON',
    description:
      'Key 读取环境变量 NOVEL_EDITOR_<PROVIDER>_API_KEY。没有 Key 或加 --prompt-only 时输出 systemPrompt / prompt / schema，由 AI agent 执行后交给 `ne video validate`。',
    positionals: [{ name: 'file', description: '场景文本文件（或使用 --stdin）' }],
    options: [
      STDIN_OPTION,
      PROVIDER_OPTION,
      MODEL_OPTION,
      {
        name: 'title',
        type: 'string',
        valueName: 'text',
        description: '场景标题，例如「第三幕 / 第一场」',
      },
      {
        name: 'ratio',
        type: 'string',
        choices: ASPECT_RATIOS,
        default: '16:9',
        description: '画面比例',
      },
      {
        name: 'style',
        type: 'string',
        valueName: 'text',
        description: '画面风格，例如 写实 / 国漫 / 水墨',
      },
      { name: 'location', type: 'string', valueName: 'text', description: '地点' },
      {
        name: 'characters',
        type: 'string',
        valueName: 'a,b',
        description: '出场人物（逗号分隔，可写「林舟:黑衣长剑」）',
      },
      { name: 'min-shots', type: 'number', valueName: 'n', default: 3, description: '最少镜头数' },
      { name: 'max-shots', type: 'number', valueName: 'n', default: 6, description: '最多镜头数' },
      OUT_OPTION,
      PROMPT_ONLY_OPTION,
    ],
    examples: [
      'ne video storyboard scene.md --style 水墨 --characters 林舟,苏晴 --json',
      'cat scene.md | ne video storyboard --stdin --prompt-only --json',
    ],
    async run(ctx, args) {
      const sceneText = (await readInput(ctx, args, '场景文本')).trim();
      if (!sceneText) throw new CliError('INVALID_ARGUMENT', '场景文本为空');
      const minShots = num(args, 'min-shots') ?? 3;
      const maxShots = num(args, 'max-shots') ?? 6;
      if (
        !Number.isInteger(minShots) ||
        !Number.isInteger(maxShots) ||
        minShots < 1 ||
        maxShots > 12 ||
        minShots > maxShots
      ) {
        throw new CliError('INVALID_ARGUMENT', '镜头数范围无效（1–12，且 min ≤ max）');
      }
      const aspectRatio = (str(args, 'ratio') ?? '16:9') as AspectRatio;
      const characters = (str(args, 'characters') ?? '')
        .split(/[,\uff0c]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => {
          const [name, ...rest] = item.split(/[:\uff1a]/);
          return { name: name.trim(), appearance: rest.join(':').trim() || undefined };
        });
      const prompt = buildStoryboardPrompt({
        sceneText,
        sceneTitle: str(args, 'title'),
        characters,
        location: str(args, 'location'),
        style: str(args, 'style'),
        aspectRatio,
        minShots,
        maxShots,
      });
      const config = resolveTextProviderConfig(
        ctx,
        str(args, 'provider') ?? 'grok',
        str(args, 'model')
      );
      if (bool(args, 'prompt-only') || !config.apiKey) {
        if (!bool(args, 'prompt-only')) {
          ctx.logger.notice(`未设置 ${config.envKey}，只输出提示词与 JSON Schema`);
        }
        const next = 'ne video validate <ai-result.json>';
        return {
          data: {
            mode: 'prompt',
            provider: config.descriptor.id,
            envKey: config.envKey,
            systemPrompt: prompt.systemPrompt,
            prompt: prompt.prompt,
            messages: prompt.messages,
            schema: prompt.schema,
            next,
          },
          text: [
            '=== system ===',
            prompt.systemPrompt,
            '',
            '=== prompt ===',
            prompt.prompt,
            '',
            `把 AI 返回的 JSON 保存为文件后运行: ${next}`,
          ].join('\n'),
        };
      }
      const provider = createTextProvider(config);
      // 分镜需要完整 JSON 才能校验：只收集，不边生成边打印
      const outcome = await runStream({ ...ctx, stream: undefined }, (signal) =>
        provider.stream(
          {
            messages: prompt.messages,
            temperature: prompt.temperature,
            maxTokens: prompt.maxTokens,
          },
          { signal }
        )
      );
      const parsed = parseStoryboardResponse(outcome.text, {
        aspectRatio,
        style: str(args, 'style'),
        title: str(args, 'title'),
      });
      return finishStoryboard(ctx, args, parsed, {
        mode: 'completion',
        provider: config.descriptor.id,
        model: outcome.model ?? config.model ?? config.descriptor.defaultModel,
      });
    },
  },
  {
    path: ['video', 'validate'],
    summary: '校验并规范化分镜 JSON（AI agent 执行 storyboard 提示词后使用）',
    positionals: [{ name: 'file', description: '分镜 JSON 文件（或使用 --stdin）' }],
    options: [
      STDIN_OPTION,
      { name: 'ratio', type: 'string', choices: ASPECT_RATIOS, description: '覆盖画面比例' },
      OUT_OPTION,
    ],
    examples: [
      'ne video validate ai-result.json --out storyboard.json',
      'cat result.json | ne video validate --stdin --json',
    ],
    async run(ctx, args) {
      const raw = await readInput(ctx, args, '分镜 JSON');
      const ratio = str(args, 'ratio') as AspectRatio | undefined;
      return finishStoryboard(ctx, args, parseStoryboardResponse(raw, { aspectRatio: ratio }), {
        mode: 'validate',
      });
    },
  },
];
