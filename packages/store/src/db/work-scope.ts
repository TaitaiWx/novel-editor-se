/**
 * 作品作用域（人物 / 设定 / 大纲 / 创意卡 / 幕剧跟随作品）
 *
 * 一个项目只有一个数据库（`<project>/.novel-editor/novel-editor.db`），其中每部作品一条 novels 记录，
 * `folder_path` 是作品目录的绝对路径；普通文件夹（没有 `ne init`）仍是一条以文件夹路径为键的记录。
 * 项目根路径的记录继续承载版本快照与写作统计（versioning 按项目根读写），不再作为作品内容的归属。
 *
 * 旧版数据迁移（`migrateProjectContentToWork`）：项目根记录下有作品内容、且目标作品还没有任何内容时，
 * 把内容行整体改挂到作品记录（同一事务，主键不变，不复制不删除），按项目路径 / 作品 id 保存在 settings
 * 里的界面数据（人物关系、关系图布局、人物时间线、作品级 AI 产物）同步改名；目标作品已有内容时不做任何改动，
 * 旧内容作为「未归属」继续可见。
 */
import { getDatabase } from './connection';

/** 归属于作品的内容表（版本快照、写作统计留在项目根记录） */
export const NOVEL_CONTENT_TABLES = [
  'characters',
  'world_settings',
  'outlines',
  'outline_versions',
  'story_idea_cards',
  'story_idea_outputs',
  'acts',
] as const;

/** 按「项目 / 作品路径」保存在 settings 表里的界面数据（人物关系、关系图布局、情节板、作品级 AI 产物） */
const PATH_SCOPED_SETTING_KEYS = [
  'novel-editor:character-relations:',
  'novel-editor:graph-layout:',
  'novel-editor:plot-board:',
  'novel-editor:lore:',
  ...['characters', 'lore', 'materials'].flatMap((artifact) => [
    `novel-editor:assistant-artifact:${artifact}:project:`,
    `novel-editor:assistant-generation:${artifact}:project:`,
  ]),
];
/** 按作品 id 保存的界面数据（人物时间线） */
const NOVEL_ID_SETTING_PREFIXES = [
  'novel-editor:character-timeline:',
  'novel-editor:character-timeline-order:',
];

/** 把 settings 中的键从 from 改名为 to（目标已存在时保留目标，不覆盖） */
function renameSettingKey(from: string, to: string): void {
  const database = getDatabase();
  if (database.prepare('SELECT 1 FROM settings WHERE key = ?').get(to)) return;
  database.prepare('UPDATE settings SET key = ? WHERE key = ?').run(to, from);
}

function migrateScopedSettings(
  projectRoot: string,
  workPath: string,
  sourceId: number,
  targetId: number
): void {
  for (const prefix of PATH_SCOPED_SETTING_KEYS) {
    renameSettingKey(`${prefix}${projectRoot}`, `${prefix}${workPath}`);
  }
  const database = getDatabase();
  for (const prefix of NOVEL_ID_SETTING_PREFIXES) {
    const rows = database
      .prepare('SELECT key FROM settings WHERE key LIKE ?')
      .all(`${prefix}${sourceId}:%`) as Array<{ key: string }>;
    for (const row of rows) {
      renameSettingKey(
        row.key,
        `${prefix}${targetId}:${row.key.slice(`${prefix}${sourceId}:`.length)}`
      );
    }
  }
}

export type NovelContentCounts = Record<(typeof NOVEL_CONTENT_TABLES)[number], number>;

interface NovelRow {
  id: number;
  name: string;
  folder_path: string;
}

function getNovelRow(folderPath: string): NovelRow | undefined {
  return getDatabase().prepare('SELECT * FROM novels WHERE folder_path = ?').get(folderPath) as
    | NovelRow
    | undefined;
}

/** 获取文件夹对应的作品记录，不存在时创建；返回作品 id */
export function ensureNovelByFolder(folderPath: string, name: string, description = ''): number {
  const existing = getNovelRow(folderPath);
  if (existing) return existing.id;
  const result = getDatabase()
    .prepare('INSERT INTO novels (name, folder_path, description) VALUES (?, ?, ?)')
    .run(name, folderPath, description);
  return Number(result.lastInsertRowid);
}

/** 作品记录下各内容表的行数 */
export function countNovelContent(novelId: number): NovelContentCounts {
  const database = getDatabase();
  const counts = {} as NovelContentCounts;
  for (const table of NOVEL_CONTENT_TABLES) {
    const row = database
      .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE novel_id = ?`)
      .get(novelId) as { count: number } | undefined;
    counts[table] = Number(row?.count ?? 0);
  }
  return counts;
}

function totalOf(counts: NovelContentCounts): number {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

/** 文件夹对应的作品记录是否有任何内容（人物、设定、大纲、创意卡、幕剧） */
export function hasNovelContentByFolder(folderPath: string): boolean {
  const novel = getNovelRow(folderPath);
  return novel ? totalOf(countNovelContent(novel.id)) > 0 : false;
}

export interface WorkContentMigration {
  migrated: boolean;
  reason: 'migrated' | 'no-project-record' | 'no-project-content' | 'target-has-content';
  novelId: number | null;
  counts: NovelContentCounts | null;
}

/**
 * 把项目根记录下的作品内容迁移到 workPath 对应的作品记录（不存在时创建，名称为 workName）。
 * 项目级大纲 / 大纲版本中记录为项目根路径的 scope_path 同步改为作品路径。幂等。
 */
export function migrateProjectContentToWork(
  projectRoot: string,
  workPath: string,
  workName: string
): WorkContentMigration {
  const database = getDatabase();
  const source = getNovelRow(projectRoot);
  if (!source) return { migrated: false, reason: 'no-project-record', novelId: null, counts: null };
  const sourceCounts = countNovelContent(source.id);
  if (totalOf(sourceCounts) === 0) {
    return { migrated: false, reason: 'no-project-content', novelId: null, counts: null };
  }
  const existingTarget = getNovelRow(workPath);
  if (existingTarget && totalOf(countNovelContent(existingTarget.id)) > 0) {
    return {
      migrated: false,
      reason: 'target-has-content',
      novelId: existingTarget.id,
      counts: null,
    };
  }

  let targetId = existingTarget?.id ?? 0;
  database.transaction(() => {
    targetId = existingTarget?.id ?? ensureNovelByFolder(workPath, workName);
    for (const table of NOVEL_CONTENT_TABLES) {
      database
        .prepare(`UPDATE ${table} SET novel_id = ? WHERE novel_id = ?`)
        .run(targetId, source.id);
    }
    for (const table of ['outlines', 'outline_versions'] as const) {
      database
        .prepare(
          `UPDATE ${table} SET scope_path = ? WHERE novel_id = ? AND scope_kind = 'project' AND scope_path = ?`
        )
        .run(workPath, targetId, projectRoot);
    }
    migrateScopedSettings(projectRoot, workPath, source.id, targetId);
    database.prepare("UPDATE novels SET updated_at = datetime('now') WHERE id = ?").run(targetId);
  })();
  return { migrated: true, reason: 'migrated', novelId: targetId, counts: sourceCounts };
}
