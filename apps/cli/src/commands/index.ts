/**
 * 命令注册表（顺序即帮助中的展示顺序）
 */
import { describeCommands } from '../help';
import type { CommandSpec } from '../types';
import { createAppCommands } from './app';
import { batchCommands } from './batch';
import { fileCommands } from './file';
import { growthCommands } from './growth';
import { growthWorldCommands } from './growth-world';
import { chapterCommands, novelCommands } from './novel';
import { projectCommands } from './project';
import { statsCommands } from './stats';

export const commands: CommandSpec[] = [];

commands.push(
  ...projectCommands,
  ...fileCommands,
  ...batchCommands,
  ...novelCommands,
  ...chapterCommands,
  ...statsCommands,
  ...growthCommands,
  ...growthWorldCommands,
  ...createAppCommands(() => describeCommands(commands))
);
