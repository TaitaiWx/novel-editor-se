/** An exported copy must never resume the source project's paid remote jobs automatically. */
import type Database from 'better-sqlite3';

export function pauseExportedVideoTasks(database: Database.Database): void {
  const columns = database.pragma('table_info(video_tasks)') as Array<{ name: string }>;
  if (!columns.some(({ name }) => name === 'data_json')) return;
  const rows = database.prepare('SELECT id, data_json FROM video_tasks').all() as Array<{
    id: string;
    data_json: string;
  }>;
  const update = database.prepare('UPDATE video_tasks SET status = ?, data_json = ? WHERE id = ?');
  for (const row of rows) {
    const task = JSON.parse(row.data_json) as Record<string, unknown>;
    // Same terminal rule as @novel-editor/video: succeeded is terminal only after download.
    if (
      task.status === 'failed' ||
      task.status === 'cancelled' ||
      (task.status === 'succeeded' && task.outputPath)
    )
      continue;
    task.exportOrigin = { sourceWorkPath: task.workPath, sourceStatus: task.status };
    task.status = 'failed';
    task.error = {
      code: 'export-paused',
      message: '导出副本的任务已暂停，请确认后重试。重试会重新生成，可能再次计费。',
      retryable: true,
    };
    delete task.nextRunAt;
    // Retain remoteTaskId/resultUrl and generation parameters for diagnosis; only explicit retry requeues.
    update.run('failed', JSON.stringify(task), row.id);
  }
}
