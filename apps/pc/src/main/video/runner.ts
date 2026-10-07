/**
 * 视频任务后台执行器（主进程）
 *
 * 纯状态机与调度在 @novel-editor/video（transitionVideoTask / planVideoQueue / resumeVideoTasks），
 * 这里负责副作用：调用 Provider、下载成片、写 prompt.json、持久化、定时唤醒。
 * - 任务持久化在当前项目数据库（video_tasks），应用重启 / 重新打开项目后 start() 恢复轮询
 * - 每轮：提交到期的排队任务（受并发上限）→ 轮询运行中的任务 → 后台下载已完成的任务
 * - 提交不自动重复（Provider 层不重试），只有明确可重试的错误按退避重新排队
 */
import { randomUUID } from 'crypto';
import path from 'path';
import { AIError, toAIError, type VideoProvider } from '@novel-editor/ai';
import {
  buildPromptRecord,
  checkVideoBudget,
  createVideoTask,
  nextShotVersion,
  planVideoQueue,
  resumeVideoTasks,
  sumSpend,
  transitionVideoTask,
  videoOutputLayout,
  type CostEstimate,
  type CostQuery,
  type QueueLimits,
  type VideoTask,
  type VideoTaskError,
  type VideoTaskEvent,
} from '@novel-editor/video';

export interface VideoTaskRepo {
  list(filter?: { workPath?: string }): VideoTask[];
  get(id: string): VideoTask | undefined;
  save(task: VideoTask): void;
}

export interface VideoBudget {
  dailyLimit?: number;
  perTaskLimit?: number;
}

export interface VideoRunnerDeps {
  repo: VideoTaskRepo;
  getProvider(providerId: string): VideoProvider;
  /** 把作品内相对路径解析为安全的绝对路径（校验不逃出作品目录） */
  resolveOutput(workPath: string, relativeFile: string): Promise<string>;
  downloadFile(url: string, destination: string, signal: AbortSignal): Promise<unknown>;
  writeJson(file: string, data: unknown): Promise<void>;
  listFiles(dir: string): Promise<string[]>;
  limits(): QueueLimits;
  estimateCost?(query: CostQuery): CostEstimate | null;
  budget?(): VideoBudget;
  onChange?(task: VideoTask): void;
  now?(): number;
  createId?(): string;
  log?(message: string, error?: unknown): void;
  /** 定时器（测试注入） */
  setTimer?(callback: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

export interface VideoSubmitInput {
  providerId: string;
  model?: string;
  workPath: string;
  chapter: string;
  scene: string;
  shotIndex: number;
  prompt: string;
  durationSec?: number;
  aspectRatio?: string;
  resolution?: string;
  firstFrameImage?: string;
}

const MIN_WAKE_MS = 500;
const MAX_WAKE_MS = 60_000;

function toTaskError(error: unknown): VideoTaskError {
  const normalized = toAIError(error);
  return { code: normalized.kind, message: normalized.message, retryable: normalized.retryable };
}

function startOfDay(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export class VideoTaskRunner {
  private timer: unknown = null;
  private ticking = false;
  private tickAgain = false;
  private started = false;
  private readonly downloads = new Map<string, AbortController>();

  constructor(private readonly deps: VideoRunnerDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private save(task: VideoTask): VideoTask {
    this.deps.repo.save(task);
    this.deps.onChange?.(task);
    return task;
  }

  private apply(task: VideoTask, event: VideoTaskEvent): VideoTask {
    // 以数据库中的最新状态为准（例如轮询期间作者取消了任务）
    const latest = this.deps.repo.get(task.id) ?? task;
    if (latest.status === 'cancelled' && event.type !== 'retry') return latest;
    return this.save(transitionVideoTask(latest, event, { now: this.now() }));
  }

  /** 启动 / 重新打开项目后恢复：把中断的任务整理后立刻跑一轮 */
  start(): void {
    this.started = true;
    const now = this.now();
    const tasks = this.deps.repo.list();
    const resumed = resumeVideoTasks(tasks, now);
    resumed.forEach((task, index) => {
      if (task !== tasks[index]) this.save(task);
    });
    this.schedule(0);
  }

  stop(): void {
    this.started = false;
    if (this.timer !== null)
      (this.deps.clearTimer ?? clearTimeout)(this.timer as ReturnType<typeof setTimeout>);
    this.timer = null;
    for (const controller of this.downloads.values()) controller.abort();
    this.downloads.clear();
  }

  list(filter?: { workPath?: string }): VideoTask[] {
    return this.deps.repo.list(filter);
  }

  private schedule(delayMs: number): void {
    if (!this.started) return;
    if (this.timer !== null)
      (this.deps.clearTimer ?? clearTimeout)(this.timer as ReturnType<typeof setTimeout>);
    const ms = Math.min(MAX_WAKE_MS, Math.max(0, delayMs));
    const run = () => {
      this.timer = null;
      void this.tick();
    };
    if (this.deps.setTimer) {
      this.timer = this.deps.setTimer(run, ms);
    } else {
      const handle = setTimeout(run, ms);
      handle.unref?.();
      this.timer = handle;
    }
  }

  /** 执行一轮调度；并发调用会合并为「当前轮结束后再跑一轮」 */
  async tick(): Promise<void> {
    if (this.ticking) {
      this.tickAgain = true;
      return;
    }
    this.ticking = true;
    try {
      do {
        this.tickAgain = false;
        await this.runOnce();
      } while (this.tickAgain);
    } finally {
      this.ticking = false;
    }
    const plan = planVideoQueue(
      this.deps.repo.list().filter((task) => !this.downloads.has(task.id)),
      this.now(),
      this.deps.limits()
    );
    if (plan.nextWakeAt !== null) {
      this.schedule(Math.max(MIN_WAKE_MS, plan.nextWakeAt - this.now()));
    }
  }

  private async runOnce(): Promise<void> {
    const tasks = this.deps.repo.list().filter((task) => !this.downloads.has(task.id));
    const plan = planVideoQueue(tasks, this.now(), this.deps.limits());
    await Promise.all([
      ...plan.submit.map((task) => this.submitRemote(task)),
      ...plan.poll.map((task) => this.poll(task)),
    ]);
    for (const task of plan.download) this.startDownload(task);
  }

  private async submitRemote(task: VideoTask): Promise<void> {
    try {
      const provider = this.deps.getProvider(task.providerId);
      const params = task.params;
      const { remoteTaskId } = await provider.submitTask({
        prompt: task.prompt,
        model: task.model,
        durationSec: typeof params.durationSec === 'number' ? params.durationSec : undefined,
        aspectRatio: typeof params.aspectRatio === 'string' ? params.aspectRatio : undefined,
        resolution: typeof params.resolution === 'string' ? params.resolution : undefined,
        firstFrameImage:
          typeof params.firstFrameImage === 'string' ? params.firstFrameImage : undefined,
      });
      this.apply(task, { type: 'submitted', remoteTaskId });
    } catch (error) {
      this.deps.log?.(`[video] 提交任务 ${task.id} 失败`, error);
      this.apply(task, { type: 'submit-failed', error: toTaskError(error) });
    }
  }

  private async poll(task: VideoTask): Promise<void> {
    if (!task.remoteTaskId) return;
    try {
      const provider = this.deps.getProvider(task.providerId);
      const result = await provider.pollTask(task.remoteTaskId);
      if (result.state === 'queued' || result.state === 'running') {
        this.apply(task, { type: 'polled', state: result.state, progress: result.progress });
        return;
      }
      if (result.state === 'failed') {
        const error = result.error;
        this.apply(task, {
          type: 'remote-failed',
          error: {
            code: error?.kind ?? 'unknown',
            message: error?.message ?? '视频生成失败',
            retryable: false,
          },
        });
        return;
      }
      const resultUrl = result.resultUrl ?? (await provider.fetchResult(task.remoteTaskId)).url;
      this.apply(task, { type: 'remote-succeeded', resultUrl });
      // 同一轮内立即开始下载
      this.tickAgain = true;
    } catch (error) {
      this.apply(task, { type: 'poll-failed', error: toTaskError(error) });
    }
  }

  private startDownload(task: VideoTask): void {
    const controller = new AbortController();
    this.downloads.set(task.id, controller);
    void this.download(task, controller.signal).finally(() => {
      this.downloads.delete(task.id);
      if (this.started) this.schedule(0);
    });
  }

  private async download(task: VideoTask, signal: AbortSignal): Promise<void> {
    try {
      // 签名地址可能已过期（重启后恢复的任务），下载前重新获取
      let url = task.resultUrl;
      if (task.remoteTaskId) {
        try {
          url = (
            await this.deps.getProvider(task.providerId).fetchResult(task.remoteTaskId, { signal })
          ).url;
        } catch (error) {
          if (!url) throw error;
        }
      }
      if (!url) throw new AIError({ kind: 'invalid-response', message: '没有可下载的地址' });
      const layout = videoOutputLayout({
        chapter: task.chapter,
        scene: task.scene,
        shotIndex: task.shotIndex,
        version: task.version,
      });
      const destination = await this.deps.resolveOutput(task.workPath, layout.file);
      await this.deps.downloadFile(url, destination, signal);
      const promptFile = await this.deps.resolveOutput(task.workPath, layout.promptFile);
      await this.deps.writeJson(
        promptFile,
        buildPromptRecord(task, {
          outputFile: layout.fileName,
          downloadedAt: new Date(this.now()).toISOString(),
        })
      );
      this.apply(task, { type: 'downloaded', outputPath: layout.file });
    } catch (error) {
      if (signal.aborted) return;
      this.deps.log?.(`[video] 下载任务 ${task.id} 失败`, error);
      this.apply(task, { type: 'download-failed', error: toTaskError(error) });
    }
  }

  /** 新建任务：分配版本号、估算费用并检查预算，然后排队 */
  async submit(input: VideoSubmitInput): Promise<VideoTask> {
    // 先确认服务已配置，避免排队后才失败
    this.deps.getProvider(input.providerId);
    const prompt = input.prompt?.trim();
    if (!prompt) throw new AIError({ kind: 'bad-request', message: '视频提示词不能为空' });
    const layout = videoOutputLayout({
      chapter: input.chapter,
      scene: input.scene,
      shotIndex: input.shotIndex,
      version: 1,
    });
    const dirAbs = path.dirname(await this.deps.resolveOutput(input.workPath, layout.file));
    const onDisk = await this.deps.listFiles(dirAbs).catch(() => [] as string[]);
    const existing = this.deps.repo.list({ workPath: input.workPath });
    const pendingVersions = existing
      .filter((task) => {
        const other = videoOutputLayout({
          chapter: task.chapter,
          scene: task.scene,
          shotIndex: task.shotIndex,
          version: 1,
        });
        return other.dir === layout.dir && task.shotIndex === input.shotIndex;
      })
      .map((task) => task.version);
    const version = Math.max(
      nextShotVersion(onDisk, input.shotIndex),
      ...pendingVersions.map((v) => v + 1)
    );

    const costEstimate =
      this.deps.estimateCost?.({
        providerId: input.providerId,
        model: input.model,
        durationSec: input.durationSec ?? 5,
        resolution: input.resolution,
      }) ?? undefined;
    const now = this.now();
    if (costEstimate) {
      const budget = this.deps.budget?.() ?? {};
      const check = checkVideoBudget({
        estimate: costEstimate,
        spentToday: sumSpend(this.deps.repo.list(), startOfDay(now), costEstimate.currency),
        dailyLimit: budget.dailyLimit,
        perTaskLimit: budget.perTaskLimit,
      });
      if (!check.ok) throw new AIError({ kind: 'quota', message: check.message });
    }
    const params: Record<string, unknown> = {};
    if (input.durationSec !== undefined) params.durationSec = input.durationSec;
    if (input.aspectRatio) params.aspectRatio = input.aspectRatio;
    if (input.resolution) params.resolution = input.resolution;
    if (input.firstFrameImage) params.firstFrameImage = input.firstFrameImage;
    const task = createVideoTask(
      {
        id: this.deps.createId?.() ?? randomUUID(),
        providerId: input.providerId,
        model: input.model,
        workPath: input.workPath,
        chapter: input.chapter,
        scene: input.scene,
        shotIndex: input.shotIndex,
        version,
        prompt,
        params,
        costEstimate,
      },
      now
    );
    this.save(task);
    this.schedule(0);
    return task;
  }

  async cancel(id: string): Promise<VideoTask> {
    const task = this.requireTask(id);
    this.downloads.get(id)?.abort();
    const cancelled = this.save(transitionVideoTask(task, { type: 'cancel' }, { now: this.now() }));
    if (task.remoteTaskId && (task.status === 'submitted' || task.status === 'running')) {
      try {
        await this.deps.getProvider(task.providerId).cancelTask?.(task.remoteTaskId);
      } catch (error) {
        // 厂商不支持或已开始生成：本地已标记取消，不再轮询
        this.deps.log?.(`[video] 远端取消任务 ${id} 失败`, error);
      }
    }
    return cancelled;
  }

  retry(id: string): VideoTask {
    const task = this.requireTask(id);
    const next = this.save(transitionVideoTask(task, { type: 'retry' }, { now: this.now() }));
    this.schedule(0);
    return next;
  }

  private requireTask(id: string): VideoTask {
    const task = typeof id === 'string' ? this.deps.repo.get(id) : undefined;
    if (!task) throw new AIError({ kind: 'bad-request', message: '视频任务不存在' });
    return task;
  }
}
