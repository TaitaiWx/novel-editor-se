/** SQLite 连接管理：初始化、获取、关闭 */
import Database from 'better-sqlite3';
import { mkdirSync, unlinkSync } from 'fs';
import path from 'path';
import { createTables } from './schema';

let db: Database.Database | null = null;
let currentDbPath: string | null = null;

/**
 * 初始化 SQLite 数据库连接
 * @param dbDir 数据库文件所在目录
 * @param dbName 数据库文件名（默认 novel-editor.db）
 * @param nativeBinding 原生模块 .node 文件的绝对路径（用于打包后的 Electron 应用绕过 bindings 解析）
 */
export function initDatabase(
  dbDir: string,
  dbName = 'novel-editor.db',
  nativeBinding?: string
): Database.Database {
  const dbPath = path.join(dbDir, dbName);
  mkdirSync(dbDir, { recursive: true });

  if (db && currentDbPath === dbPath) return db;

  if (db && currentDbPath !== dbPath) {
    db.close();
    db = null;
  }

  db = new Database(dbPath, nativeBinding ? { nativeBinding } : undefined);
  currentDbPath = dbPath;

  // 启用 WAL 模式以获得更好的并发性能
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  try {
    createTables(db);
  } catch (err) {
    // 数据库文件可能损坏——关闭、删除后重建
    console.warn('createTables failed, recreating database:', err);
    db.close();
    try {
      unlinkSync(dbPath);
    } catch {
      /* 忽略 */
    }
    try {
      unlinkSync(dbPath + '-wal');
    } catch {
      /* 忽略 */
    }
    try {
      unlinkSync(dbPath + '-shm');
    } catch {
      /* 忽略 */
    }
    db = new Database(dbPath, nativeBinding ? { nativeBinding } : undefined);
    currentDbPath = dbPath;
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    createTables(db);
  }
  return db;
}

/** 数据库是否已初始化 */
export function isDatabaseReady(): boolean {
  return db !== null;
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
