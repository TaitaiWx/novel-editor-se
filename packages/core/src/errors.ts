/**
 * 核心层统一错误类型
 *
 * 所有核心操作抛出的业务错误都使用 CoreError，携带稳定的 code，
 * 方便 CLI / daemon / GUI 将其映射为退出码或 JSON 错误结构。
 */

export type CoreErrorCode =
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'NOT_A_FILE'
  | 'NOT_A_DIRECTORY'
  | 'NOT_A_PROJECT'
  | 'INVALID_ARGUMENT'
  | 'UNSUPPORTED'
  | 'IO_ERROR';

export class CoreError extends Error {
  readonly code: CoreErrorCode;

  constructor(code: CoreErrorCode, message: string) {
    super(message);
    this.name = 'CoreError';
    this.code = code;
  }
}

export function isCoreError(error: unknown): error is CoreError {
  return error instanceof CoreError;
}

/** 将 Node.js 文件系统错误转换为 CoreError，保留原始信息 */
export function toCoreError(error: unknown, target?: string): CoreError {
  if (error instanceof CoreError) return error;
  const errno = error as NodeJS.ErrnoException;
  const suffix = target ? `: ${target}` : '';
  switch (errno?.code) {
    case 'ENOENT':
      return new CoreError('NOT_FOUND', `路径不存在${suffix}`);
    case 'EEXIST':
      return new CoreError('ALREADY_EXISTS', `路径已存在${suffix}`);
    case 'EISDIR':
      return new CoreError('NOT_A_FILE', `目标是目录而不是文件${suffix}`);
    case 'ENOTDIR':
      return new CoreError('NOT_A_DIRECTORY', `目标不是目录${suffix}`);
    case 'ENOTEMPTY':
      return new CoreError('INVALID_ARGUMENT', `目录非空${suffix}`);
    default:
      return new CoreError(
        'IO_ERROR',
        `${error instanceof Error ? error.message : String(error)}${suffix ? ` (${target})` : ''}`
      );
  }
}
