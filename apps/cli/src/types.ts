/**
 * CLI 公共类型：命令定义、解析结果、执行上下文
 */
import type { Project, WriteEvent } from '@novel-editor/core';

export type OptionType = 'boolean' | 'string' | 'number';
export type OptionValue = string | number | boolean;

export interface OptionSpec {
  /** 长选项名（不含 --），使用 kebab-case */
  name: string;
  short?: string;
  type: OptionType;
  description: string;
  /** 帮助中显示的值名称 */
  valueName?: string;
  choices?: readonly string[];
  default?: OptionValue;
}

export interface PositionalSpec {
  name: string;
  description: string;
  required?: boolean;
  /** 收集剩余所有位置参数 */
  variadic?: boolean;
}

export interface GlobalOptions {
  json: boolean;
  verbose: boolean;
  quiet: boolean;
  help: boolean;
  config?: string;
  cwd?: string;
}

export interface ParsedCommandArgs {
  positionals: Record<string, string | string[] | undefined>;
  options: Record<string, OptionValue | undefined>;
}

export interface Logger {
  /** 普通提示（--quiet / --json 时不输出），写到 stderr */
  info(message: string): void;
  /** 详细日志（仅 --verbose 时输出），写到 stderr */
  debug(message: string): void;
  warn(message: string): void;
  /** 重要提示（--quiet 时不输出，--json 时仍输出到 stderr），例如 daemon 启动信息 */
  notice(message: string): void;
}

export interface RpcRequest {
  argv: string[];
  cwd?: string;
  stdin?: string;
}

/** 稳定的 JSON 输出结构 */
export type Envelope =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string; hint?: string } };

export interface RpcResponse {
  exitCode: number;
  envelope: Envelope;
}

export interface CliContext {
  cwd: string;
  globals: GlobalOptions;
  logger: Logger;
  /** 是否在 daemon 进程内执行 */
  inDaemon: boolean;
  /** 读取标准输入（daemon 模式下为请求体中的 stdin 字段） */
  readStdin(): Promise<string>;
  /** 当前项目（不存在时返回 null） */
  getProject(): Promise<Project | null>;
  /** 当前项目（不存在时抛出 NOT_A_PROJECT） */
  requireProject(): Promise<Project>;
  /** 记录写入事件到所属项目的写作日志（不在项目内的文件自动忽略） */
  recordWrites(events: WriteEvent[]): Promise<void>;
  /** 在当前进程内执行另一条 CLI 命令（daemon 使用），输出强制为 JSON 结构 */
  invoke(request: RpcRequest): Promise<RpcResponse>;
}

export interface CommandResult {
  /** JSON 模式下作为 data 输出 */
  data: unknown;
  /** 人类可读输出（写到 stdout）；为空则不输出 */
  text?: string;
  /** 原样输出 text，不追加换行（例如 file read） */
  raw?: boolean;
}

export interface CommandSpec {
  /** 命令路径，例如 ['file', 'list'] */
  path: readonly string[];
  summary: string;
  description?: string;
  positionals?: readonly PositionalSpec[];
  options?: readonly OptionSpec[];
  examples?: readonly string[];
  /** 是否允许在 daemon RPC 中调用，默认 true */
  rpc?: boolean;
  run(ctx: CliContext, args: ParsedCommandArgs): Promise<CommandResult>;
}
