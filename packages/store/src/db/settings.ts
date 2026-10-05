import { getDatabase } from './connection';

/** 设置 */
export const settingsOps = {
  get(key: string): string | undefined {
    const row = getDatabase().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  },

  set(key: string, value: string) {
    return getDatabase()
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
      )
      .run(key, value, value);
  },

  delete(key: string) {
    return getDatabase().prepare('DELETE FROM settings WHERE key = ?').run(key);
  },

  deleteByPrefixes(prefixes: string[]) {
    let removed = 0;
    for (const prefix of prefixes) {
      const result = getDatabase()
        .prepare('DELETE FROM settings WHERE key LIKE ?')
        .run(`${prefix}%`);
      removed += result.changes;
    }
    return removed;
  },

  deleteAll() {
    return getDatabase().prepare('DELETE FROM settings').run();
  },

  getAll() {
    return getDatabase().prepare('SELECT * FROM settings').all() as {
      key: string;
      value: string;
    }[];
  },
};
