/**
 * ne ai continue —— AI 续写（与 GUI 共用 @novel-editor/ai 的上下文组装与提示词）
 *
 * 上下文：光标前的正文（按 token 预算截取）+ 可选章纲文件 + 作品记忆库中的核心规则与成长档案。
 * 有 Key 时流式输出续写正文；没有 Key（或 --prompt-only）时输出提示词，交给 AI agent 执行。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assembleWritingContext,
  buildContinuationPrompt,
  cleanContinuationOutput,
  CONTINUATION_LENGTHS,
  type AssembledContext,
  type ContextGrowth,
  type ContinuationLength,
} from '@novel-editor/ai';
import { loadMemory, resolveWorkScope, summarizeSheetForContext } from '@novel-editor/core';
import { CliError } from '../errors';
import type { CliContext, CommandSpec } from '../types';
import {
  createTextProvider,
  MODEL_OPTION,
  PROMPT_ONLY_OPTION,
  PROVIDER_OPTION,
  resolveTextProviderConfig,
  runStream,
} from './ai-shared';
import { bool, num, requireStr, resolvePath, str } from './util';

const DEFAULT_BUDGET = 6000;

/** 读取文件所属作品的记忆库（规则 + 成长卡），失败时返回空（续写不依赖记忆库） */
async function loadMemoryContext(
  ctx: CliContext,
  file: string
): Promise<{
  rules: string[];
  growth: ContextGrowth[];
  characters: Array<{ name: string; aliases: string[] }>;
}> {
  try {
    const scope = await resolveWorkScope(path.dirname(file), { filePath: file });
    const memory = await loadMemory(scope.root);
    if (!memory.initialized) return { rules: [], growth: [], characters: [] };
    ctx.logger.debug(`记忆库: ${memory.dir}`);
    return {
      rules: memory.ruleset.coreRules.map((rule) => rule.text),
      growth: memory.sheets.map((sheet) => summarizeSheetForContext(sheet, memory.ruleset)),
      characters: memory.sheets.map((sheet) => ({ name: sheet.name, aliases: sheet.aliases })),
    };
  } catch (error) {
    ctx.logger.debug(`跳过记忆库: ${error instanceof Error ? error.message : String(error)}`);
    return { rules: [], growth: [], characters: [] };
  }
}

function contextSummary(context: AssembledContext) {
  return {
    budget: context.budget,
    usedTokens: context.usedTokens,
    sections: context.sections.map((section) => ({
      key: section.key,
      label: section.label,
      tokens: section.tokens,
      truncated: section.truncated,
      omittedItems: section.omittedItems,
    })),
  };
}

export const aiCommands: CommandSpec[] = [
  {
    path: ['ai', 'continue'],
    summary: 'AI 续写：在文件末尾（或 --cursor 处）续写正文，流式输出到 stdout',
    description:
      'Key 读取环境变量 NOVEL_EDITOR_<PROVIDER>_API_KEY（CLI 不保存密钥），可用 NOVEL_EDITOR_<PROVIDER>_BASE_URL 覆盖地址。没有 Key 或加 --prompt-only 时只输出提示词。续写结果不会写回文件。',
    positionals: [{ name: 'file', description: '章节文件', required: true }],
    options: [
      PROVIDER_OPTION,
      MODEL_OPTION,
      { name: 'chars', type: 'number', valueName: 'n', description: '续写字数（默认约 250 字）' },
      {
        name: 'length',
        type: 'string',
        choices: CONTINUATION_LENGTHS,
        default: 'paragraph',
        description: 'sentence=一两句，paragraph=一段，long=约 500 字',
      },
      {
        name: 'direction',
        short: 'd',
        type: 'string',
        valueName: 'text',
        description: 'continue / conflict / wrap-up，或一句自由描述',
      },
      {
        name: 'cursor',
        type: 'number',
        valueName: 'offset',
        description: '光标位置（字符偏移，默认文末）',
      },
      {
        name: 'outline',
        type: 'string',
        valueName: 'file',
        description: '章纲文件（纯文本 / Markdown）',
      },
      { name: 'free', type: 'boolean', description: '章纲仅供参考，允许自由发挥' },
      {
        name: 'budget',
        type: 'number',
        valueName: 'tokens',
        default: DEFAULT_BUDGET,
        description: '上下文 token 预算',
      },
      {
        name: 'memory',
        type: 'boolean',
        default: true,
        description: '带上作品记忆库的核心规则与成长档案（--no-memory 关闭）',
      },
      PROMPT_ONLY_OPTION,
    ],
    examples: [
      'NOVEL_EDITOR_GROK_API_KEY=xai-... ne ai continue novels/星河旅人/第一卷-离乡/001-启程.md --chars 300',
      'ne ai continue 001-启程.md --direction conflict --prompt-only --json',
    ],
    async run(ctx, args) {
      const file = resolvePath(ctx, requireStr(args, 'file'));
      let chapterText: string;
      try {
        chapterText = await readFile(file, 'utf-8');
      } catch {
        throw new CliError('NOT_FOUND', `文件不存在: ${file}`);
      }
      const budget = num(args, 'budget') ?? DEFAULT_BUDGET;
      if (!Number.isFinite(budget) || budget < 200) {
        throw new CliError('INVALID_ARGUMENT', 'budget 至少为 200');
      }
      const cursor = num(args, 'cursor');
      if (cursor !== undefined && (!Number.isInteger(cursor) || cursor < 0)) {
        throw new CliError('INVALID_ARGUMENT', `cursor 必须是非负整数: ${cursor}`);
      }
      const chars = num(args, 'chars');
      if (chars !== undefined && (!Number.isInteger(chars) || chars < 1 || chars > 5000)) {
        throw new CliError('INVALID_ARGUMENT', 'chars 必须在 1–5000 之间');
      }
      const outlineFile = str(args, 'outline');
      const outline = outlineFile
        ? await readFile(resolvePath(ctx, outlineFile), 'utf-8').catch(() => {
            throw new CliError('NOT_FOUND', `章纲文件不存在: ${outlineFile}`);
          })
        : undefined;
      const memory =
        args.options.memory === false
          ? { rules: [], growth: [], characters: [] }
          : await loadMemoryContext(ctx, file);

      const context = assembleWritingContext({
        chapterText,
        cursor,
        chapterTitle: path.basename(file, path.extname(file)),
        outline,
        rules: memory.rules,
        growth: memory.growth,
        characters: memory.characters,
        budget,
      });
      const prompt = buildContinuationPrompt({
        context,
        length: (str(args, 'length') ?? 'paragraph') as ContinuationLength,
        direction: str(args, 'direction'),
        followOutline: !bool(args, 'free'),
        chars,
      });
      const config = resolveTextProviderConfig(
        ctx,
        str(args, 'provider') ?? 'grok',
        str(args, 'model')
      );

      if (bool(args, 'prompt-only') || !config.apiKey) {
        if (!bool(args, 'prompt-only')) {
          ctx.logger.notice(`未设置 ${config.envKey}，只输出提示词（设置后即可直接续写）`);
        }
        const text = [
          '=== system ===',
          prompt.systemPrompt,
          '',
          '=== prompt ===',
          prompt.prompt,
        ].join('\n');
        return {
          data: {
            mode: 'prompt',
            provider: config.descriptor.id,
            envKey: config.envKey,
            systemPrompt: prompt.systemPrompt,
            prompt: prompt.prompt,
            messages: prompt.messages,
            maxTokens: prompt.maxTokens,
            temperature: prompt.temperature,
            context: contextSummary(context),
          },
          text,
        };
      }

      const provider = createTextProvider(config);
      ctx.logger.debug(
        `续写：${config.descriptor.id}，上下文 ${context.usedTokens}/${budget} tokens`
      );
      const outcome = await runStream(ctx, (signal) =>
        provider.stream(
          {
            messages: prompt.messages,
            maxTokens: prompt.maxTokens,
            temperature: prompt.temperature,
          },
          { signal }
        )
      );
      const cleaned = cleanContinuationOutput(outcome.text, context.precedingText);
      return {
        data: {
          mode: 'completion',
          provider: config.descriptor.id,
          model: outcome.model ?? config.model ?? config.descriptor.defaultModel,
          text: cleaned,
          finishReason: outcome.finishReason,
          usage: outcome.usage,
          context: contextSummary(context),
        },
        text: outcome.streamed ? undefined : cleaned,
      };
    },
  },
];
