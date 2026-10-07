import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIError, type VideoPollResult, type VideoProvider } from '@novel-editor/ai';
import type { VideoTask } from '@novel-editor/video';
import { downloadToFile, resolveInsideWork, writeJsonFile } from '../../../src/main/video/download';
import { VideoTaskRunner, type VideoRunnerDeps } from '../../../src/main/video/runner';

let root: string;
let work: string;
let now: number;

function memoryRepo(initial: VideoTask[] = []) {
  const map = new Map(initial.map((task) => [task.id, task]));
  return {
    map,
    list: (filter?: { workPath?: string }) =>
      Array.from(map.values())
        .filter((task) => !filter?.workPath || task.workPath === filter.workPath)
        .sort((a, b) => a.createdAt - b.createdAt),
    get: (id: string) => map.get(id),
    save: (task: VideoTask) => void map.set(task.id, task),
  };
}

function fakeProvider(overrides: Partial<VideoProvider> = {}) {
  const polls: VideoPollResult[] = [];
  const provider = {
    id: 'minimax-video',
    kind: 'video' as const,
    submitTask: vi.fn(async () => ({ remoteTaskId: `r-${provider.submitTask.mock.calls.length}` })),
    pollTask: vi.fn(
      async (): Promise<VideoPollResult> => polls.shift() ?? { state: 'running', progress: 10 }
    ),
    fetchResult: vi.fn(async () => ({ url: 'https://cdn.test/v.mp4' })),
    cancelTask: vi.fn(async () => undefined),
    testConnection: vi.fn(async () => undefined),
    ...overrides,
  };
  return { provider, polls };
}

function createRunner(
  options: {
    repo?: ReturnType<typeof memoryRepo>;
    provider?: VideoProvider;
    deps?: Partial<VideoRunnerDeps>;
  } = {}
) {
  const repo = options.repo ?? memoryRepo();
  const provider = options.provider ?? fakeProvider().provider;
  const timers: Array<{ ms: number }> = [];
  const changes: VideoTask[] = [];
  let id = 0;
  const downloadFile = vi.fn(async (_url: string, destination: string) => {
    await writeFile(destination, 'mp4-bytes');
  });
  const runner = new VideoTaskRunner({
    repo,
    getProvider: () => provider,
    resolveOutput: resolveInsideWork,
    downloadFile,
    writeJson: writeJsonFile,
    listFiles: (dir) => readdir(dir),
    limits: () => ({ maxConcurrent: 2 }),
    now: () => now,
    createId: () => `t${(id += 1)}`,
    setTimer: (_callback, ms) => {
      timers.push({ ms });
      return timers.length;
    },
    clearTimer: () => undefined,
    onChange: (task) => changes.push(task),
    ...options.deps,
  });
  return { runner, repo, provider, timers, changes, downloadFile };
}

const input = {
  providerId: 'minimax-video',
  workPath: '',
  chapter: '第一章',
  scene: '雪夜',
  shotIndex: 1,
  prompt: '月夜雪原',
  durationSec: 6,
  aspectRatio: '16:9',
};

async function settleDownloads() {
  await vi.waitFor(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

beforeEach(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), 'ne-video-'));
  work = path.join(root, 'novels', '星河旅人');
  await mkdir(work, { recursive: true });
  input.workPath = work;
  now = 1_700_000_000_000;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('VideoTaskRunner', () => {
  it('提交 → 轮询 → 成功 → 下载落盘 + prompt.json', async () => {
    const { provider, polls } = fakeProvider();
    const { runner, repo, downloadFile, changes } = createRunner({ provider });
    runner.start();
    const task = await runner.submit(input);
    expect(task).toMatchObject({
      status: 'queued',
      version: 1,
      params: { durationSec: 6, aspectRatio: '16:9' },
    });

    await runner.tick();
    expect(provider.submitTask).toHaveBeenCalledWith({
      prompt: '月夜雪原',
      model: undefined,
      durationSec: 6,
      aspectRatio: '16:9',
      resolution: undefined,
      firstFrameImage: undefined,
    });
    expect(repo.get('t1')).toMatchObject({ status: 'submitted', remoteTaskId: 'r-1' });

    now += 60_000;
    polls.push({ state: 'running', progress: 42 });
    await runner.tick();
    expect(repo.get('t1')).toMatchObject({ status: 'running', progress: 42 });

    now += 60_000;
    polls.push({ state: 'succeeded' });
    await runner.tick();
    expect(provider.fetchResult).toHaveBeenCalledWith('r-1');
    await vi.waitFor(() =>
      expect(repo.get('t1')?.outputPath).toBe('资料/视频/第一章/雪夜/镜头1-v1.mp4')
    );
    expect(downloadFile).toHaveBeenCalledTimes(1);
    const dir = path.join(work, '资料', '视频', '第一章', '雪夜');
    expect((await readdir(dir)).sort()).toEqual(['镜头1-v1.mp4', '镜头1-v1.prompt.json']);
    const record = JSON.parse(await readFile(path.join(dir, '镜头1-v1.prompt.json'), 'utf-8'));
    expect(record).toMatchObject({
      prompt: '月夜雪原',
      remoteTaskId: 'r-1',
      outputFile: '镜头1-v1.mp4',
      version: 1,
    });
    expect(changes.map((item) => item.status)).toContain('succeeded');
    runner.stop();
  });

  it('版本号：已有文件与未完成的任务都占用版本', async () => {
    const dir = path.join(work, '资料', '视频', '第一章', '雪夜');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, '镜头1-v2.mp4'), 'x');
    const { runner } = createRunner();
    expect((await runner.submit(input)).version).toBe(3);
    expect((await runner.submit(input)).version).toBe(4);
    expect((await runner.submit({ ...input, shotIndex: 2 })).version).toBe(1);
  });

  it('提交前检查：服务未配置、空提示词、预算超限', async () => {
    const { runner: unconfigured } = createRunner({
      deps: {
        getProvider: () => {
          throw new AIError({ kind: 'not-configured', message: '未配置 MiniMax' });
        },
      },
    });
    await expect(unconfigured.submit(input)).rejects.toThrow('未配置 MiniMax');
    const { runner } = createRunner({
      deps: {
        estimateCost: (query) => ({ amount: query.durationSec * 1, currency: 'CNY' }),
        budget: () => ({ perTaskLimit: 5, dailyLimit: 10 }),
      },
    });
    await expect(runner.submit({ ...input, prompt: '  ' })).rejects.toThrow('不能为空');
    await expect(runner.submit({ ...input, durationSec: 6 })).rejects.toMatchObject({
      kind: 'quota',
      message: expect.stringContaining('单次上限'),
    });
    expect((await runner.submit({ ...input, durationSec: 5 })).costEstimate).toEqual({
      amount: 5,
      currency: 'CNY',
    });
    expect((await runner.submit({ ...input, durationSec: 5 })).costEstimate?.amount).toBe(5);
    await expect(runner.submit({ ...input, durationSec: 1 })).rejects.toThrow('每日上限');
  });

  it('并发上限：最多同时运行 2 个，其余排队', async () => {
    const { runner, repo, provider } = createRunner();
    for (let i = 1; i <= 3; i += 1) await runner.submit({ ...input, shotIndex: i });
    await runner.tick();
    expect(provider.submitTask).toHaveBeenCalledTimes(2);
    expect(repo.list().map((task) => task.status)).toEqual(['submitted', 'submitted', 'queued']);
  });

  it('提交失败：可重试的错误退避后重新排队，内容安全直接失败', async () => {
    const submitTask = vi
      .fn()
      .mockRejectedValueOnce(new AIError({ kind: 'network', message: '断网' }))
      .mockRejectedValueOnce(new AIError({ kind: 'content-safety', message: '敏感内容' }));
    const { provider } = fakeProvider({ submitTask });
    const { runner, repo } = createRunner({ provider });
    await runner.submit(input);
    await runner.tick();
    const retried = repo.get('t1');
    expect(retried).toMatchObject({
      status: 'queued',
      attempts: 1,
      error: { code: 'network', retryable: true },
    });
    expect(retried?.nextRunAt).toBeGreaterThan(now);
    now = (retried?.nextRunAt ?? now) + 1;
    await runner.tick();
    expect(repo.get('t1')).toMatchObject({
      status: 'failed',
      error: { code: 'content-safety', message: '敏感内容' },
    });
  });

  it('轮询：远端失败、临时错误、鉴权错误', async () => {
    const pollTask = vi
      .fn()
      .mockResolvedValueOnce({
        state: 'failed',
        error: { kind: 'content-safety', message: '输出违规', retryable: false },
      })
      .mockRejectedValueOnce(new AIError({ kind: 'network', message: '抖动' }))
      .mockRejectedValueOnce(new AIError({ kind: 'auth', message: 'Key 失效' }));
    const { provider } = fakeProvider({ pollTask });
    const log = vi.fn();
    const { runner, repo } = createRunner({ provider, deps: { log } });
    await runner.submit(input);
    await runner.submit({ ...input, shotIndex: 2 });
    await runner.tick();
    now += 60_000;
    await runner.tick();
    // 轮询失败（会退避）必须留下日志，便于排查「任务卡住」
    expect(log).toHaveBeenCalledWith(
      '[video] 轮询任务 t2 失败',
      expect.objectContaining({ message: '抖动' })
    );
    expect(repo.get('t1')).toMatchObject({
      status: 'failed',
      error: { code: 'content-safety', message: '输出违规' },
    });
    expect(repo.get('t2')).toMatchObject({ status: 'submitted', error: { code: 'network' } });
    now += 60_000;
    await runner.tick();
    expect(repo.get('t2')).toMatchObject({ status: 'failed', error: { code: 'auth' } });
  });

  it('取消：本地标记取消并尽力取消远端；取消后轮询结果被忽略；可重试', async () => {
    const { runner, repo, provider } = createRunner();
    await runner.submit(input);
    await runner.tick();
    const cancelled = await runner.cancel('t1');
    expect(cancelled.status).toBe('cancelled');
    expect(provider.cancelTask).toHaveBeenCalledWith('r-1');
    now += 60_000;
    await runner.tick();
    expect(provider.pollTask).not.toHaveBeenCalled();
    const retried = runner.retry('t1');
    expect(retried).toMatchObject({ status: 'queued', attempts: 0 });
    await runner.tick();
    expect(repo.get('t1')?.status).toBe('submitted');
    await expect(runner.cancel('nope')).rejects.toThrow('视频任务不存在');
    expect(() => runner.retry('nope')).toThrow('视频任务不存在');
  });

  it('远端取消失败不影响本地取消', async () => {
    const { provider } = fakeProvider({
      cancelTask: vi.fn(async () => Promise.reject(new Error('unsupported'))),
    });
    const log = vi.fn();
    const { runner } = createRunner({ provider, deps: { log } });
    await runner.submit(input);
    await runner.tick();
    expect((await runner.cancel('t1')).status).toBe('cancelled');
    expect(log).toHaveBeenCalled();
  });

  it('重启后恢复：运行中的任务立即轮询，已成功未下载的任务重新获取地址后下载', async () => {
    const base = {
      providerId: 'minimax-video',
      model: undefined,
      workPath: work,
      chapter: '第一章',
      scene: '雪夜',
      prompt: 'p',
      params: {},
      attempts: 1,
      maxAttempts: 3,
      pollCount: 3,
      createdAt: now - 10_000,
      updatedAt: now - 10_000,
    };
    const repo = memoryRepo([
      {
        ...base,
        id: 'a',
        shotIndex: 1,
        version: 1,
        status: 'running',
        remoteTaskId: 'ra',
        nextRunAt: now + 999_999,
      } as VideoTask,
      {
        ...base,
        id: 'b',
        shotIndex: 2,
        version: 1,
        status: 'succeeded',
        remoteTaskId: 'rb',
        resultUrl: 'https://expired/old.mp4',
        progress: 100,
      } as VideoTask,
    ]);
    const { provider, polls } = fakeProvider({
      fetchResult: vi.fn(async (id: string) => ({ url: `https://fresh/${id}.mp4` })),
    });
    polls.push({ state: 'running', progress: 80 });
    const { runner, downloadFile } = createRunner({ repo, provider });
    runner.start();
    await runner.tick();
    expect(provider.pollTask).toHaveBeenCalledWith('ra');
    await vi.waitFor(() =>
      expect(repo.get('b')?.outputPath).toBe('资料/视频/第一章/雪夜/镜头2-v1.mp4')
    );
    expect(downloadFile.mock.calls[0][0]).toBe('https://fresh/rb.mp4');
    runner.stop();
  });

  it('下载失败：可重试时退避，地址获取失败时回退到已记录的地址', async () => {
    const { provider, polls } = fakeProvider({
      fetchResult: vi
        .fn()
        .mockResolvedValueOnce({ url: 'https://cdn/1.mp4' })
        .mockRejectedValue(new AIError({ kind: 'network', message: 'x' })),
    });
    let fail = true;
    const { runner, repo, downloadFile } = createRunner({
      provider,
      deps: {
        downloadFile: vi.fn(async (_url: string, destination: string) => {
          if (fail) throw new AIError({ kind: 'network', message: '下载中断' });
          await writeFile(destination, 'ok');
        }),
      },
    });
    void downloadFile;
    runner.start();
    await runner.submit(input);
    await runner.tick();
    polls.push({ state: 'succeeded' });
    now += 60_000;
    await runner.tick();
    await vi.waitFor(() => expect(repo.get('t1')?.error?.message).toBe('下载中断'));
    expect(repo.get('t1')).toMatchObject({ status: 'succeeded', downloadAttempts: 1 });
    fail = false;
    now = (repo.get('t1')?.nextRunAt ?? now) + 1;
    await runner.tick();
    await vi.waitFor(() => expect(repo.get('t1')?.outputPath).toBeTruthy());
    runner.stop();
    await settleDownloads();
  });

  it('并发 tick 合并执行；stop 后不再调度', async () => {
    const { runner, timers, provider } = createRunner();
    runner.start();
    await runner.submit(input);
    await Promise.all([runner.tick(), runner.tick(), runner.tick()]);
    expect(provider.submitTask).toHaveBeenCalledTimes(1);
    expect(timers.length).toBeGreaterThan(0);
    runner.stop();
    const before = timers.length;
    await runner.submit({ ...input, shotIndex: 2 });
    expect(timers.length).toBe(before);
  });
});

describe('落盘路径安全', () => {
  it('拒绝 ..、绝对路径、盘符与反斜杠', async () => {
    await expect(resolveInsideWork(work, '../escape.mp4')).rejects.toThrow('不安全');
    await expect(resolveInsideWork(work, '资料/../../x.mp4')).rejects.toThrow('不安全');
    await expect(resolveInsideWork(work, '/etc/passwd')).rejects.toThrow('不安全');
    await expect(resolveInsideWork(work, 'C:/x.mp4')).rejects.toThrow('不安全');
    await expect(resolveInsideWork(work, '资料\\x.mp4')).rejects.toThrow('不安全');
    await expect(resolveInsideWork('relative/dir', 'a.mp4')).rejects.toThrow('绝对路径');
    await expect(resolveInsideWork(work, '.')).rejects.toThrow('不在作品目录内');
  });

  it('拒绝经符号链接逃出作品目录', async () => {
    const outside = path.join(root, 'outside');
    await mkdir(outside, { recursive: true });
    await mkdir(path.join(work, '资料'), { recursive: true });
    await symlink(outside, path.join(work, '资料', '视频'), 'dir');
    await expect(resolveInsideWork(work, '资料/视频/第一章/a.mp4')).rejects.toThrow('符号链接');
  });

  it('正常路径解析到作品目录内并创建父目录', async () => {
    const target = await resolveInsideWork(work, '资料/视频/第一章/雪夜/镜头1-v1.mp4');
    expect(path.basename(target)).toBe('镜头1-v1.mp4');
    expect(await readdir(path.dirname(target))).toEqual([]);
  });
});

describe('downloadToFile', () => {
  function body(text: string) {
    return new Response(text, {
      status: 200,
      headers: { 'content-length': String(Buffer.byteLength(text)) },
    });
  }

  it('下载到 .part 后改名', async () => {
    const dest = path.join(root, 'a.mp4');
    expect(
      await downloadToFile('https://cdn/a.mp4', dest, { fetch: async () => body('video') })
    ).toBe(5);
    expect(await readFile(dest, 'utf-8')).toBe('video');
    expect(await readdir(root)).not.toContain('a.mp4.part');
  });

  it('拒绝非 http(s)、HTTP 错误、过大与空文件，失败时不留下半个文件', async () => {
    const dest = path.join(root, 'b.mp4');
    await expect(downloadToFile('file:///etc/passwd', dest)).rejects.toThrow('只支持 http');
    await expect(downloadToFile('::bad', dest)).rejects.toThrow('下载地址无效');
    await expect(
      downloadToFile('https://x', dest, {
        fetch: async () => new Response('denied', { status: 403 }),
      })
    ).rejects.toMatchObject({ kind: 'auth' });
    await expect(
      downloadToFile('https://x', dest, { fetch: async () => body('0123456789'), maxBytes: 4 })
    ).rejects.toThrow('过大');
    await expect(
      downloadToFile('https://x', dest, {
        fetch: async () => new Response('0123456789'),
        maxBytes: 4,
      })
    ).rejects.toThrow('过大');
    await expect(
      downloadToFile('https://x', dest, { fetch: async () => new Response('') })
    ).rejects.toThrow('为空');
    await expect(
      downloadToFile('https://x', dest, {
        fetch: async () => Promise.reject(new TypeError('offline')),
      })
    ).rejects.toMatchObject({ kind: 'network' });
    expect((await readdir(root)).filter((name) => name.startsWith('b.mp4'))).toEqual([]);
  });

  it('取消下载', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      downloadToFile('https://x', path.join(root, 'c.mp4'), {
        signal: controller.signal,
        fetch: async () =>
          Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
      })
    ).rejects.toMatchObject({ kind: 'aborted' });
  });
});
