/** 全量数据导出/导入（JSON 迁移） */
import { getDatabase } from './connection';
import { buildInsertSql } from './sql-helpers';

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
      const stmt = database.prepare(buildInsertSql(table, columns));
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
