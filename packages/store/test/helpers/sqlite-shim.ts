/**
 * 测试专用：用 Node 内置的 node:sqlite 模拟 better-sqlite3 的最小 API。
 *
 * 仓库中的 better-sqlite3 由 electron-rebuild 针对 Electron ABI 编译，
 * 在纯 Node 下无法加载，因此测试里用该 shim 替代，验证真实 SQL 行为。
 */
import { createRequire } from 'module';

type SqlValue = string | number | bigint | null | Uint8Array;

interface NodeStatement {
  run(...params: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: SqlValue[]): Record<string, unknown> | undefined;
  all(...params: SqlValue[]): Record<string, unknown>[];
}

interface NodeDatabase {
  exec(sql: string): void;
  prepare(sql: string): NodeStatement;
  close(): void;
}

type NodeDatabaseCtor = new (path: string) => NodeDatabase;

function loadNodeSqlite(): NodeDatabaseCtor | null {
  try {
    const require = createRequire(import.meta.url);
    const mod = require('node:sqlite') as { DatabaseSync?: NodeDatabaseCtor };
    return mod.DatabaseSync ?? null;
  } catch {
    return null;
  }
}

const DatabaseSync = loadNodeSqlite();

/** 当前 Node 是否提供 node:sqlite */
export const sqliteAvailable = DatabaseSync !== null;

function toPlain(row: Record<string, unknown> | undefined) {
  return row ? { ...row } : row;
}

class ShimStatement {
  constructor(private readonly stmt: NodeStatement) {}

  run(...params: SqlValue[]) {
    const result = this.stmt.run(...params);
    return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
  }

  get(...params: SqlValue[]) {
    return toPlain(this.stmt.get(...params));
  }

  all(...params: SqlValue[]) {
    return this.stmt.all(...params).map((row) => ({ ...row }));
  }
}

export class SqliteShim {
  private readonly db: NodeDatabase;
  private inTransaction = false;

  constructor(path: string, _options?: unknown) {
    if (!DatabaseSync) {
      throw new Error('node:sqlite 不可用');
    }
    this.db = new DatabaseSync(path);
  }

  pragma(source: string) {
    return this.db
      .prepare(`PRAGMA ${source}`)
      .all()
      .map((row) => ({ ...row }));
  }

  exec(sql: string) {
    this.db.exec(sql);
    return this;
  }

  prepare(sql: string) {
    return new ShimStatement(this.db.prepare(sql));
  }

  transaction<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult) {
    return (...args: TArgs): TResult => {
      // 嵌套事务直接复用外层事务
      if (this.inTransaction) {
        return fn(...args);
      }
      this.db.exec('BEGIN');
      this.inTransaction = true;
      try {
        const result = fn(...args);
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      } finally {
        this.inTransaction = false;
      }
    };
  }

  async backup(destination: string): Promise<void> {
    const require = createRequire(import.meta.url);
    const { backup } = require('node:sqlite') as {
      backup: (db: NodeDatabase, destination: string) => Promise<number>;
    };
    await backup(this.db, destination);
  }

  close() {
    this.db.close();
  }
}
