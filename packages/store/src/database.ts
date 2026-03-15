import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import path from 'path';

let db: Database.Database | null = null;
let currentDbPath: string | null = null;

/**
 * 初始化 SQLite 数据库连接
 * @param dbDir 数据库文件所在目录
 * @param dbName 数据库文件名（默认 novel-editor.db）
 */
export function initDatabase(dbDir: string, dbName = 'novel-editor.db'): Database.Database {
  const dbPath = path.join(dbDir, dbName);
  mkdirSync(dbDir, { recursive: true });

  if (db && currentDbPath === dbPath) return db;

  if (db && currentDbPath !== dbPath) {
    db.close();
    db = null;
  }

  db = new Database(dbPath);
  currentDbPath = dbPath;

  // 启用 WAL 模式以获得更好的并发性能
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables(db);
  return db;
}

/** 获取当前数据库实例 */
export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

/** 关闭数据库连接 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    currentDbPath = null;
  }
}

/** 创建表结构 */
function createTables(database: Database.Database): void {
  database.exec(`
    -- 作品/项目
    CREATE TABLE IF NOT EXISTS novels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      folder_path TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- 角色
    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT '',
      description TEXT DEFAULT '',
      attributes TEXT DEFAULT '{}',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    -- 幕/剧结构
    CREATE TABLE IF NOT EXISTS acts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    -- 场景
    CREATE TABLE IF NOT EXISTS scenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      act_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      summary TEXT DEFAULT '',
      file_path TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (act_id) REFERENCES acts(id) ON DELETE CASCADE
    );

    -- 大纲
    CREATE TABLE IF NOT EXISTS outlines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      parent_id INTEGER DEFAULT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES outlines(id) ON DELETE SET NULL
    );

    -- 设定资料库（规则、技能、世界观等）
    CREATE TABLE IF NOT EXISTS world_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    -- 写作统计
    CREATE TABLE IF NOT EXISTS writing_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      word_count INTEGER DEFAULT 0,
      duration_seconds INTEGER DEFAULT 0,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
      UNIQUE(novel_id, date)
    );

    -- 用户设置
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- 版本快照（项目级）
    CREATE TABLE IF NOT EXISTS version_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      total_files INTEGER DEFAULT 0,
      total_bytes INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    -- 内容寻址的 Blob 存储，用于文本、图片、音频和其他二进制素材去重
    CREATE TABLE IF NOT EXISTS version_blobs (
      content_hash TEXT PRIMARY KEY,
      content BLOB NOT NULL,
      byte_size INTEGER NOT NULL,
      is_binary INTEGER NOT NULL DEFAULT 0,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 每个快照内的文件清单
    CREATE TABLE IF NOT EXISTS version_entries (
      snapshot_id INTEGER NOT NULL,
      relative_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      is_binary INTEGER NOT NULL DEFAULT 0,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      PRIMARY KEY (snapshot_id, relative_path),
      FOREIGN KEY (snapshot_id) REFERENCES version_snapshots(id) ON DELETE CASCADE,
      FOREIGN KEY (content_hash) REFERENCES version_blobs(content_hash) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_version_snapshots_novel_id_created_at
      ON version_snapshots (novel_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_version_entries_relative_path
      ON version_entries (relative_path);
    CREATE INDEX IF NOT EXISTS idx_version_entries_content_hash
      ON version_entries (content_hash);
  `);
}

// ========== CRUD 操作 ==========

/** 小说/项目 */
export const novelOps = {
  create(name: string, folderPath: string, description = '') {
    const stmt = getDatabase().prepare(
      'INSERT INTO novels (name, folder_path, description) VALUES (?, ?, ?)'
    );
    return stmt.run(name, folderPath, description);
  },

  getAll() {
    return getDatabase().prepare('SELECT * FROM novels ORDER BY updated_at DESC').all();
  },

  getById(id: number) {
    return getDatabase().prepare('SELECT * FROM novels WHERE id = ?').get(id);
  },

  getByFolder(folderPath: string) {
    return getDatabase().prepare('SELECT * FROM novels WHERE folder_path = ?').get(folderPath);
  },

  update(id: number, fields: { name?: string; description?: string }) {
    const updates: string[] = [];
    const values: (string | number)[] = [];
    if (fields.name !== undefined) {
      updates.push('name = ?');
      values.push(fields.name);
    }
    if (fields.description !== undefined) {
      updates.push('description = ?');
      values.push(fields.description);
    }
    updates.push("updated_at = datetime('now')");
    values.push(id);
    return getDatabase()
      .prepare(`UPDATE novels SET ${updates.join(', ')} WHERE id = ?`)
      .run(...values);
  },

  delete(id: number) {
    return getDatabase().prepare('DELETE FROM novels WHERE id = ?').run(id);
  },
};

/** 角色 */
export const characterOps = {
  create(novelId: number, name: string, role = '', description = '', attributes = '{}') {
    const maxOrder = getDatabase()
      .prepare('SELECT MAX(sort_order) as max FROM characters WHERE novel_id = ?')
      .get(novelId) as { max: number | null };
    const sortOrder = (maxOrder?.max ?? -1) + 1;
    return getDatabase()
      .prepare(
        'INSERT INTO characters (novel_id, name, role, description, attributes, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(novelId, name, role, description, attributes, sortOrder);
  },

  getByNovel(novelId: number) {
    return getDatabase()
      .prepare('SELECT * FROM characters WHERE novel_id = ? ORDER BY sort_order')
      .all(novelId);
  },

  update(
    id: number,
    fields: { name?: string; role?: string; description?: string; attributes?: string }
  ) {
    const updates: string[] = [];
    const values: (string | number)[] = [];
    for (const [key, val] of Object.entries(fields)) {
      if (val !== undefined) {
        updates.push(`${key} = ?`);
        values.push(val);
      }
    }
    updates.push("updated_at = datetime('now')");
    values.push(id);
    return getDatabase()
      .prepare(`UPDATE characters SET ${updates.join(', ')} WHERE id = ?`)
      .run(...values);
  },

  reorder(ids: number[]) {
    const stmt = getDatabase().prepare('UPDATE characters SET sort_order = ? WHERE id = ?');
    const transaction = getDatabase().transaction(() => {
      ids.forEach((id, index) => stmt.run(index, id));
    });
    transaction();
  },

  delete(id: number) {
    return getDatabase().prepare('DELETE FROM characters WHERE id = ?').run(id);
  },
};

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

  getAll() {
    return getDatabase().prepare('SELECT * FROM settings').all() as {
      key: string;
      value: string;
    }[];
  },
};

// ========== 导出/导入 ==========

export interface ExportData {
  version: string;
  exported_at: string;
  novels: Record<string, unknown>[];
  characters: Record<string, unknown>[];
  acts: Record<string, unknown>[];
  scenes: Record<string, unknown>[];
  outlines: Record<string, unknown>[];
  world_settings: Record<string, unknown>[];
  writing_stats: Record<string, unknown>[];
  settings: Record<string, unknown>[];
  version_snapshots: Record<string, unknown>[];
  version_entries: Record<string, unknown>[];
  version_blobs: Record<string, unknown>[];
}

/** 导出所有数据为 JSON（方便迁移） */
export function exportAllData(): ExportData {
  const database = getDatabase();
  return {
    version: '1.0.0',
    exported_at: new Date().toISOString(),
    novels: database.prepare('SELECT * FROM novels').all() as Record<string, unknown>[],
    characters: database.prepare('SELECT * FROM characters').all() as Record<string, unknown>[],
    acts: database.prepare('SELECT * FROM acts').all() as Record<string, unknown>[],
    scenes: database.prepare('SELECT * FROM scenes').all() as Record<string, unknown>[],
    outlines: database.prepare('SELECT * FROM outlines').all() as Record<string, unknown>[],
    world_settings: database.prepare('SELECT * FROM world_settings').all() as Record<
      string,
      unknown
    >[],
    writing_stats: database.prepare('SELECT * FROM writing_stats').all() as Record<
      string,
      unknown
    >[],
    settings: database.prepare('SELECT * FROM settings').all() as Record<string, unknown>[],
    version_snapshots: database.prepare('SELECT * FROM version_snapshots').all() as Record<
      string,
      unknown
    >[],
    version_entries: database.prepare('SELECT * FROM version_entries').all() as Record<
      string,
      unknown
    >[],
    version_blobs: database.prepare('SELECT * FROM version_blobs').all() as Record<
      string,
      unknown
    >[],
  };
}

/** 从 JSON 导入数据 */
export function importData(data: ExportData): void {
  const database = getDatabase();
  const tables = [
    'version_entries',
    'version_snapshots',
    'version_blobs',
    'settings',
    'writing_stats',
    'world_settings',
    'outlines',
    'scenes',
    'acts',
    'characters',
    'novels',
  ];

  database.transaction(() => {
    // 清空现有数据（按外键约束倒序）
    for (const table of tables) {
      database.prepare(`DELETE FROM ${table}`).run();
    }

    // 按正序插入
    const insertRows = (table: string, rows: Record<string, unknown>[]) => {
      if (rows.length === 0) return;
      const columns = Object.keys(rows[0]);
      const placeholders = columns.map(() => '?').join(', ');
      const stmt = database.prepare(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`
      );
      for (const row of rows) {
        stmt.run(...columns.map((col) => row[col]));
      }
    };

    insertRows('novels', data.novels);
    insertRows('characters', data.characters);
    insertRows('acts', data.acts);
    insertRows('scenes', data.scenes);
    insertRows('outlines', data.outlines);
    insertRows('world_settings', data.world_settings);
    insertRows('writing_stats', data.writing_stats);
    insertRows('settings', data.settings);
    insertRows('version_blobs', data.version_blobs || []);
    insertRows('version_snapshots', data.version_snapshots || []);
    insertRows('version_entries', data.version_entries || []);
  })();
}
