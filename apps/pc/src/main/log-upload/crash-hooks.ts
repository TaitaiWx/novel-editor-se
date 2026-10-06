/**
 * 崩溃 / 未捕获异常时自动打包日志（并在配置了上传地址时上传）
 *
 * 监听：process uncaughtException / unhandledRejection，
 * app render-process-gone（reason ≠ clean-exit）与 child-process-gone（异常退出）
 *
 * - 10 分钟内最多处理一次，避免崩溃循环刷屏
 * - 处理过程中的任何错误都被吞掉，绝不因为处理崩溃而再次崩溃
 * - E2E / 烟雾测试模式下不安装
 */
import log from 'electron-log/main';
import { isE2ETestMode, isSmokeTestMode } from '../launch-mode';
import type { CrashContext } from './bundle';
import { CRASH_UPLOAD_INTERVAL_MS } from './config';

type Listener = (...args: unknown[]) => void;

export interface EventSource {
  on(event: string, listener: Listener): unknown;
  removeListener(event: string, listener: Listener): unknown;
}

interface Logger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export interface CrashHandlerOptions {
  report: (crash: CrashContext) => Promise<unknown>;
  now?: () => number;
  intervalMs?: number;
  logger?: Logger;
}

/** 生成限频、不会抛错的崩溃处理函数；返回值表示本次是否触发了 report */
export function createCrashHandler(options: CrashHandlerOptions): (crash: CrashContext) => boolean {
  const now = options.now ?? Date.now;
  const intervalMs = options.intervalMs ?? CRASH_UPLOAD_INTERVAL_MS;
  const logger = options.logger ?? log;
  let lastAt: number | null = null;
  let inFlight = false;

  return (crash) => {
    try {
      logger.error(`[崩溃] ${crash.kind}: ${crash.message}`, crash.stack ?? '');
      const current = now();
      if (inFlight || (lastAt !== null && current - lastAt < intervalMs)) return false;
      lastAt = current;
      inFlight = true;
      void Promise.resolve()
        .then(() => options.report(crash))
        .catch((error: unknown) => {
          try {
            logger.warn('[崩溃] 打包 / 上传崩溃日志失败:', error);
          } catch {
            // 日志也写不了时直接放弃
          }
        })
        .finally(() => {
          inFlight = false;
        });
      return true;
    } catch {
      return false;
    }
  };
}

function toCrashContext(
  kind: string,
  value: unknown,
  details?: Record<string, unknown>
): CrashContext {
  if (value instanceof Error) {
    return { kind, message: value.message || value.name, stack: value.stack, details };
  }
  let message: string;
  try {
    message = typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
  } catch {
    message = String(value);
  }
  return { kind, message, details };
}

function pickDetails(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of ['type', 'reason', 'exitCode', 'serviceName', 'name']) {
    if (record[key] !== undefined) result[key] = record[key];
  }
  return result;
}

export interface InstallCrashHooksOptions extends CrashHandlerOptions {
  processLike: EventSource;
  appLike: EventSource;
  /** 测试模式下默认不安装；单测可强制安装 */
  force?: boolean;
}

/** 安装崩溃钩子，返回卸载函数；测试模式下不安装时返回 null */
export function installCrashHooks(options: InstallCrashHooksOptions): (() => void) | null {
  if (!options.force && (isE2ETestMode() || isSmokeTestMode())) return null;
  const handle = createCrashHandler(options);

  const onUncaught: Listener = (error) => handle(toCrashContext('uncaughtException', error));
  const onRejection: Listener = (reason) => handle(toCrashContext('unhandledRejection', reason));
  const onRenderGone: Listener = (_event, _webContents, details) => {
    const info = pickDetails(details);
    if (info.reason === 'clean-exit') return;
    handle(toCrashContext('render-process-gone', `渲染进程退出：${String(info.reason)}`, info));
  };
  const onChildGone: Listener = (_event, details) => {
    const info = pickDetails(details);
    if (info.reason === 'clean-exit' || info.reason === 'killed') return;
    handle(
      toCrashContext(
        'child-process-gone',
        `${String(info.type ?? '子进程')} 退出：${String(info.reason)}`,
        info
      )
    );
  };

  options.processLike.on('uncaughtException', onUncaught);
  options.processLike.on('unhandledRejection', onRejection);
  options.appLike.on('render-process-gone', onRenderGone);
  options.appLike.on('child-process-gone', onChildGone);

  return () => {
    options.processLike.removeListener('uncaughtException', onUncaught);
    options.processLike.removeListener('unhandledRejection', onRejection);
    options.appLike.removeListener('render-process-gone', onRenderGone);
    options.appLike.removeListener('child-process-gone', onChildGone);
  };
}
