/** 表结构定义与增量迁移 */
import type Database from 'better-sqlite3';

/** 创建表结构 */
export function createTables(database: Database.Database): void {
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
      scope_kind TEXT NOT NULL DEFAULT 'project' CHECK(scope_kind IN ('project', 'volume', 'chapter')),
      scope_path TEXT NOT NULL DEFAULT '',
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
    CREATE INDEX IF NOT EXISTS idx_outlines_novel_scope
      ON outlines (novel_id, scope_kind, scope_path, sort_order, id);

    -- 大纲版本中心（独立资产快照，不影响当前大纲主表）
    CREATE TABLE IF NOT EXISTS outline_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL,
      scope_kind TEXT NOT NULL DEFAULT 'project' CHECK(scope_kind IN ('project', 'volume', 'chapter')),
      scope_path TEXT NOT NULL DEFAULT '',
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
    CREATE INDEX IF NOT EXISTS idx_outline_versions_novel_scope_created_at
      ON outline_versions (novel_id, scope_kind, scope_path, created_at DESC, id DESC);

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

export function hasColumn(
  database: Database.Database,
  tableName: string,
  columnName: string
): boolean {
  const rows = database.pragma(`table_info(${tableName})`) as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

/**
 * 视频生成任务（场景视频）：任务状态机在 @novel-editor/video，这里只做持久化。
 * data_json 保存完整任务对象，其余列用于查询；用 IF NOT EXISTS 兼容旧数据库（增量迁移）
 */
function createVideoTaskTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS video_tasks (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      work_path TEXT NOT NULL,
      status TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_video_tasks_status ON video_tasks (status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_video_tasks_work_path ON video_tasks (work_path, created_at DESC);
  `);
}

function migrateTables(database: Database.Database): void {
  createVideoTaskTable(database);
  if (!hasColumn(database, 'outlines', 'scope_kind')) {
    database.exec(`ALTER TABLE outlines ADD COLUMN scope_kind TEXT DEFAULT 'project';`);
  }
  if (!hasColumn(database, 'outlines', 'scope_path')) {
    database.exec(`ALTER TABLE outlines ADD COLUMN scope_path TEXT DEFAULT '';`);
  }
  if (!hasColumn(database, 'outlines', 'anchor_text')) {
    database.exec(`ALTER TABLE outlines ADD COLUMN anchor_text TEXT DEFAULT '';`);
  }
  if (!hasColumn(database, 'outlines', 'line_hint')) {
    database.exec(`ALTER TABLE outlines ADD COLUMN line_hint INTEGER DEFAULT NULL;`);
  }
  if (!hasColumn(database, 'outline_versions', 'scope_kind')) {
    database.exec(`ALTER TABLE outline_versions ADD COLUMN scope_kind TEXT DEFAULT 'project';`);
  }
  if (!hasColumn(database, 'outline_versions', 'scope_path')) {
    database.exec(`ALTER TABLE outline_versions ADD COLUMN scope_path TEXT DEFAULT '';`);
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
  database.exec(
    `UPDATE outlines SET scope_kind = 'project'
     WHERE scope_kind IS NULL OR scope_kind NOT IN ('project', 'volume', 'chapter');`
  );
  database.exec(
    `UPDATE outline_versions SET scope_kind = 'project'
     WHERE scope_kind IS NULL OR scope_kind NOT IN ('project', 'volume', 'chapter');`
  );
  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_outlines_novel_scope
      ON outlines (novel_id, scope_kind, scope_path, sort_order, id);`
  );
  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_outline_versions_novel_scope_created_at
      ON outline_versions (novel_id, scope_kind, scope_path, created_at DESC, id DESC);`
  );
}
