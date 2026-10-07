/**
 * 视频生成任务持久化（表 video_tasks）
 *
 * store 不依赖 @novel-editor/video：只认识任务的几个索引字段，完整任务对象以 JSON 保存，
 * 由主进程按 @novel-editor/video 的 VideoTask 类型解析。
 */
import { getDatabase } from './connection';

export interface VideoTaskRecordLike {
  id: string;
  providerId: string;
  workPath: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

interface VideoTaskRow {
  id: string;
  data_json: string;
}

function parseRow<T>(row: VideoTaskRow | undefined): T | undefined {
  if (!row) return undefined;
  try {
    return JSON.parse(row.data_json) as T;
  } catch {
    return undefined;
  }
}

function parseRows<T>(rows: VideoTaskRow[]): T[] {
  return rows.map((row) => parseRow<T>(row)).filter((item): item is T => item !== undefined);
}

export const videoTaskOps = {
  /** 新增或整体覆盖一条任务 */
  save<T extends VideoTaskRecordLike>(task: T) {
    return getDatabase()
      .prepare(
        `INSERT INTO video_tasks (id, provider_id, work_path, status, data_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           provider_id = excluded.provider_id,
           work_path = excluded.work_path,
           status = excluded.status,
           data_json = excluded.data_json,
           updated_at = excluded.updated_at`
      )
      .run(
        task.id,
        task.providerId,
        task.workPath,
        task.status,
        JSON.stringify(task),
        Math.round(task.createdAt),
        Math.round(task.updatedAt)
      );
  },

  get<T>(id: string): T | undefined {
    return parseRow<T>(
      getDatabase().prepare('SELECT id, data_json FROM video_tasks WHERE id = ?').get(id) as
        | VideoTaskRow
        | undefined
    );
  },

  /** 按创建时间排序；可按作品目录与状态过滤 */
  list<T>(filter: { workPath?: string; statuses?: readonly string[]; limit?: number } = {}): T[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (filter.workPath) {
      clauses.push('work_path = ?');
      params.push(filter.workPath);
    }
    if (filter.statuses && filter.statuses.length > 0) {
      clauses.push(`status IN (${filter.statuses.map(() => '?').join(', ')})`);
      params.push(...filter.statuses);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = filter.limit && filter.limit > 0 ? `LIMIT ${Math.floor(filter.limit)}` : '';
    const rows = getDatabase()
      .prepare(
        `SELECT id, data_json FROM video_tasks ${where} ORDER BY created_at ASC, id ASC ${limit}`
      )
      .all(...params) as VideoTaskRow[];
    return parseRows<T>(rows);
  },

  delete(id: string) {
    return getDatabase().prepare('DELETE FROM video_tasks WHERE id = ?').run(id);
  },
};
