import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { sqliteAvailable } from './helpers/sqlite-shim';

vi.mock('better-sqlite3', async () => {
  const { SqliteShim } = await import('./helpers/sqlite-shim');
  return { default: SqliteShim };
});

import { closeDatabase, getDatabase, initDatabase, videoTaskOps } from '../src';
import { hasColumn } from '../src/db/schema';

interface Task {
  id: string;
  providerId: string;
  workPath: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  prompt?: string;
}

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    providerId: 'minimax-video',
    workPath: '/p/novels/作品',
    status: 'queued',
    createdAt: 1000,
    updatedAt: 1000,
    prompt: `镜头 ${id}`,
    ...overrides,
  };
}

describe.skipIf(!sqliteAvailable)('store/video-tasks', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ne-store-video-'));
    initDatabase(dir, 'test.db');
  });

  afterEach(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it('迁移：建表与索引', () => {
    expect(hasColumn(getDatabase(), 'video_tasks', 'data_json')).toBe(true);
    // 重复初始化（增量迁移）不报错
    closeDatabase();
    initDatabase(dir, 'test.db');
    expect(hasColumn(getDatabase(), 'video_tasks', 'status')).toBe(true);
  });

  it('保存、覆盖、读取与删除', () => {
    videoTaskOps.save(task('a'));
    expect(videoTaskOps.get<Task>('a')).toEqual(task('a'));
    videoTaskOps.save(task('a', { status: 'running', updatedAt: 2000.6 }));
    expect(videoTaskOps.get<Task>('a')?.status).toBe('running');
    const row = getDatabase()
      .prepare('SELECT status, updated_at FROM video_tasks WHERE id = ?')
      .get('a');
    expect(row).toEqual({ status: 'running', updated_at: 2001 });
    expect(videoTaskOps.delete('a').changes).toBe(1);
    expect(videoTaskOps.get('a')).toBeUndefined();
  });

  it('按作品与状态过滤，按创建时间排序', () => {
    videoTaskOps.save(task('b', { createdAt: 3000 }));
    videoTaskOps.save(task('a', { createdAt: 2000, status: 'succeeded' }));
    videoTaskOps.save(task('c', { createdAt: 1000, workPath: '/p/novels/另一部' }));
    expect(videoTaskOps.list<Task>().map((t) => t.id)).toEqual(['c', 'a', 'b']);
    expect(videoTaskOps.list<Task>({ workPath: '/p/novels/作品' }).map((t) => t.id)).toEqual([
      'a',
      'b',
    ]);
    expect(videoTaskOps.list<Task>({ statuses: ['queued'] }).map((t) => t.id)).toEqual(['c', 'b']);
    expect(videoTaskOps.list<Task>({ statuses: [], limit: 1 }).map((t) => t.id)).toEqual(['c']);
  });

  it('损坏的 JSON 行被跳过', () => {
    videoTaskOps.save(task('a'));
    getDatabase().prepare("UPDATE video_tasks SET data_json = '{oops' WHERE id = 'a'").run();
    expect(videoTaskOps.get('a')).toBeUndefined();
    expect(videoTaskOps.list()).toEqual([]);
  });
});
