import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron-log/main', () => ({
  default: { error: vi.fn(), warn: vi.fn() },
}));

import { createCrashHandler, installCrashHooks } from '../../../src/main/log-upload/crash-hooks';
import type { CrashContext } from '../../../src/main/log-upload/bundle';

const logger = { error: vi.fn(), warn: vi.fn() };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllEnvs();
  logger.error.mockClear();
  logger.warn.mockClear();
});

describe('createCrashHandler', () => {
  it('10 分钟内只处理一次', async () => {
    let now = 0;
    const report = vi.fn(async () => undefined);
    const handle = createCrashHandler({ report, now: () => now, logger });
    const crash: CrashContext = { kind: 'uncaughtException', message: 'boom' };

    expect(handle(crash)).toBe(true);
    await flush();
    now = 9 * 60_000;
    expect(handle(crash)).toBe(false);
    now = 10 * 60_000;
    expect(handle(crash)).toBe(true);
    await flush();
    expect(report).toHaveBeenCalledTimes(2);
    // 每次崩溃都写日志，即使被限频
    expect(logger.error).toHaveBeenCalledTimes(3);
  });

  it('处理中再次崩溃不会重入；report 失败不会抛出', async () => {
    let release: () => void = () => undefined;
    const report = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          release = () => reject(new Error('upload failed'));
        })
    );
    const handle = createCrashHandler({ report, now: () => 0, intervalMs: 0, logger });
    expect(handle({ kind: 'a', message: '1' })).toBe(true);
    await flush();
    expect(handle({ kind: 'a', message: '2' })).toBe(false);
    release();
    await flush();
    await flush();
    expect(logger.warn).toHaveBeenCalledWith('[崩溃] 打包 / 上传崩溃日志失败:', expect.any(Error));
    expect(handle({ kind: 'a', message: '3' })).toBe(true);
  });

  it('report 同步抛错、日志写入失败都不会抛出', () => {
    const badLogger = {
      error: () => {
        throw new Error('log broken');
      },
      warn: vi.fn(),
    };
    const handle = createCrashHandler({
      report: () => {
        throw new Error('sync');
      },
      logger: badLogger,
    });
    expect(() => handle({ kind: 'a', message: 'b' })).not.toThrow();
  });
});

describe('installCrashHooks', () => {
  function setup(force = true) {
    const processLike = new EventEmitter();
    const appLike = new EventEmitter();
    const report = vi.fn(async (_crash: CrashContext) => undefined);
    const dispose = installCrashHooks({
      processLike,
      appLike,
      report,
      intervalMs: 0,
      logger,
      force,
    });
    return { processLike, appLike, report, dispose };
  }

  it('监听未捕获异常、Promise 拒绝与进程异常退出', async () => {
    const { processLike, appLike, report, dispose } = setup();
    processLike.emit('uncaughtException', new Error('boom'));
    await flush();
    processLike.emit('unhandledRejection', { code: 42 });
    await flush();
    appLike.emit('render-process-gone', {}, {}, { reason: 'crashed', exitCode: 11 });
    await flush();
    appLike.emit('child-process-gone', {}, { type: 'GPU', reason: 'oom', exitCode: 1 });
    await flush();

    expect(report.mock.calls.map(([crash]) => crash.kind)).toEqual([
      'uncaughtException',
      'unhandledRejection',
      'render-process-gone',
      'child-process-gone',
    ]);
    expect(report.mock.calls[0][0]).toMatchObject({ message: 'boom', stack: expect.any(String) });
    expect(report.mock.calls[1][0].message).toBe('{"code":42}');
    expect(report.mock.calls[2][0]).toMatchObject({
      message: '渲染进程退出：crashed',
      details: { reason: 'crashed', exitCode: 11 },
    });
    expect(report.mock.calls[3][0].message).toBe('GPU 退出：oom');

    dispose?.();
    expect(processLike.listenerCount('uncaughtException')).toBe(0);
    expect(appLike.listenerCount('render-process-gone')).toBe(0);
  });

  it('正常退出 / 被主动结束不算崩溃', async () => {
    const { appLike, report } = setup();
    appLike.emit('render-process-gone', {}, {}, { reason: 'clean-exit', exitCode: 0 });
    appLike.emit('child-process-gone', {}, { type: 'Utility', reason: 'killed', exitCode: 0 });
    appLike.emit('child-process-gone', {}, { type: 'Utility', reason: 'clean-exit', exitCode: 0 });
    await flush();
    expect(report).not.toHaveBeenCalled();
  });

  it('E2E / 烟雾测试模式下不安装', () => {
    vi.stubEnv('NOVEL_EDITOR_E2E', '1');
    const { processLike, dispose } = setup(false);
    expect(dispose).toBeNull();
    expect(processLike.listenerCount('uncaughtException')).toBe(0);
    vi.unstubAllEnvs();
    vi.stubEnv('NOVEL_EDITOR_SMOKE_TEST', '1');
    expect(setup(false).dispose).toBeNull();
  });
});
