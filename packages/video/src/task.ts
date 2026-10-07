/**
 * 视频生成任务模型与纯状态机
 *
 * 状态流转（所有转换都是纯函数，返回新对象，持久化由调用方负责）：
 *
 *   queued ──submitted──▶ submitted ──polled(running)──▶ running
 *     ▲  │                    │                             │
 *     │  └─submit-failed      ├──remote-succeeded──▶ succeeded ──downloaded──▶ succeeded(outputPath)
 *     │    （可重试则留在      ├──remote-failed────▶ failed
 *     │      queued 并退避）   └──poll-failed（临时错误继续轮询，不可重试则 failed）
 *     │
 *     └──retry── failed / cancelled
 *
 * 「终态」：failed、cancelled、已下载的 succeeded。succeeded 但还没有 outputPath 时仍需下载。
 */
import type { CostEstimate } from './cost';

export type { CostEstimate } from './cost';

export const VIDEO_TASK_STATUSES = [
  'queued',
  'submitted',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type VideoTaskStatus = (typeof VIDEO_TASK_STATUSES)[number];

export interface VideoTaskError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface VideoTask {
  id: string;
  providerId: string;
  model?: string;
  /** 作品根目录绝对路径（主进程校验） */
  workPath: string;
  /** 原始章节名称（落盘时再清洗） */
  chapter: string;
  /** 原始场景名称（落盘时再清洗） */
  scene: string;
  /** 镜头序号，从 1 开始 */
  shotIndex: number;
  /** 版本号，从 1 开始 */
  version: number;
  prompt: string;
  /** JSON 可序列化：durationSec、aspectRatio、resolution、firstFrameImage… */
  params: Record<string, unknown>;
  status: VideoTaskStatus;
  remoteTaskId?: string;
  /** 0-100 */
  progress?: number;
  /** 已提交（含失败）次数 */
  attempts: number;
  /** 自动重试上限（默认 3） */
  maxAttempts: number;
  pollCount: number;
  /** 下载失败次数（可重试的下载失败达到 maxAttempts 后转为 failed） */
  downloadAttempts?: number;
  error?: VideoTaskError;
  resultUrl?: string;
  /** 相对 workPath 的 POSIX 路径（下载完成后） */
  outputPath?: string;
  costEstimate?: CostEstimate;
  /** epoch ms */
  createdAt: number;
  updatedAt: number;
  /** queued: 何时提交；submitted/running: 何时轮询；succeeded 且无 outputPath: 何时下载 */
  nextRunAt?: number;
}

export type VideoTaskEvent =
  | { type: 'submitted'; remoteTaskId: string }
  | { type: 'submit-failed'; error: VideoTaskError }
  | { type: 'polled'; state: 'queued' | 'running'; progress?: number }
  | { type: 'remote-succeeded'; resultUrl: string }
  | { type: 'remote-failed'; error: VideoTaskError }
  /** 轮询时的临时错误（网络等） */
  | { type: 'poll-failed'; error: VideoTaskError }
  | { type: 'downloaded'; outputPath: string }
  | { type: 'download-failed'; error: VideoTaskError }
  | { type: 'cancel' }
  /** 作者手动重试 */
  | { type: 'retry' };

export type VideoTaskEventType = VideoTaskEvent['type'];

export interface BackoffPolicy {
  baseMs: number;
  factor: number;
  maxMs: number;
}

/** 提交 / 下载失败的默认退避：5 秒起，每次翻倍，最长 5 分钟 */
export const DEFAULT_SUBMIT_BACKOFF: BackoffPolicy = {
  baseMs: 5_000,
  factor: 2,
  maxMs: 5 * 60_000,
};

export const DEFAULT_MAX_ATTEMPTS = 3;

/** 第 attempt 次失败后的等待时间（确定性，无随机抖动，便于测试与复现） */
export function computeBackoffMs(
  attempt: number,
  policy: BackoffPolicy = DEFAULT_SUBMIT_BACKOFF
): number {
  const n = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;
  const raw = policy.baseMs * Math.pow(policy.factor, n - 1);
  if (!Number.isFinite(raw)) return policy.maxMs;
  return Math.min(policy.maxMs, Math.max(0, Math.round(raw)));
}

const POLL_BASE_MS = 5_000;
const POLL_MAX_MS = 30_000;

/** 第 pollCount 次轮询前的等待：5s、5s、10s、20s、30s…（最长 30 秒） */
export function pollDelayMs(pollCount: number): number {
  const n = Number.isFinite(pollCount) ? Math.max(0, Math.floor(pollCount)) : 0;
  if (n <= 1) return POLL_BASE_MS;
  return Math.min(POLL_MAX_MS, POLL_BASE_MS * Math.pow(2, n - 1));
}

export class InvalidVideoTaskTransitionError extends Error {
  readonly from: VideoTaskStatus;
  readonly event: VideoTaskEventType;

  constructor(from: VideoTaskStatus, event: VideoTaskEventType) {
    super(`视频任务状态「${from}」不能处理事件「${event}」`);
    this.name = 'InvalidVideoTaskTransitionError';
    this.from = from;
    this.event = event;
  }
}

export interface CreateVideoTaskInput {
  id: string;
  providerId: string;
  model?: string;
  workPath: string;
  chapter: string;
  scene: string;
  shotIndex: number;
  version: number;
  prompt: string;
  params?: Record<string, unknown>;
  maxAttempts?: number;
  costEstimate?: CostEstimate;
}

function isPositiveInt(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

export function createVideoTask(input: CreateVideoTaskInput, now: number): VideoTask {
  if (!input.id.trim()) throw new Error('视频任务 id 不能为空');
  if (!input.providerId.trim()) throw new Error('视频服务商（providerId）不能为空');
  if (!input.workPath.trim()) throw new Error('作品目录（workPath）不能为空');
  if (!isPositiveInt(input.shotIndex)) {
    throw new Error(`镜头序号必须是正整数: ${input.shotIndex}`);
  }
  if (!isPositiveInt(input.version)) throw new Error(`版本号必须是正整数: ${input.version}`);
  if (!input.prompt.trim()) throw new Error('视频提示词不能为空');
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!isPositiveInt(maxAttempts)) throw new Error(`重试上限必须是正整数: ${maxAttempts}`);

  const task: VideoTask = {
    id: input.id,
    providerId: input.providerId,
    workPath: input.workPath,
    chapter: input.chapter,
    scene: input.scene,
    shotIndex: input.shotIndex,
    version: input.version,
    prompt: input.prompt,
    params: { ...(input.params ?? {}) },
    status: 'queued',
    attempts: 0,
    maxAttempts,
    pollCount: 0,
    createdAt: now,
    updatedAt: now,
    nextRunAt: now,
  };
  if (input.model) task.model = input.model;
  if (input.costEstimate) task.costEstimate = { ...input.costEstimate };
  return task;
}

/** 已成功但还没有下载到本地 */
export function needsDownload(task: VideoTask): boolean {
  return task.status === 'succeeded' && !task.outputPath;
}

export function isTerminalVideoTask(task: VideoTask): boolean {
  return (
    task.status === 'failed' ||
    task.status === 'cancelled' ||
    (task.status === 'succeeded' && Boolean(task.outputPath))
  );
}

export function canApplyVideoTaskEvent(task: VideoTask, type: VideoTaskEventType): boolean {
  const { status } = task;
  const active = status === 'submitted' || status === 'running';
  switch (type) {
    case 'submitted':
    case 'submit-failed':
      return status === 'queued';
    case 'polled':
    case 'remote-succeeded':
    case 'remote-failed':
    case 'poll-failed':
      return active;
    case 'downloaded':
    case 'download-failed':
      return needsDownload(task);
    case 'cancel':
      return status === 'queued' || active || needsDownload(task);
    case 'retry':
      return status === 'failed' || status === 'cancelled';
    default:
      return false;
  }
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** 去掉值为 undefined 的可选字段，保证 JSON 往返后对象相等 */
function compact(task: VideoTask): VideoTask {
  const result: VideoTask = { ...task };
  const record = result as unknown as Record<string, unknown>;
  const optionalKeys: (keyof VideoTask)[] = [
    'model',
    'remoteTaskId',
    'progress',
    'downloadAttempts',
    'error',
    'resultUrl',
    'outputPath',
    'costEstimate',
    'nextRunAt',
  ];
  for (const key of optionalKeys) {
    if (record[key] === undefined) delete record[key];
  }
  return result;
}

/**
 * 应用事件，返回新任务对象（不修改入参）。非法转换抛出 InvalidVideoTaskTransitionError。
 */
export function transitionVideoTask(
  task: VideoTask,
  event: VideoTaskEvent,
  options: { now: number; backoff?: BackoffPolicy }
): VideoTask {
  if (!canApplyVideoTaskEvent(task, event.type)) {
    throw new InvalidVideoTaskTransitionError(task.status, event.type);
  }
  const { now } = options;
  const backoff = options.backoff ?? DEFAULT_SUBMIT_BACKOFF;
  const base: VideoTask = { ...task, updatedAt: now };

  switch (event.type) {
    case 'submitted':
      return compact({
        ...base,
        status: 'submitted',
        attempts: task.attempts + 1,
        remoteTaskId: event.remoteTaskId,
        error: undefined,
        nextRunAt: now + pollDelayMs(0),
      });

    case 'submit-failed': {
      const attempts = task.attempts + 1;
      if (event.error.retryable && attempts < task.maxAttempts) {
        return compact({
          ...base,
          attempts,
          error: event.error,
          nextRunAt: now + computeBackoffMs(attempts, backoff),
        });
      }
      return compact({
        ...base,
        status: 'failed',
        attempts,
        error: event.error,
        nextRunAt: undefined,
      });
    }

    case 'polled': {
      const pollCount = task.pollCount + 1;
      return compact({
        ...base,
        // 远端仍在排队时保持当前状态（running 不会退回 submitted）
        status: event.state === 'running' ? 'running' : task.status,
        progress: event.progress === undefined ? task.progress : clampProgress(event.progress),
        pollCount,
        error: undefined,
        nextRunAt: now + pollDelayMs(pollCount),
      });
    }

    case 'remote-succeeded':
      return compact({
        ...base,
        status: 'succeeded',
        progress: 100,
        resultUrl: event.resultUrl,
        error: undefined,
        downloadAttempts: 0,
        nextRunAt: now,
      });

    case 'remote-failed':
      return compact({ ...base, status: 'failed', error: event.error, nextRunAt: undefined });

    case 'poll-failed': {
      if (!event.error.retryable) {
        return compact({ ...base, status: 'failed', error: event.error, nextRunAt: undefined });
      }
      const pollCount = task.pollCount + 1;
      return compact({
        ...base,
        pollCount,
        error: event.error,
        nextRunAt: now + pollDelayMs(pollCount),
      });
    }

    case 'downloaded':
      return compact({
        ...base,
        outputPath: event.outputPath,
        error: undefined,
        nextRunAt: undefined,
      });

    case 'download-failed': {
      const downloadAttempts = (task.downloadAttempts ?? 0) + 1;
      if (event.error.retryable && downloadAttempts < task.maxAttempts) {
        return compact({
          ...base,
          downloadAttempts,
          error: event.error,
          nextRunAt: now + computeBackoffMs(downloadAttempts, backoff),
        });
      }
      return compact({
        ...base,
        status: 'failed',
        downloadAttempts,
        error: event.error,
        nextRunAt: undefined,
      });
    }

    case 'cancel':
      return compact({ ...base, status: 'cancelled', nextRunAt: undefined });

    case 'retry':
      return compact({
        ...base,
        status: 'queued',
        attempts: 0,
        pollCount: 0,
        downloadAttempts: undefined,
        error: undefined,
        remoteTaskId: undefined,
        resultUrl: undefined,
        progress: undefined,
        outputPath: undefined,
        nextRunAt: now,
      });

    default:
      // 穷尽检查：新增事件类型时在这里报编译错误
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`未知的视频任务事件: ${JSON.stringify(value)}`);
}
