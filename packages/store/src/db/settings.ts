import { getDatabase } from './connection';
import Database from 'better-sqlite3';

function writeSetting(database: Database.Database, key: string, value: string) {
  return database
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
    )
    .run(key, value, value);
}

/** 设置 */
export const settingsOps = {
  get(key: string): string | undefined {
    const row = getDatabase().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  },

  set(key: string, value: string) {
    return writeSetting(getDatabase(), key, value);
  },

  /** Finish a queued save to an existing, leased DB without changing the active connection. */
  setAtPath(databasePath: string, key: string, value: string, nativeBinding?: string) {
    const database = new Database(databasePath, {
      fileMustExist: true,
      ...(nativeBinding ? { nativeBinding } : {}),
    });
    try {
      return writeSetting(database, key, value);
    } finally {
      database.close();
    }
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
