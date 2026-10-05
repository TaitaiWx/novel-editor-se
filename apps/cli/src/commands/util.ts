/**
 * 命令实现共用的参数读取工具
 */
import path from 'node:path';
import { CliError } from '../errors';
import type { CliContext, ParsedCommandArgs } from '../types';

export function str(args: ParsedCommandArgs, name: string): string | undefined {
  const positional = args.positionals[name];
  if (typeof positional === 'string') return positional;
  const option = args.options[name];
  if (option === undefined || option === false) return undefined;
  return String(option);
}

export function requireStr(args: ParsedCommandArgs, name: string): string {
  const value = str(args, name);
  if (value === undefined || value === '') {
    throw new CliError('USAGE', `缺少参数 ${name}`);
  }
  return value;
}

export function bool(args: ParsedCommandArgs, name: string): boolean {
  return args.options[name] === true;
}

export function num(args: ParsedCommandArgs, name: string): number | undefined {
  const value = args.options[name];
  return typeof value === 'number' ? value : undefined;
}

export function list(args: ParsedCommandArgs, name: string): string[] {
  const value = args.positionals[name];
  return Array.isArray(value) ? value : [];
}

/** 相对 ctx.cwd 解析路径 */
export function resolvePath(ctx: CliContext, target: string): string {
  return path.resolve(ctx.cwd, target);
}
