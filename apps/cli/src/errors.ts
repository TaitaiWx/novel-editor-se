/**
 * CLI 错误与退出码
 *
 * 退出码约定（对 AI / 脚本稳定）：
 *   0 成功
 *   1 未分类错误（IO_ERROR / INTERNAL）
 *   2 用法错误（USAGE / UNKNOWN_COMMAND / UNKNOWN_OPTION / INVALID_ARGUMENT）
 *   3 目标不存在（NOT_FOUND / NOT_A_FILE / NOT_A_DIRECTORY）
 *   4 目标已存在（ALREADY_EXISTS）
 *   5 不在项目中（NOT_A_PROJECT）
 *   6 不支持的操作（UNSUPPORTED / APP_NOT_FOUND）
 *   7 daemon 未运行（DAEMON_NOT_RUNNING）
 */
import { isCoreError, toCoreError, type CoreErrorCode } from '@novel-editor/core';

export type CliErrorCode =
  | CoreErrorCode
  | 'USAGE'
  | 'UNKNOWN_COMMAND'
  | 'UNKNOWN_OPTION'
  | 'APP_NOT_FOUND'
  | 'DAEMON_NOT_RUNNING'
  | 'INTERNAL';

export class CliError extends Error {
  readonly code: CliErrorCode;
  /** 附加提示（例如「你是不是想输入 xxx」） */
  readonly hint?: string;

  constructor(code: CliErrorCode, message: string, hint?: string) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.hint = hint;
  }
}

const EXIT_CODES: Record<CliErrorCode, number> = {
  IO_ERROR: 1,
  INTERNAL: 1,
  USAGE: 2,
  UNKNOWN_COMMAND: 2,
  UNKNOWN_OPTION: 2,
  INVALID_ARGUMENT: 2,
  NOT_FOUND: 3,
  NOT_A_FILE: 3,
  NOT_A_DIRECTORY: 3,
  ALREADY_EXISTS: 4,
  NOT_A_PROJECT: 5,
  UNSUPPORTED: 6,
  APP_NOT_FOUND: 6,
  DAEMON_NOT_RUNNING: 7,
};

export function exitCodeFor(code: CliErrorCode): number {
  return EXIT_CODES[code] ?? 1;
}

/** 将任意异常规范化为 CliError */
export function normalizeError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  if (isCoreError(error)) return new CliError(error.code, error.message);
  const errno = error as NodeJS.ErrnoException;
  if (errno && typeof errno.code === 'string' && errno.code.startsWith('E')) {
    const core = toCoreError(error);
    return new CliError(core.code, core.message);
  }
  return new CliError('INTERNAL', error instanceof Error ? error.message : String(error));
}
