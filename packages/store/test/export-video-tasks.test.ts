import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createVideoTask,
  planVideoQueue,
  resumeVideoTasks,
  transitionVideoTask,
  type VideoTask,
} from '../../video/src';
vi.mock('better-sqlite3', async () => ({
  default: (await import('./helpers/sqlite-shim')).SqliteShim,
}));
import { backupDatabaseFile, closeDatabase, initDatabase } from '../src/db/connection';
import { videoTaskOps } from '../src/db/video-tasks';
let dir: string;
afterEach(async () => {
  closeDatabase();
  if (dir) await rm(dir, { recursive: true, force: true });
});

it('reopening an export never automatically submits, polls or downloads copied unfinished tasks', async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ne-export-video-'));
  const source = path.join(dir, 'source');
  const target = path.join(dir, 'export');
  initDatabase(path.join(source, '.novel-editor'));
  const tasks: VideoTask[] = [];
  for (const status of [
    'queued',
    'submitted',
    'running',
    'succeeded',
    'failed',
    'cancelled',
  ] as const) {
    const task = {
      ...createVideoTask(
        {
          id: status,
          providerId: 'provider',
          workPath: source,
          chapter: 'chapter',
          scene: 'scene',
          shotIndex: 1,
          version: 1,
          prompt: '作者提示词',
        },
        1
      ),
      status,
      remoteTaskId: `remote-${status}`,
      nextRunAt: 2,
    };
    tasks.push(task);
    videoTaskOps.save(task);
  }
  const downloaded = {
    ...tasks.find((task) => task.status === 'succeeded')!,
    id: 'downloaded',
    outputPath: '资料/视频/done.mp4',
  };
  tasks.push(downloaded);
  videoTaskOps.save(downloaded);
  await mkdir(path.join(target, '.novel-editor'), { recursive: true });
  await backupDatabaseFile(
    path.join(source, '.novel-editor/novel-editor.db'),
    path.join(target, '.novel-editor/novel-editor.db'),
    undefined,
    { sourceRoot: source, destinationRoot: target }
  );
  expect(videoTaskOps.list<VideoTask>()).toEqual(
    [...tasks].sort((a, b) => a.id.localeCompare(b.id))
  );
  closeDatabase();
  initDatabase(path.join(target, '.novel-editor'));
  const copied = videoTaskOps.list<VideoTask>();
  expect(planVideoQueue(resumeVideoTasks(copied, 100), 100, { maxConcurrent: 20 })).toEqual({
    submit: [],
    poll: [],
    download: [],
    nextWakeAt: null,
  });
  for (const id of ['queued', 'submitted', 'running', 'succeeded']) {
    const task = copied.find((entry) => entry.id === id)!;
    expect(task).toMatchObject({
      status: 'failed',
      remoteTaskId: `remote-${id}`,
      workPath: target,
      prompt: '作者提示词',
      exportOrigin: { sourceWorkPath: source, sourceStatus: id },
      error: { code: 'export-paused', retryable: true },
    });
    expect(task.error?.message).toContain('导出副本的任务已暂停，请确认后重试');
    expect(task.error?.message).toContain('再次计费');
    expect(task.nextRunAt).toBeUndefined();
    expect(transitionVideoTask(task, { type: 'retry' }, { now: 100 })).toMatchObject({
      status: 'queued',
    });
    expect(transitionVideoTask(task, { type: 'retry' }, { now: 100 }).remoteTaskId).toBeUndefined();
  }
  expect(copied.find((task) => task.id === 'downloaded')).toMatchObject({
    status: 'succeeded',
    outputPath: '资料/视频/done.mp4',
  });
  expect(copied.find((task) => task.id === 'cancelled')?.status).toBe('cancelled');
});
