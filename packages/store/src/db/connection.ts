/** SQLite 连接管理：初始化、获取、关闭 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import path from 'path';
import { createTables } from './schema';
import { relocateBackupDatabase, type BackupRoots } from './relocate-backup';

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

  closeDatabase();

  const candidate = new Database(dbPath, nativeBinding ? { nativeBinding } : undefined);
  try {
    // 初始化全部成功后才发布连接，避免失败连接被后续调用复用。
    candidate.pragma('journal_mode = WAL');
    candidate.pragma('foreign_keys = ON');
    createTables(candidate);
  } catch (err) {
    // SQL / 迁移错误不代表数据库损坏；保留原库供重试或恢复，绝不删库重建。
    try {
      candidate.close();
    } catch {
      // 关闭失败也应向调用方报告最初的初始化错误。
    }
    throw err;
  }
  db = candidate;
  currentDbPath = dbPath;
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

/** SQLite online backup includes committed WAL pages and never copies live sidecar files. */
export async function backupDatabaseFile(
  sourcePath: string,
  destinationPath: string,
  nativeBinding?: string,
  roots?: BackupRoots
): Promise<void> {
  const current =
    db && currentDbPath && path.resolve(currentDbPath) === path.resolve(sourcePath) ? db : null;
  // Do not initialize/migrate an inactive project merely to export it.
  const connection =
    current ??
    new Database(sourcePath, {
      readonly: true,
      fileMustExist: true,
      ...(nativeBinding ? { nativeBinding } : {}),
    });
  try {
    await connection.backup(destinationPath);
    if (roots) {
      const snapshot = new Database(destinationPath, nativeBinding ? { nativeBinding } : undefined);
      try {
        relocateBackupDatabase(snapshot, roots);
        snapshot.pragma('journal_mode = DELETE');
      } finally {
        snapshot.close();
      }
    }
  } finally {
    if (!current) connection.close();
  }
}
