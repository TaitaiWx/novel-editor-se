import { getDatabase } from './connection';

/** 写作统计 */
export const statsOps = {
  record(novelId: number, date: string, wordCount: number, durationSeconds: number) {
    return getDatabase()
      .prepare(
        `INSERT INTO writing_stats (novel_id, date, word_count, duration_seconds)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(novel_id, date) DO UPDATE SET
           word_count = word_count + excluded.word_count,
           duration_seconds = duration_seconds + excluded.duration_seconds`
      )
      .run(novelId, date, wordCount, durationSeconds);
  },

  getByNovelAndRange(novelId: number, startDate: string, endDate: string) {
    return getDatabase()
      .prepare(
        'SELECT * FROM writing_stats WHERE novel_id = ? AND date BETWEEN ? AND ? ORDER BY date'
      )
      .all(novelId, startDate, endDate);
  },

  getToday(novelId: number) {
    const today = new Date().toISOString().slice(0, 10);
    return getDatabase()
      .prepare('SELECT * FROM writing_stats WHERE novel_id = ? AND date = ?')
      .get(novelId, today);
  },
};
