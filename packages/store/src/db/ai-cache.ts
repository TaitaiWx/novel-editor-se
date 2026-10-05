import { getDatabase } from './connection';

/** AI 缓存 */
export const aiCacheOps = {
  get(cacheKey: string, type: string): string | undefined {
    const row = getDatabase()
      .prepare('SELECT value FROM ai_cache WHERE cache_key = ? AND type = ?')
      .get(cacheKey, type) as { value: string } | undefined;
    return row?.value;
  },

  set(cacheKey: string, type: string, value: string) {
    return getDatabase()
      .prepare(
        `INSERT INTO ai_cache (cache_key, type, value) VALUES (?, ?, ?)
         ON CONFLICT(cache_key, type) DO UPDATE SET value = ?, created_at = datetime('now')`
      )
      .run(cacheKey, type, value, value);
  },

  delete(cacheKey: string, type: string) {
    return getDatabase()
      .prepare('DELETE FROM ai_cache WHERE cache_key = ? AND type = ?')
      .run(cacheKey, type);
  },

  getByType(type: string): { cache_key: string; value: string }[] {
    return getDatabase()
      .prepare('SELECT cache_key, value FROM ai_cache WHERE type = ?')
      .all(type) as { cache_key: string; value: string }[];
  },

  clearByType(type: string) {
    return getDatabase().prepare('DELETE FROM ai_cache WHERE type = ?').run(type);
  },

  /** Delete cache entries older than `maxAgeDays` days (TTL-based GC). */
  cleanup(maxAgeDays: number): number {
    const result = getDatabase()
      .prepare("DELETE FROM ai_cache WHERE created_at < datetime('now', ?)")
      .run(`-${maxAgeDays} days`);
    return result.changes;
  },

  /** Refresh `created_at` for actively used keys so TTL is extended. */
  touchKeys(keys: Array<{ cacheKey: string; type: string }>) {
    if (keys.length === 0) return;
    const db = getDatabase();
    const stmt = db.prepare(
      "UPDATE ai_cache SET created_at = datetime('now') WHERE cache_key = ? AND type = ?"
    );
    const run = db.transaction((items: Array<{ cacheKey: string; type: string }>) => {
      for (const item of items) {
        stmt.run(item.cacheKey, item.type);
      }
    });
    run(keys);
  },
};
