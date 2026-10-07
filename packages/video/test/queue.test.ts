import { describe, expect, it } from 'vitest';
import {
  planVideoQueue,
  resumeVideoTasks,
  summarizeVideoTasks,
  transitionVideoTask,
  type VideoTask,
  type VideoTaskEvent,
} from '../src';
import { fatal, makeTask } from './helpers';

const apply = (task: VideoTask, event: VideoTaskEvent, now: number) =>
  transitionVideoTask(task, event, { now });

function queued(id: string, createdAt: number): VideoTask {
  return makeTask({ id }, createdAt);
}
function active(id: string, now: number): VideoTask {
  return apply(queued(id, 0), { type: 'submitted', remoteTaskId: `r-${id}` }, now);
}

describe('planVideoQueue', () => {
  it('空队列', () => {
    expect(planVideoQueue([], 0, { maxConcurrent: 2 })).toEqual({
      submit: [],
      poll: [],
      download: [],
      nextWakeAt: null,
    });
  });

  it('按创建时间提交并受并发上限限制', () => {
    const tasks = [queued('c', 30), queued('a', 10), queued('b', 20), queued('a2', 10)];
    const plan = planVideoQueue(tasks, 100, { maxConcurrent: 3 });
    expect(plan.submit.map((t) => t.id)).toEqual(['a', 'a2', 'b']);
    // 因容量不足等待的到期任务不贡献唤醒时间
    expect(plan.nextWakeAt).toBeNull();
  });

  it('正在运行的任务占用并发', () => {
    const tasks = [active('x', 0), active('y', 0), queued('q', 1)];
    const full = planVideoQueue(tasks, 10_000, { maxConcurrent: 2 });
    expect(full.submit).toEqual([]);
    expect(full.poll.map((t) => t.id)).toEqual(['x', 'y']);
    const more = planVideoQueue(tasks, 100, { maxConcurrent: 3 });
    expect(more.submit.map((t) => t.id)).toEqual(['q']);
  });

  it('maxConcurrent 非法或为 0 时不提交', () => {
    const tasks = [queued('q', 1)];
    expect(planVideoQueue(tasks, 10, { maxConcurrent: 0 }).submit).toEqual([]);
    expect(planVideoQueue(tasks, 10, { maxConcurrent: -1 }).submit).toEqual([]);
    expect(planVideoQueue(tasks, 10, { maxConcurrent: Number.NaN }).submit).toEqual([]);
    expect(planVideoQueue(tasks, 10, { maxConcurrent: 1.9 }).submit).toHaveLength(1);
  });

  it('未到期的任务不执行，nextWakeAt 取最早的未来时间', () => {
    const backoff = { ...queued('q', 0), nextRunAt: 500 };
    const polling = { ...active('p', 0), nextRunAt: 300 };
    const downloading: VideoTask = {
      ...apply(active('d', 0), { type: 'remote-succeeded', resultUrl: 'u' }, 0),
      nextRunAt: 400,
    };
    const plan = planVideoQueue([backoff, polling, downloading], 100, { maxConcurrent: 5 });
    expect(plan.submit).toEqual([]);
    expect(plan.poll).toEqual([]);
    expect(plan.download).toEqual([]);
    expect(plan.nextWakeAt).toBe(300);
    const later = planVideoQueue([backoff, polling, downloading], 450, { maxConcurrent: 5 });
    expect(later.poll.map((t) => t.id)).toEqual(['p']);
    expect(later.download.map((t) => t.id)).toEqual(['d']);
    expect(later.nextWakeAt).toBe(500);
  });

  it('轮询按到期时间排序；没有 nextRunAt 视为到期', () => {
    const a = { ...active('a', 0), nextRunAt: 50 };
    const b = { ...active('b', 0), nextRunAt: 10 };
    const c = { ...active('c', 0) };
    delete c.nextRunAt;
    expect(planVideoQueue([a, b, c], 100, { maxConcurrent: 9 }).poll.map((t) => t.id)).toEqual([
      'c',
      'b',
      'a',
    ]);
  });

  it('终态任务被忽略', () => {
    const failed = apply(queued('f', 0), { type: 'submit-failed', error: fatal }, 0);
    const cancelled = { ...apply(queued('c', 0), { type: 'cancel' }, 0), nextRunAt: 999 };
    const plan = planVideoQueue([failed, cancelled], 0, { maxConcurrent: 1 });
    expect(plan).toEqual({ submit: [], poll: [], download: [], nextWakeAt: null });
  });

  it('等待中的未来 queued 任务即使容量已满也贡献唤醒时间', () => {
    const tasks = [
      { ...active('x', 0), nextRunAt: 900 },
      { ...queued('q', 0), nextRunAt: 200 },
    ];
    expect(planVideoQueue(tasks, 100, { maxConcurrent: 1 }).nextWakeAt).toBe(200);
  });
});

describe('resumeVideoTasks', () => {
  it('按状态恢复', () => {
    const now = 5_000;
    const polling = { ...active('p', 0), nextRunAt: 99_999 };
    const orphan: VideoTask = { ...queued('o', 0), status: 'submitted', progress: 10 };
    const orphanRunning: VideoTask = { ...queued('or', 0), status: 'running' };
    const backoff = { ...queued('b', 0), nextRunAt: 8_000 };
    const noNext = { ...queued('n', 0) };
    delete noNext.nextRunAt;
    const download = {
      ...apply(active('d', 0), { type: 'remote-succeeded', resultUrl: 'u' }, 0),
      nextRunAt: 7_000,
    };
    const done = apply(download, { type: 'downloaded', outputPath: 'x.mp4' }, 0);
    const failed = apply(queued('f', 0), { type: 'submit-failed', error: fatal }, 0);
    const input = [polling, orphan, orphanRunning, backoff, noNext, download, done, failed];
    const snapshot = JSON.parse(JSON.stringify(input));

    const result = resumeVideoTasks(input, now);
    expect(result[0]).toMatchObject({ status: 'submitted', nextRunAt: now, updatedAt: now });
    expect(result[1]).toMatchObject({ status: 'queued', nextRunAt: now });
    expect(result[1]?.progress).toBeUndefined();
    expect(result[2]).toMatchObject({ status: 'queued', nextRunAt: now });
    expect(result[3]).toBe(backoff);
    expect(result[4]).toMatchObject({ status: 'queued', nextRunAt: now });
    expect(result[5]).toMatchObject({ status: 'succeeded', nextRunAt: now });
    expect(result[6]).toBe(done);
    expect(result[7]).toBe(failed);
    // 不修改入参
    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);

    const plan = planVideoQueue(result, now, { maxConcurrent: 9 });
    expect(plan.poll.map((t) => t.id)).toEqual(['p']);
    expect(plan.submit.map((t) => t.id)).toEqual(['n', 'o', 'or']);
    expect(plan.download.map((t) => t.id)).toEqual(['d']);
    expect(plan.nextWakeAt).toBe(8_000);
  });
});

describe('summarizeVideoTasks', () => {
  it('按状态计数', () => {
    const tasks = [
      queued('a', 0),
      queued('b', 0),
      active('c', 0),
      apply(active('d', 0), { type: 'polled', state: 'running' }, 0),
      apply(queued('e', 0), { type: 'cancel' }, 0),
    ];
    expect(summarizeVideoTasks(tasks)).toEqual({
      total: 5,
      active: 2,
      byStatus: { queued: 2, submitted: 1, running: 1, succeeded: 0, failed: 0, cancelled: 1 },
    });
    expect(summarizeVideoTasks([]).total).toBe(0);
  });
});
