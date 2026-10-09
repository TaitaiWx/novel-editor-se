/** Relocate application-owned references in an export copy. Never replace text in author content. */
import type Database from 'better-sqlite3';
import path from 'node:path';
import { pauseExportedVideoTasks } from './pause-exported-video-tasks';

export interface BackupRoots {
  sourceRoot: string;
  destinationRoot: string;
}

const PATH_FIELDS = new Set([
  'path',
  'filePath',
  'folderPath',
  'workPath',
  'scopePath',
  'chapterPath',
  'volumePath',
  'sourcePath',
  'snapshotFilePath',
  'activeFilePath',
  'avatar',
]);
const SCOPED_SETTINGS =
  /^novel-editor:(chapter-materials|story-order|volume-plan|volume-workspace|plot-board|lore|character-relations|graph-layout|story-idea-term-pool|ai-history|ai-session|assistant-artifact|assistant-generation|project-docs-seen):/;

export function relocateBackupDatabase(database: Database.Database, roots: BackupRoots): void {
  const source = path.resolve(roots.sourceRoot).replace(/\\/g, '/').replace(/\/$/, '');
  const target = path.resolve(roots.destinationRoot).replace(/\\/g, '/').replace(/\/$/, '');
  const remap = (value: string): string => {
    const normalized = value.replace(/\\/g, '/');
    const lhs = process.platform === 'linux' ? normalized : normalized.toLowerCase();
    const rhs = process.platform === 'linux' ? source : source.toLowerCase();
    return lhs === rhs || lhs.startsWith(`${rhs}/`)
      ? target + normalized.slice(source.length)
      : value;
  };
  const structured = (value: unknown, field = ''): unknown => {
    if (typeof value === 'string') return PATH_FIELDS.has(field) ? remap(value) : value;
    if (Array.isArray(value)) return value.map((item) => structured(item, field));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, structured(item, key)])
    );
  };
  const parseTransform = (raw: string, transform: (value: unknown) => unknown): string => {
    try {
      return JSON.stringify(transform(JSON.parse(raw)));
    } catch {
      return raw;
    }
  };
  const mapPathList = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map((item) => (typeof item === 'string' ? remap(item) : item))
      : value;
  const mapKeys = (
    value: unknown,
    transform: (item: unknown) => unknown = (item) => item
  ): unknown =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).map(([key, item]) => [remap(key), transform(item)])
        )
      : value;
  const columns = (table: string) =>
    new Set(
      (database.pragma(`table_info(${table})`) as Array<{ name: string }>).map(({ name }) => name)
    );

  database.transaction(() => {
    pauseExportedVideoTasks(database);
    for (const [table, column] of [
      ['novels', 'folder_path'],
      ['scenes', 'file_path'],
      ['outlines', 'scope_path'],
      ['outline_versions', 'scope_path'],
      ['video_tasks', 'work_path'],
    ]) {
      if (!columns(table).has(column)) continue;
      const rows = database
        .prepare(`SELECT rowid AS row_id, ${column} AS value FROM ${table}`)
        .all() as Array<{ row_id: number; value: string }>;
      const update = database.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`);
      for (const row of rows)
        if (typeof row.value === 'string' && remap(row.value) !== row.value)
          update.run(remap(row.value), row.row_id);
    }
    for (const [table, column] of [
      ['video_tasks', 'data_json'],
      ['characters', 'attributes'],
      ['world_settings', 'attributes'],
    ]) {
      if (!columns(table).has(column)) continue;
      const rows = database
        .prepare(`SELECT rowid AS row_id, ${column} AS value FROM ${table}`)
        .all() as Array<{ row_id: number; value: string }>;
      const update = database.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`);
      for (const row of rows) update.run(parseTransform(row.value, structured), row.row_id);
    }
    if (!columns('settings').has('key')) return;
    database.prepare("DELETE FROM settings WHERE key LIKE 'novel-editor:editor-session:%'").run();
    const settings = database.prepare('SELECT key, value FROM settings').all() as Array<{
      key: string;
      value: string;
    }>;
    const update = database.prepare('UPDATE settings SET key = ?, value = ? WHERE key = ?');
    for (const row of settings) {
      if (!SCOPED_SETTINGS.test(row.key)) continue;
      // A scoped key can include artifact/kind before its absolute path. Only map that suffix.
      const prefix = row.key.match(SCOPED_SETTINGS)![0];
      const suffix = row.key.slice(prefix.length);
      let newSuffix = remap(suffix);
      if (newSuffix === suffix) {
        const index = suffix.indexOf(`:${source}`);
        if (index >= 0) newSuffix = suffix.slice(0, index + 1) + remap(suffix.slice(index + 1));
      }
      const value = parseTransform(row.value, (parsed) => {
        if (row.key.startsWith('novel-editor:chapter-materials:')) return mapPathList(parsed);
        if (row.key.startsWith('novel-editor:story-order:')) return mapKeys(parsed, mapPathList);
        if (
          row.key.startsWith('novel-editor:volume-plan:') &&
          parsed &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed)
        ) {
          const plan = parsed as Record<string, unknown>;
          return {
            ...plan,
            beatEdits: mapKeys(plan.beatEdits),
            beatOrder: mapKeys(plan.beatOrder, mapPathList),
            suggestions: mapKeys(plan.suggestions),
          };
        }
        return structured(parsed);
      });
      update.run(prefix + newSuffix, value, row.key);
    }
  })();
}
