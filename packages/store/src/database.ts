import Database from 'better-sqlite3';
import { mkdirSync, unlinkSync } from 'fs';
import path from 'path';

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
      anchor_text TEXT DEFAULT '',
      line_hint INTEGER DEFAULT NULL,
      parent_id INTEGER DEFAULT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES outlines(id) ON DELETE SET NULL
    );

    -- 大纲版本中心（独立资产快照，不影响当前大纲主表）
    CREATE TABLE IF NOT EXISTS outline_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('import', 'rebuild', 'ai', 'manual')),
      note TEXT DEFAULT '',
      story_idea_card_id INTEGER DEFAULT NULL,
      story_idea_snapshot_json TEXT DEFAULT '',
      tree_json TEXT NOT NULL,
      total_nodes INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_outline_versions_novel_id_created_at
      ON outline_versions (novel_id, created_at DESC);

    -- 三签创作法：创意卡
    CREATE TABLE IF NOT EXISTS story_idea_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      premise TEXT DEFAULT '',
      tags_json TEXT DEFAULT '[]',
      source TEXT NOT NULL CHECK(source IN ('manual', 'ai')),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'exploring', 'shortlisted', 'promoted_to_board', 'promoted_to_outline', 'archived')),
      theme_seed TEXT DEFAULT '',
      conflict_seed TEXT DEFAULT '',
      twist_seed TEXT DEFAULT '',
      protagonist_wish TEXT DEFAULT '',
      core_obstacle TEXT DEFAULT '',
      irony_or_gap TEXT DEFAULT '',
      escalation_path TEXT DEFAULT '',
      payoff_hint TEXT DEFAULT '',
      selected_logline TEXT DEFAULT '',
      selected_direction TEXT DEFAULT '',
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_story_idea_cards_novel_id_updated_at
      ON story_idea_cards (novel_id, updated_at DESC, id DESC);

    -- 三签创作法：衍生候选
    CREATE TABLE IF NOT EXISTS story_idea_outputs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idea_card_id INTEGER NOT NULL,
      novel_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('logline', 'scene_hook', 'outline_direction')),
      content TEXT NOT NULL,
      meta_json TEXT DEFAULT '{}',
      sort_order INTEGER DEFAULT 0,
      is_selected INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (idea_card_id) REFERENCES story_idea_cards(id) ON DELETE CASCADE,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_story_idea_outputs_card_type
      ON story_idea_outputs (idea_card_id, type, sort_order, id);

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

    -- AI 缓存（标题补全 / 摘要等）
    CREATE TABLE IF NOT EXISTS ai_cache (
      cache_key TEXT NOT NULL,
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (cache_key, type)
    );

    CREATE INDEX IF NOT EXISTS idx_ai_cache_type
      ON ai_cache (type);
  `);

  migrateTables(database);
}

function hasColumn(database: Database.Database, tableName: string, columnName: string): boolean {
  const rows = database.pragma(`table_info(${tableName})`) as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

function migrateTables(database: Database.Database): void {
  if (!hasColumn(database, 'outlines', 'anchor_text')) {
    database.exec(`ALTER TABLE outlines ADD COLUMN anchor_text TEXT DEFAULT '';`);
  }
  if (!hasColumn(database, 'outlines', 'line_hint')) {
    database.exec(`ALTER TABLE outlines ADD COLUMN line_hint INTEGER DEFAULT NULL;`);
  }
  if (!hasColumn(database, 'outline_versions', 'story_idea_card_id')) {
    database.exec(
      `ALTER TABLE outline_versions ADD COLUMN story_idea_card_id INTEGER DEFAULT NULL;`
    );
  }
  if (!hasColumn(database, 'outline_versions', 'story_idea_snapshot_json')) {
    database.exec(
      `ALTER TABLE outline_versions ADD COLUMN story_idea_snapshot_json TEXT DEFAULT '';`
    );
  }
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
    const ALLOWED_COLS = new Set(['name', 'role', 'description', 'attributes']);
    const updates: string[] = [];
    const values: (string | number)[] = [];
    for (const [key, val] of Object.entries(fields)) {
      if (val !== undefined && ALLOWED_COLS.has(key)) {
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

/** 设定资料库 */
export const worldSettingOps = {
  create(novelId: number, category: string, title: string, content = '', tags = '[]') {
    return getDatabase()
      .prepare(
        'INSERT INTO world_settings (novel_id, category, title, content, tags) VALUES (?, ?, ?, ?, ?)'
      )
      .run(novelId, category, title, content, tags);
  },

  getByNovel(novelId: number) {
    return getDatabase()
      .prepare(
        'SELECT * FROM world_settings WHERE novel_id = ? ORDER BY datetime(updated_at) DESC, id DESC'
      )
      .all(novelId);
  },

  update(
    id: number,
    fields: { category?: string; title?: string; content?: string; tags?: string }
  ) {
    const ALLOWED_COLS = new Set(['category', 'title', 'content', 'tags']);
    const updates: string[] = [];
    const values: (string | number)[] = [];
    for (const [key, val] of Object.entries(fields)) {
      if (val !== undefined && ALLOWED_COLS.has(key)) {
        updates.push(`${key} = ?`);
        values.push(val);
      }
    }
    updates.push("updated_at = datetime('now')");
    values.push(id);
    return getDatabase()
      .prepare(`UPDATE world_settings SET ${updates.join(', ')} WHERE id = ?`)
      .run(...values);
  },

  delete(id: number) {
    return getDatabase().prepare('DELETE FROM world_settings WHERE id = ?').run(id);
  },

  bulkCreate(
    novelId: number,
    entries: Array<{ category: string; title: string; content?: string; tags?: string }>
  ) {
    if (entries.length === 0) {
      return { changes: 0 };
    }
    const stmt = getDatabase().prepare(
      'INSERT INTO world_settings (novel_id, category, title, content, tags) VALUES (?, ?, ?, ?, ?)'
    );
    const transaction = getDatabase().transaction(() => {
      for (const entry of entries) {
        stmt.run(novelId, entry.category, entry.title, entry.content || '', entry.tags || '[]');
      }
    });
    transaction();
    return { changes: entries.length };
  },
};

type OutlineTreeNode = {
  title: string;
  content?: string;
  anchorText?: string;
  lineHint?: number | null;
  sortOrder?: number;
  children?: OutlineTreeNode[];
};

export type OutlineVersionSource = 'import' | 'rebuild' | 'ai' | 'manual';

export type StoryIdeaCardSource = 'manual' | 'ai';
export type StoryIdeaCardStatus =
  | 'draft'
  | 'exploring'
  | 'shortlisted'
  | 'promoted_to_board'
  | 'promoted_to_outline'
  | 'archived';

export type StoryIdeaOutputType = 'logline' | 'scene_hook' | 'outline_direction';

export interface OutlineVersionRow {
  id: number;
  novel_id: number;
  name: string;
  source: OutlineVersionSource;
  note: string;
  story_idea_card_id: number | null;
  story_idea_snapshot_json: string;
  tree_json: string;
  total_nodes: number;
  created_at: string;
}

export interface StoryIdeaCardRow {
  id: number;
  novel_id: number;
  title: string;
  premise: string;
  tags_json: string;
  source: StoryIdeaCardSource;
  status: StoryIdeaCardStatus;
  theme_seed: string;
  conflict_seed: string;
  twist_seed: string;
  protagonist_wish: string;
  core_obstacle: string;
  irony_or_gap: string;
  escalation_path: string;
  payoff_hint: string;
  selected_logline: string;
  selected_direction: string;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface StoryIdeaOutputRow {
  id: number;
  idea_card_id: number;
  novel_id: number;
  type: StoryIdeaOutputType;
  content: string;
  meta_json: string;
  sort_order: number;
  is_selected: number;
  created_at: string;
  updated_at: string;
}

const OUTLINE_VERSION_SOURCES = ['import', 'rebuild', 'ai', 'manual'] as const;
const STORY_IDEA_CARD_SOURCES = ['manual', 'ai'] as const;
const STORY_IDEA_CARD_STATUSES = [
  'draft',
  'exploring',
  'shortlisted',
  'promoted_to_board',
  'promoted_to_outline',
  'archived',
] as const;
const STORY_IDEA_OUTPUT_TYPES = ['logline', 'scene_hook', 'outline_direction'] as const;

function countOutlineNodes(entries: OutlineTreeNode[]): number {
  let total = 0;
  const visit = (nodes: OutlineTreeNode[]) => {
    nodes.forEach((node) => {
      total += 1;
      if (Array.isArray(node.children) && node.children.length > 0) {
        visit(node.children);
      }
    });
  };
  visit(entries);
  return total;
}

/** 大纲树 */
export const outlineOps = {
  getByNovel(novelId: number) {
    return getDatabase()
      .prepare(
        `SELECT * FROM outlines
         WHERE novel_id = ?
         ORDER BY COALESCE(parent_id, id), sort_order, id`
      )
      .all(novelId);
  },

  clearByNovel(novelId: number) {
    return getDatabase().prepare('DELETE FROM outlines WHERE novel_id = ?').run(novelId);
  },

  reorder(ids: number[]) {
    const database = getDatabase();
    const stmt = database.prepare('UPDATE outlines SET sort_order = ? WHERE id = ?');
    const transaction = database.transaction(() => {
      ids.forEach((id, index) => stmt.run(index, id));
    });
    transaction();
  },

  replaceTree(novelId: number, entries: OutlineTreeNode[]) {
    const database = getDatabase();
    const deleteStmt = database.prepare('DELETE FROM outlines WHERE novel_id = ?');
    const insertStmt = database.prepare(
      'INSERT INTO outlines (novel_id, title, content, anchor_text, line_hint, parent_id, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );

    const insertNodes = (nodes: OutlineTreeNode[], parentId: number | null) => {
      nodes.forEach((node, index) => {
        const result = insertStmt.run(
          novelId,
          node.title,
          node.content || '',
          node.anchorText || '',
          node.lineHint ?? null,
          parentId,
          node.sortOrder ?? index
        );
        const insertedId = Number(result.lastInsertRowid);
        if (Array.isArray(node.children) && node.children.length > 0) {
          insertNodes(node.children, insertedId);
        }
      });
    };

    const transaction = database.transaction(() => {
      deleteStmt.run(novelId);
      if (entries.length > 0) {
        insertNodes(entries, null);
      }
    });

    transaction();
    return { changes: entries.length };
  },
};

/** 大纲版本中心 */
export const outlineVersionOps = {
  listByNovel(novelId: number) {
    return getDatabase()
      .prepare(
        `SELECT * FROM outline_versions
         WHERE novel_id = ?
         ORDER BY created_at DESC, id DESC`
      )
      .all(novelId) as OutlineVersionRow[];
  },

  create(
    novelId: number,
    name: string,
    source: OutlineVersionSource,
    note = '',
    entries: OutlineTreeNode[],
    options?: { storyIdeaCardId?: number | null; storyIdeaSnapshotJson?: string }
  ) {
    if (!OUTLINE_VERSION_SOURCES.includes(source)) {
      throw new Error(`Unsupported outline version source: ${source}`);
    }
    return getDatabase()
      .prepare(
        `INSERT INTO outline_versions (
          novel_id, name, source, note, story_idea_card_id, story_idea_snapshot_json, tree_json, total_nodes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        novelId,
        name,
        source,
        note,
        options?.storyIdeaCardId ?? null,
        options?.storyIdeaSnapshotJson || '',
        JSON.stringify(entries),
        countOutlineNodes(entries)
      );
  },

  getById(id: number): (OutlineVersionRow & { tree: OutlineTreeNode[] }) | undefined {
    const row = getDatabase().prepare('SELECT * FROM outline_versions WHERE id = ?').get(id) as
      | OutlineVersionRow
      | undefined;
    if (!row) return undefined;

    let tree: OutlineTreeNode[] = [];
    try {
      const parsed = JSON.parse(row.tree_json) as OutlineTreeNode[];
      tree = Array.isArray(parsed) ? parsed : [];
    } catch {
      tree = [];
    }

    return { ...row, tree };
  },

  update(id: number, fields: { name?: string; note?: string }) {
    const updates: string[] = [];
    const values: Array<string | number> = [];

    if (typeof fields.name === 'string') {
      updates.push('name = ?');
      values.push(fields.name);
    }
    if (typeof fields.note === 'string') {
      updates.push('note = ?');
      values.push(fields.note);
    }

    if (updates.length === 0) {
      return { changes: 0 };
    }

    values.push(id);
    return getDatabase()
      .prepare(`UPDATE outline_versions SET ${updates.join(', ')} WHERE id = ?`)
      .run(...values);
  },

  delete(id: number) {
    return getDatabase().prepare('DELETE FROM outline_versions WHERE id = ?').run(id);
  },
};

/** 三签创作法 */
export const storyIdeaOps = {
  listCardsByNovel(novelId: number) {
    return getDatabase()
      .prepare(
        `SELECT * FROM story_idea_cards
         WHERE novel_id = ?
         ORDER BY datetime(updated_at) DESC, id DESC`
      )
      .all(novelId) as StoryIdeaCardRow[];
  },

  getCardById(id: number) {
    return getDatabase().prepare('SELECT * FROM story_idea_cards WHERE id = ?').get(id) as
      | StoryIdeaCardRow
      | undefined;
  },

  createCard(
    novelId: number,
    payload: {
      title: string;
      premise?: string;
      tagsJson?: string;
      source?: StoryIdeaCardSource;
      status?: StoryIdeaCardStatus;
      themeSeed?: string;
      conflictSeed?: string;
      twistSeed?: string;
      protagonistWish?: string;
      coreObstacle?: string;
      ironyOrGap?: string;
      escalationPath?: string;
      payoffHint?: string;
      selectedLogline?: string;
      selectedDirection?: string;
      note?: string;
    }
  ) {
    const source = payload.source ?? 'manual';
    const status = payload.status ?? 'draft';
    if (!STORY_IDEA_CARD_SOURCES.includes(source)) {
      throw new Error(`Unsupported story idea source: ${source}`);
    }
    if (!STORY_IDEA_CARD_STATUSES.includes(status)) {
      throw new Error(`Unsupported story idea status: ${status}`);
    }
    return getDatabase()
      .prepare(
        `INSERT INTO story_idea_cards (
          novel_id, title, premise, tags_json, source, status,
          theme_seed, conflict_seed, twist_seed,
          protagonist_wish, core_obstacle, irony_or_gap,
          escalation_path, payoff_hint,
          selected_logline, selected_direction, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        novelId,
        payload.title,
        payload.premise || '',
        payload.tagsJson || '[]',
        source,
        status,
        payload.themeSeed || '',
        payload.conflictSeed || '',
        payload.twistSeed || '',
        payload.protagonistWish || '',
        payload.coreObstacle || '',
        payload.ironyOrGap || '',
        payload.escalationPath || '',
        payload.payoffHint || '',
        payload.selectedLogline || '',
        payload.selectedDirection || '',
        payload.note || ''
      );
  },

  updateCard(
    id: number,
    fields: {
      title?: string;
      premise?: string;
      tags_json?: string;
      source?: StoryIdeaCardSource;
      status?: StoryIdeaCardStatus;
      theme_seed?: string;
      conflict_seed?: string;
      twist_seed?: string;
      protagonist_wish?: string;
      core_obstacle?: string;
      irony_or_gap?: string;
      escalation_path?: string;
      payoff_hint?: string;
      selected_logline?: string;
      selected_direction?: string;
      note?: string;
    }
  ) {
    const ALLOWED_COLS = new Set([
      'title',
      'premise',
      'tags_json',
      'source',
      'status',
      'theme_seed',
      'conflict_seed',
      'twist_seed',
      'protagonist_wish',
      'core_obstacle',
      'irony_or_gap',
      'escalation_path',
      'payoff_hint',
      'selected_logline',
      'selected_direction',
      'note',
    ]);
    const updates: string[] = [];
    const values: Array<string | number> = [];
    for (const [key, val] of Object.entries(fields)) {
      if (val === undefined || !ALLOWED_COLS.has(key)) {
        continue;
      }
      if (key === 'source' && !STORY_IDEA_CARD_SOURCES.includes(val as StoryIdeaCardSource)) {
        throw new Error(`Unsupported story idea source: ${String(val)}`);
      }
      if (key === 'status' && !STORY_IDEA_CARD_STATUSES.includes(val as StoryIdeaCardStatus)) {
        throw new Error(`Unsupported story idea status: ${String(val)}`);
      }
      updates.push(`${key} = ?`);
      values.push(val as string | number);
    }
    if (updates.length === 0) {
      return { changes: 0 };
    }
    updates.push("updated_at = datetime('now')");
    values.push(id);
    return getDatabase()
      .prepare(`UPDATE story_idea_cards SET ${updates.join(', ')} WHERE id = ?`)
      .run(...values);
  },

  deleteCard(id: number) {
    return getDatabase().prepare('DELETE FROM story_idea_cards WHERE id = ?').run(id);
  },

  listOutputsByCard(ideaCardId: number) {
    return getDatabase()
      .prepare(
        `SELECT * FROM story_idea_outputs
         WHERE idea_card_id = ?
         ORDER BY type, sort_order, id`
      )
      .all(ideaCardId) as StoryIdeaOutputRow[];
  },

  replaceOutputs(
    novelId: number,
    ideaCardId: number,
    type: StoryIdeaOutputType,
    outputs: Array<{ content: string; metaJson?: string; isSelected?: boolean }>
  ) {
    if (!STORY_IDEA_OUTPUT_TYPES.includes(type)) {
      throw new Error(`Unsupported story idea output type: ${type}`);
    }
    const database = getDatabase();
    const deleteStmt = database.prepare(
      'DELETE FROM story_idea_outputs WHERE idea_card_id = ? AND type = ?'
    );
    const insertStmt = database.prepare(
      `INSERT INTO story_idea_outputs (
        idea_card_id, novel_id, type, content, meta_json, sort_order, is_selected
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const transaction = database.transaction(() => {
      deleteStmt.run(ideaCardId, type);
      outputs.forEach((output, index) => {
        insertStmt.run(
          ideaCardId,
          novelId,
          type,
          output.content,
          output.metaJson || '{}',
          index,
          output.isSelected ? 1 : 0
        );
      });
    });
    transaction();
    return { changes: outputs.length };
  },

  updateOutput(
    id: number,
    fields: { content?: string; meta_json?: string; sort_order?: number; is_selected?: number }
  ) {
    const ALLOWED_COLS = new Set(['content', 'meta_json', 'sort_order', 'is_selected']);
    const updates: string[] = [];
    const values: Array<string | number> = [];
    for (const [key, val] of Object.entries(fields)) {
      if (val === undefined || !ALLOWED_COLS.has(key)) {
        continue;
      }
      updates.push(`${key} = ?`);
      values.push(val as string | number);
    }
    if (updates.length === 0) {
      return { changes: 0 };
    }
    updates.push("updated_at = datetime('now')");
    values.push(id);
    return getDatabase()
      .prepare(`UPDATE story_idea_outputs SET ${updates.join(', ')} WHERE id = ?`)
      .run(...values);
  },

  clearOutputSelection(ideaCardId: number, type: StoryIdeaOutputType) {
    if (!STORY_IDEA_OUTPUT_TYPES.includes(type)) {
      throw new Error(`Unsupported story idea output type: ${type}`);
    }
    return getDatabase()
      .prepare(
        `UPDATE story_idea_outputs
         SET is_selected = 0, updated_at = datetime('now')
         WHERE idea_card_id = ? AND type = ?`
      )
      .run(ideaCardId, type);
  },

  selectOutput(id: number) {
    const row = getDatabase()
      .prepare('SELECT idea_card_id, type FROM story_idea_outputs WHERE id = ?')
      .get(id) as { idea_card_id: number; type: StoryIdeaOutputType } | undefined;
    if (!row) {
      return { changes: 0 };
    }
    const database = getDatabase();
    const transaction = database.transaction(() => {
      database
        .prepare(
          `UPDATE story_idea_outputs
           SET is_selected = 0, updated_at = datetime('now')
           WHERE idea_card_id = ? AND type = ?`
        )
        .run(row.idea_card_id, row.type);
      database
        .prepare(
          `UPDATE story_idea_outputs
           SET is_selected = 1, updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(id);
    });
    transaction();
    return { changes: 1 };
  },

  deleteOutput(id: number) {
    return getDatabase().prepare('DELETE FROM story_idea_outputs WHERE id = ?').run(id);
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

// ========== 导出/导入 ==========

export interface ExportData {
  version: string;
  exported_at: string;
  novels: Record<string, unknown>[];
  characters: Record<string, unknown>[];
  acts: Record<string, unknown>[];
  scenes: Record<string, unknown>[];
  outlines: Record<string, unknown>[];
  outline_versions?: Record<string, unknown>[];
  story_idea_cards?: Record<string, unknown>[];
  story_idea_outputs?: Record<string, unknown>[];
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
    outline_versions: database.prepare('SELECT * FROM outline_versions').all() as Record<
      string,
      unknown
    >[],
    story_idea_cards: database.prepare('SELECT * FROM story_idea_cards').all() as Record<
      string,
      unknown
    >[],
    story_idea_outputs: database.prepare('SELECT * FROM story_idea_outputs').all() as Record<
      string,
      unknown
    >[],
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
    'story_idea_outputs',
    'story_idea_cards',
    'outline_versions',
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
    insertRows('outline_versions', data.outline_versions || []);
    insertRows('story_idea_cards', data.story_idea_cards || []);
    insertRows('story_idea_outputs', data.story_idea_outputs || []);
    insertRows('world_settings', data.world_settings);
    insertRows('writing_stats', data.writing_stats);
    insertRows('settings', data.settings);
    insertRows('version_blobs', data.version_blobs || []);
    insertRows('version_snapshots', data.version_snapshots || []);
    insertRows('version_entries', data.version_entries || []);
  })();
}
