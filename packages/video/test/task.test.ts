import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUBMIT_BACKOFF,
  InvalidVideoTaskTransitionError,
  VIDEO_TASK_STATUSES,
  canApplyVideoTaskEvent,
  computeBackoffMs,
  isTerminalVideoTask,
  needsDownload,
  pollDelayMs,
  transitionVideoTask,
  type VideoTask,
  type VideoTaskEvent,
} from '../src';
import { fatal, makeTask, retryable } from './helpers';

const NOW = 10_000;
const apply = (task: VideoTask, event: VideoTaskEvent, now = NOW) =>
  transitionVideoTask(task, event, { now });

function submitted(): VideoTask {
  return apply(makeTask(), { type: 'submitted', remoteTaskId: 'r1' });
}
function running(): VideoTask {
  return apply(submitted(), { type: 'polled', state: 'running', progress: 30 });
}
function succeeded(): VideoTask {
  return apply(running(), { type: 'remote-succeeded', resultUrl: 'https://x/v.mp4' });
}
function downloaded(): VideoTask {
  return apply(succeeded(), { type: 'downloaded', outputPath: '资料/视频/a/b/镜头1-v1.mp4' });
}
function failed(): VideoTask {
  return apply(running(), { type: 'remote-failed', error: fatal });
}
function cancelled(): VideoTask {
  return apply(running(), { type: 'cancel' });
}

describe('backoff / poll delay', () => {
  it('computeBackoffMs 指数增长并封顶，确定性', () => {
    expect(computeBackoffMs(1)).toBe(5_000);
    expect(computeBackoffMs(2)).toBe(10_000);
    expect(computeBackoffMs(3)).toBe(20_000);
    expect(computeBackoffMs(7)).toBe(300_000);
    expect(computeBackoffMs(100)).toBe(DEFAULT_SUBMIT_BACKOFF.maxMs);
    expect(computeBackoffMs(5000)).toBe(DEFAULT_SUBMIT_BACKOFF.maxMs);
    expect(computeBackoffMs(0)).toBe(5_000);
    expect(computeBackoffMs(Number.NaN)).toBe(5_000);
    expect(computeBackoffMs(2, { baseMs: 100, factor: 3, maxMs: 1_000 })).toBe(300);
    expect(computeBackoffMs(2, { baseMs: 1, factor: Number.MAX_VALUE, maxMs: 9 })).toBe(9);
    expect(computeBackoffMs(3)).toBe(computeBackoffMs(3));
  });

  it('pollDelayMs: 5s,5s,10s,20s,30s 封顶', () => {
    expect([0, 1, 2, 3, 4, 5, 50].map(pollDelayMs)).toEqual([
      5_000, 5_000, 10_000, 20_000, 30_000, 30_000, 30_000,
    ]);
    expect(pollDelayMs(-3)).toBe(5_000);
    expect(pollDelayMs(Number.NaN)).toBe(5_000);
  });
});

describe('createVideoTask', () => {
  it('创建 queued 任务，nextRunAt = now', () => {
    const task = makeTask({ params: { durationSec: 5 }, model: 'v2' }, 42);
    expect(task).toEqual({
      id: 't1',
      providerId: 'kling',
      model: 'v2',
      workPath: '/works/星河旅人',
      chapter: '第一章',
      scene: '离港',
      shotIndex: 1,
      version: 1,
      prompt: '林舟站在舷窗前',
      params: { durationSec: 5 },
      status: 'queued',
      attempts: 0,
      maxAttempts: 3,
      pollCount: 0,
      createdAt: 42,
      updatedAt: 42,
      nextRunAt: 42,
    });
    expect(JSON.parse(JSON.stringify(task))).toEqual(task);
  });

  it('复制 params 与 costEstimate，不共享引用', () => {
    const params = { a: 1 };
    const costEstimate = { amount: 1, currency: 'CNY' as const };
    const task = makeTask({ params, costEstimate });
    params.a = 2;
    costEstimate.amount = 5;
    expect(task.params).toEqual({ a: 1 });
    expect(task.costEstimate).toEqual({ amount: 1, currency: 'CNY' });
  });

  it.each([
    [{ shotIndex: 0 }, '镜头序号'],
    [{ shotIndex: 1.5 }, '镜头序号'],
    [{ version: -1 }, '版本号'],
    [{ version: Number.NaN }, '版本号'],
    [{ prompt: '   ' }, '提示词'],
    [{ id: '' }, 'id'],
    [{ providerId: ' ' }, '服务商'],
    [{ workPath: '' }, '作品目录'],
    [{ maxAttempts: 0 }, '重试上限'],
  ])('校验输入 %o', (overrides, message) => {
    expect(() => makeTask(overrides)).toThrow(message);
  });
});

describe('transitionVideoTask', () => {
  it('queued --submitted--> submitted', () => {
    const queued = { ...makeTask(), error: retryable };
    const next = apply(queued, { type: 'submitted', remoteTaskId: 'r1' });
    expect(next).toMatchObject({
      status: 'submitted',
      attempts: 1,
      remoteTaskId: 'r1',
      nextRunAt: NOW + 5_000,
      updatedAt: NOW,
    });
    expect(next.error).toBeUndefined();
    expect('error' in next).toBe(false);
    expect(queued.status).toBe('queued');
  });

  it('submit-failed 可重试且未达上限：留在 queued 并退避', () => {
    let task = makeTask();
    task = apply(task, { type: 'submit-failed', error: retryable });
    expect(task).toMatchObject({
      status: 'queued',
      attempts: 1,
      error: retryable,
      nextRunAt: NOW + 5_000,
    });
    task = apply(task, { type: 'submit-failed', error: retryable }, NOW + 5_000);
    expect(task).toMatchObject({ status: 'queued', attempts: 2, nextRunAt: NOW + 15_000 });
    task = apply(task, { type: 'submit-failed', error: retryable }, NOW + 20_000);
    expect(task).toMatchObject({ status: 'failed', attempts: 3, error: retryable });
    expect(task.nextRunAt).toBeUndefined();
  });

  it('submit-failed 使用自定义退避', () => {
    const task = transitionVideoTask(
      makeTask(),
      { type: 'submit-failed', error: retryable },
      { now: NOW, backoff: { baseMs: 1, factor: 1, maxMs: 1 } }
    );
    expect(task.nextRunAt).toBe(NOW + 1);
  });

  it('submit-failed 不可重试：直接 failed', () => {
    const task = apply(makeTask(), { type: 'submit-failed', error: fatal });
    expect(task).toMatchObject({ status: 'failed', attempts: 1, error: fatal });
  });

  it('maxAttempts = 1 时首次失败即 failed', () => {
    const task = apply(makeTask({ maxAttempts: 1 }), { type: 'submit-failed', error: retryable });
    expect(task.status).toBe('failed');
  });

  it('polled running：进度截断到 0..100，pollCount+1，轮询间隔递增', () => {
    let task = submitted();
    task = apply(task, { type: 'polled', state: 'running', progress: 150 });
    expect(task).toMatchObject({ status: 'running', progress: 100, pollCount: 1 });
    expect(task.nextRunAt).toBe(NOW + pollDelayMs(1));
    task = apply(task, { type: 'polled', state: 'running', progress: -5 });
    expect(task).toMatchObject({ progress: 0, pollCount: 2, nextRunAt: NOW + 10_000 });
    task = apply(task, { type: 'polled', state: 'running', progress: Number.NaN });
    expect(task.progress).toBe(0);
    task = apply(task, { type: 'polled', state: 'running' });
    expect(task.progress).toBe(0);
  });

  it('polled queued 保持 submitted；running 不会退回 submitted', () => {
    const stillSubmitted = apply(submitted(), { type: 'polled', state: 'queued' });
    expect(stillSubmitted.status).toBe('submitted');
    expect(stillSubmitted.pollCount).toBe(1);
    expect('progress' in stillSubmitted).toBe(false);
    expect(apply(running(), { type: 'polled', state: 'queued' }).status).toBe('running');
  });

  it('polled 清除之前的临时错误', () => {
    const errored = apply(running(), { type: 'poll-failed', error: retryable });
    expect(errored.error).toEqual(retryable);
    expect(apply(errored, { type: 'polled', state: 'running' }).error).toBeUndefined();
  });

  it('remote-succeeded：succeeded，进度 100，立即下载', () => {
    for (const from of [submitted(), running()]) {
      const task = apply(from, { type: 'remote-succeeded', resultUrl: 'https://x/v.mp4' });
      expect(task).toMatchObject({
        status: 'succeeded',
        progress: 100,
        resultUrl: 'https://x/v.mp4',
        nextRunAt: NOW,
      });
      expect(needsDownload(task)).toBe(true);
      expect(isTerminalVideoTask(task)).toBe(false);
    }
  });

  it('remote-failed：failed', () => {
    const task = apply(submitted(), { type: 'remote-failed', error: retryable });
    expect(task).toMatchObject({ status: 'failed', error: retryable });
    expect(task.nextRunAt).toBeUndefined();
    expect(isTerminalVideoTask(task)).toBe(true);
  });

  it('poll-failed 可重试：状态不变，记录错误，继续轮询', () => {
    const task = apply(running(), { type: 'poll-failed', error: retryable });
    expect(task).toMatchObject({
      status: 'running',
      pollCount: 2,
      error: retryable,
      nextRunAt: NOW + pollDelayMs(2),
    });
    expect(apply(submitted(), { type: 'poll-failed', error: retryable }).status).toBe('submitted');
  });

  it('poll-failed 不可重试：failed', () => {
    const task = apply(running(), { type: 'poll-failed', error: fatal });
    expect(task).toMatchObject({ status: 'failed', error: fatal });
    expect(task.nextRunAt).toBeUndefined();
  });

  it('downloaded：记录 outputPath，清除错误，进入终态', () => {
    const errored = apply(succeeded(), { type: 'download-failed', error: retryable });
    const task = apply(errored, { type: 'downloaded', outputPath: 'a/b.mp4' });
    expect(task).toMatchObject({ status: 'succeeded', outputPath: 'a/b.mp4' });
    expect(task.error).toBeUndefined();
    expect(task.nextRunAt).toBeUndefined();
    expect(isTerminalVideoTask(task)).toBe(true);
    expect(needsDownload(task)).toBe(false);
  });

  it('download-failed 可重试：退避，达到上限后 failed', () => {
    let task = apply(succeeded(), { type: 'download-failed', error: retryable });
    expect(task).toMatchObject({
      status: 'succeeded',
      downloadAttempts: 1,
      error: retryable,
      nextRunAt: NOW + 5_000,
    });
    task = apply(task, { type: 'download-failed', error: retryable });
    expect(task).toMatchObject({
      status: 'succeeded',
      downloadAttempts: 2,
      nextRunAt: NOW + 10_000,
    });
    task = apply(task, { type: 'download-failed', error: retryable });
    expect(task.status).toBe('failed');
  });

  it('download-failed 不可重试：failed', () => {
    const task = apply(succeeded(), { type: 'download-failed', error: fatal });
    expect(task).toMatchObject({ status: 'failed', error: fatal });
  });

  it('cancel：queued / submitted / running / 已成功未下载 → cancelled', () => {
    for (const from of [makeTask(), submitted(), running(), succeeded()]) {
      const task = apply(from, { type: 'cancel' });
      expect(task.status).toBe('cancelled');
      expect(task.nextRunAt).toBeUndefined();
      expect(isTerminalVideoTask(task)).toBe(true);
    }
  });

  it('retry：failed / cancelled → queued，计数与远端信息清零', () => {
    for (const from of [
      failed(),
      cancelled(),
      apply(succeeded(), { type: 'download-failed', error: fatal }),
    ]) {
      const task = apply(from, { type: 'retry' }, NOW + 1);
      expect(task).toMatchObject({
        status: 'queued',
        attempts: 0,
        pollCount: 0,
        nextRunAt: NOW + 1,
        updatedAt: NOW + 1,
      });
      for (const key of [
        'error',
        'remoteTaskId',
        'resultUrl',
        'progress',
        'outputPath',
        'downloadAttempts',
      ]) {
        expect(key in task).toBe(false);
      }
    }
  });

  it('完整流程可 JSON 往返', () => {
    const task = downloaded();
    expect(JSON.parse(JSON.stringify(task))).toEqual(task);
  });
});

describe('非法转换', () => {
  const states: Record<string, () => VideoTask> = {
    queued: () => makeTask(),
    submitted,
    running,
    succeeded,
    downloaded,
    failed,
    cancelled,
  };
  const events: VideoTaskEvent[] = [
    { type: 'submitted', remoteTaskId: 'r' },
    { type: 'submit-failed', error: retryable },
    { type: 'polled', state: 'running' },
    { type: 'remote-succeeded', resultUrl: 'u' },
    { type: 'remote-failed', error: fatal },
    { type: 'poll-failed', error: retryable },
    { type: 'downloaded', outputPath: 'o' },
    { type: 'download-failed', error: retryable },
    { type: 'cancel' },
    { type: 'retry' },
  ];
  const allowed: Record<string, string[]> = {
    queued: ['submitted', 'submit-failed', 'cancel'],
    submitted: ['polled', 'remote-succeeded', 'remote-failed', 'poll-failed', 'cancel'],
    running: ['polled', 'remote-succeeded', 'remote-failed', 'poll-failed', 'cancel'],
    succeeded: ['downloaded', 'download-failed', 'cancel'],
    downloaded: [],
    failed: ['retry'],
    cancelled: ['retry'],
  };

  for (const [state, build] of Object.entries(states)) {
    for (const event of events) {
      const ok = allowed[state]?.includes(event.type) ?? false;
      it(`${state} ${ok ? '允许' : '拒绝'} ${event.type}`, () => {
        const task = build();
        expect(canApplyVideoTaskEvent(task, event.type)).toBe(ok);
        if (ok) {
          expect(() => apply(task, event)).not.toThrow();
        } else {
          let caught: unknown;
          try {
            apply(task, event);
          } catch (error) {
            caught = error;
          }
          expect(caught).toBeInstanceOf(InvalidVideoTaskTransitionError);
          const err = caught as InvalidVideoTaskTransitionError;
          expect(err.from).toBe(task.status);
          expect(err.event).toBe(event.type);
          expect(err.message).toContain(event.type);
        }
      });
    }
  }

  it('状态常量', () => {
    expect(VIDEO_TASK_STATUSES).toEqual([
      'queued',
      'submitted',
      'running',
      'succeeded',
      'failed',
      'cancelled',
    ]);
  });
});
