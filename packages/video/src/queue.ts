/**
 * 视频任务队列调度（纯函数，与持久化无关）
 *
 * 主进程定时调用 planVideoQueue：拿到「现在该提交 / 轮询 / 下载」的任务，
 * 执行后用 transitionVideoTask 更新并保存，再按 nextWakeAt 安排下一次唤醒。
 */
import {
  VIDEO_TASK_STATUSES,
  isTerminalVideoTask,
  needsDownload,
  type VideoTask,
  type VideoTaskStatus,
} from './task';

export interface QueueLimits {
  /** 同时在服务商处运行的任务上限（submitted + running） */
  maxConcurrent: number;
}

export interface QueuePlan {
  submit: VideoTask[];
  poll: VideoTask[];
  download: VideoTask[];
  /** 下一次需要唤醒的时间；没有待处理任务时为 null */
  nextWakeAt: number | null;
}

function isActive(task: VideoTask): boolean {
  return task.status === 'submitted' || task.status === 'running';
}

/** 没有 nextRunAt 视为立即到期 */
function isDue(task: VideoTask, now: number): boolean {
  return task.nextRunAt === undefined || task.nextRunAt <= now;
}

function byCreatedAt(a: VideoTask, b: VideoTask): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function byNextRunAt(a: VideoTask, b: VideoTask): number {
  return (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0) || byCreatedAt(a, b);
}

/**
 * 计算本轮要做的事：
 * - submit：到期的 queued，按创建时间先后，受「上限 - 正在运行数」限制
 * - poll：到期的 submitted / running
 * - download：到期的「已成功未下载」
 * - nextWakeAt：非终态任务中最早的未来 nextRunAt（因容量不足而等待的到期任务不贡献，
 *   它们会在正在运行的任务轮询 / 结束后的下一轮被提交）
 */
export function planVideoQueue(
  tasks: readonly VideoTask[],
  now: number,
  limits: QueueLimits
): QueuePlan {
  const maxConcurrent = Number.isFinite(limits.maxConcurrent)
    ? Math.max(0, Math.floor(limits.maxConcurrent))
    : 0;
  const active = tasks.filter(isActive).length;
  const capacity = Math.max(0, maxConcurrent - active);

  const submit = tasks
    .filter((task) => task.status === 'queued' && isDue(task, now))
    .sort(byCreatedAt)
    .slice(0, capacity);
  const poll = tasks.filter((task) => isActive(task) && isDue(task, now)).sort(byNextRunAt);
  const download = tasks
    .filter((task) => needsDownload(task) && isDue(task, now))
    .sort(byNextRunAt);

  let nextWakeAt: number | null = null;
  for (const task of tasks) {
    if (isTerminalVideoTask(task)) continue;
    if (task.nextRunAt === undefined || task.nextRunAt <= now) continue;
    if (nextWakeAt === null || task.nextRunAt < nextWakeAt) nextWakeAt = task.nextRunAt;
  }
  return { submit, poll, download, nextWakeAt };
}

/**
 * 应用重启后恢复任务：
 * - submitted / running 且有 remoteTaskId：立即轮询
 * - submitted / running 但没有 remoteTaskId（提交结果未落盘）：退回 queued 立即重新提交。
 *   注意：如果上次其实已提交成功，这会在服务商处产生一个重复任务（可能重复计费）
 * - queued：保留退避时间（没有 nextRunAt 时设为 now）
 * - succeeded 未下载：立即下载
 * - 终态：原样保留
 */
export function resumeVideoTasks(tasks: readonly VideoTask[], now: number): VideoTask[] {
  return tasks.map((task) => {
    if (isActive(task)) {
      if (task.remoteTaskId) return { ...task, nextRunAt: now, updatedAt: now };
      const requeued: VideoTask = { ...task, status: 'queued', nextRunAt: now, updatedAt: now };
      delete requeued.progress;
      return requeued;
    }
    if (task.status === 'queued') {
      return task.nextRunAt === undefined ? { ...task, nextRunAt: now, updatedAt: now } : task;
    }
    if (needsDownload(task)) return { ...task, nextRunAt: now, updatedAt: now };
    return task;
  });
}

export interface VideoTaskSummary {
  total: number;
  byStatus: Record<VideoTaskStatus, number>;
  /** submitted + running */
  active: number;
}

export function summarizeVideoTasks(tasks: readonly VideoTask[]): VideoTaskSummary {
  const byStatus = Object.fromEntries(VIDEO_TASK_STATUSES.map((status) => [status, 0])) as Record<
    VideoTaskStatus,
    number
  >;
  for (const task of tasks) byStatus[task.status] += 1;
  return { total: tasks.length, byStatus, active: byStatus.submitted + byStatus.running };
}
