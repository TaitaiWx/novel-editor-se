/**
 * 命令注册表（顺序即帮助中的展示顺序）
 */
import { describeCommands } from '../help';
import type { CommandSpec } from '../types';
import { aiCommands } from './ai';
import { createAppCommands } from './app';
import { batchCommands } from './batch';
import { fileCommands } from './file';
import { growthCommands } from './growth';
import { NOVEL_OPTION } from './growth-shared';
import { growthWorldCommands } from './growth-world';
import { chapterCommands, novelCommands } from './novel';
import { projectCommands } from './project';
import { statsCommands } from './stats';
import { videoCommands } from './video';

export const commands: CommandSpec[] = [];

/** 记忆库跟随作品：所有 ne growth 子命令都接受 --novel <作品> */
function withNovelOption(command: CommandSpec): CommandSpec {
  return { ...command, options: [...(command.options ?? []), NOVEL_OPTION] };
}

commands.push(
  ...projectCommands,
  ...fileCommands,
  ...batchCommands,
  ...novelCommands,
  ...chapterCommands,
  ...statsCommands,
  ...[...growthCommands, ...growthWorldCommands].map(withNovelOption),
  ...aiCommands,
  ...videoCommands,
  ...createAppCommands(() => describeCommands(commands))
);
