/**
 * 项目种子数据：首次打开带 `.novel-editor/seed.json` 的项目（例如示例作品集）时，
 * 把人物、设定、大纲、幕剧写入该项目的 SQLite。
 *
 * - 文件格式沿用全量导出（ExportData）的行结构，只取与单个项目相关的表；
 *   `novel_id` / `id` / `parent_id` / `act_id` 只用于种子内部互相引用，写入时重新分配
 * - 数据库按项目绝对路径区分作品，种子里的路径一律相对项目根目录，写入时再拼成绝对路径
 * - 幂等：该目录已有作品记录（用户打开过、或已播种）时不做任何改动，绝不覆盖用户数据
 * - 列名按白名单过滤，种子文件无法借列名注入 SQL
 */
import path from 'path';
import { getDatabase } from './connection';
import { buildInsertSql } from './sql-helpers';
import type { ExportData } from './export-import';

/** 种子文件名（位于项目的 `.novel-editor/` 下） */
export const PROJECT_SEED_FILE = 'seed.json';

export type ProjectSeedData = Pick<ExportData, 'version' | 'novels' | 'characters'> &
  Partial<Pick<ExportData, 'world_settings' | 'outlines' | 'acts' | 'scenes'>>;

export interface SeedProjectResult {
  seeded: boolean;
  novelId: number | null;
  counts: {
    characters: number;
    worldSettings: number;
    outlines: number;
    acts: number;
    scenes: number;
  };
}

type Row = Record<string, unknown>;
type SqlValue = string | number | null;

const CHARACTER_COLUMNS = ['name', 'role', 'description', 'attributes', 'sort_order'] as const;
const WORLD_SETTING_COLUMNS = ['category', 'title', 'content', 'tags'] as const;
const OUTLINE_COLUMNS = [
  'scope_kind',
  'title',
  'content',
  'anchor_text',
  'line_hint',
  'sort_order',
] as const;
const ACT_COLUMNS = ['title', 'description', 'sort_order'] as const;
const SCENE_COLUMNS = ['title', 'summary', 'sort_order'] as const;

function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rowsOf(value: unknown, table: string): Row[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new Error(`种子数据格式错误：${table} 必须是对象数组`);
  }
  return value;
}

function toSqlValue(value: unknown): SqlValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  // 对象 / 数组（例如人物 attributes、设定 tags）按 JSON 字符串存储，与 GUI 写入的格式一致
  return JSON.stringify(value);
}

function pickColumns(row: Row, columns: readonly string[]): Record<string, SqlValue> {
  const picked: Record<string, SqlValue> = {};
  for (const column of columns) {
    if (row[column] !== undefined) picked[column] = toSqlValue(row[column]);
  }
  return picked;
}

function idOf(row: Row): string | null {
  const id = row.id;
  return typeof id === 'number' || typeof id === 'string' ? String(id) : null;
}

/** 种子中的相对路径 → 项目内绝对路径；空串保持为空（项目级大纲） */
function resolveSeedPath(folderPath: string, relative: unknown): string {
  if (typeof relative !== 'string' || !relative.trim()) return '';
  if (path.isAbsolute(relative)) {
    throw new Error(`种子数据中的路径必须是相对路径: ${relative}`);
  }
  const resolved = path.resolve(folderPath, ...relative.split(/[\\/]/));
  const root = path.resolve(folderPath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`种子数据中的路径超出项目目录: ${relative}`);
  }
  return resolved;
}

/** 校验种子数据结构（不写数据库），返回规范化后的各表行 */
export function validateProjectSeed(raw: unknown): ProjectSeedData {
  if (!isRecord(raw)) throw new Error('种子数据格式错误：顶层必须是对象');
  const novels = rowsOf(raw.novels, 'novels');
  if (novels.length !== 1) throw new Error('种子数据格式错误：novels 必须且只能包含一部作品');
  if (typeof novels[0].name !== 'string' || !novels[0].name.trim()) {
    throw new Error('种子数据格式错误：作品缺少 name');
  }
  const data: ProjectSeedData = {
    version: typeof raw.version === 'string' ? raw.version : '1.0.0',
    novels,
    characters: rowsOf(raw.characters, 'characters'),
    world_settings: rowsOf(raw.world_settings, 'world_settings'),
    outlines: rowsOf(raw.outlines, 'outlines'),
    acts: rowsOf(raw.acts, 'acts'),
    scenes: rowsOf(raw.scenes, 'scenes'),
  };
  for (const [table, rows] of [
    ['characters', data.characters],
    ['world_settings', data.world_settings ?? []],
    ['outlines', data.outlines ?? []],
    ['acts', data.acts ?? []],
    ['scenes', data.scenes ?? []],
  ] as const) {
    rows.forEach((row, index) => {
      const key = table === 'characters' ? 'name' : 'title';
      if (typeof row[key] !== 'string' || !(row[key] as string).trim()) {
        throw new Error(`种子数据格式错误：${table}[${index}] 缺少 ${key}`);
      }
    });
  }
  return data;
}

/**
 * 为 folderPath 对应的项目写入种子数据。
 * 该目录已有作品记录时直接返回 `seeded: false`。
 */
export function seedProjectData(folderPath: string, raw: unknown): SeedProjectResult {
  const empty = { characters: 0, worldSettings: 0, outlines: 0, acts: 0, scenes: 0 };
  const database = getDatabase();
  const existing = database.prepare('SELECT id FROM novels WHERE folder_path = ?').get(folderPath);
  if (existing) return { seeded: false, novelId: null, counts: empty };

  const data = validateProjectSeed(raw);
  const novel = data.novels[0];
  const insert = (table: string, values: Record<string, SqlValue>): number => {
    const columns = Object.keys(values);
    const result = database
      .prepare(buildInsertSql(table, columns))
      .run(...columns.map((column) => values[column]));
    return Number(result.lastInsertRowid);
  };

  let novelId = 0;
  const counts = { ...empty };
  database.transaction(() => {
    novelId = insert('novels', {
      name: String(novel.name),
      description: toSqlValue(novel.description) ?? '',
      folder_path: folderPath,
    });

    data.characters.forEach((row, index) => {
      insert('characters', {
        sort_order: index,
        ...pickColumns(row, CHARACTER_COLUMNS),
        novel_id: novelId,
      });
      counts.characters += 1;
    });

    for (const row of data.world_settings ?? []) {
      insert('world_settings', { ...pickColumns(row, WORLD_SETTING_COLUMNS), novel_id: novelId });
      counts.worldSettings += 1;
    }

    // 大纲：父节点必须先于子节点出现，parent_id 按种子内 id 映射
    const outlineIds = new Map<string, number>();
    for (const row of data.outlines ?? []) {
      const parentKey =
        row.parent_id === null || row.parent_id === undefined ? null : String(row.parent_id);
      const parentId = parentKey === null ? null : outlineIds.get(parentKey);
      if (parentId === undefined) {
        throw new Error(`种子数据格式错误：大纲「${String(row.title)}」的父节点需要排在它之前`);
      }
      const id = insert('outlines', {
        ...pickColumns(row, OUTLINE_COLUMNS),
        scope_path: resolveSeedPath(folderPath, row.scope_path),
        parent_id: parentId,
        novel_id: novelId,
      });
      const key = idOf(row);
      if (key) outlineIds.set(key, id);
      counts.outlines += 1;
    }

    const actIds = new Map<string, number>();
    for (const row of data.acts ?? []) {
      const id = insert('acts', { ...pickColumns(row, ACT_COLUMNS), novel_id: novelId });
      const key = idOf(row);
      if (key) actIds.set(key, id);
      counts.acts += 1;
    }
    for (const row of data.scenes ?? []) {
      const actId = actIds.get(String(row.act_id));
      if (actId === undefined) {
        throw new Error(`种子数据格式错误：场景「${String(row.title)}」引用了不存在的幕`);
      }
      insert('scenes', {
        ...pickColumns(row, SCENE_COLUMNS),
        file_path: resolveSeedPath(folderPath, row.file_path),
        act_id: actId,
      });
      counts.scenes += 1;
    }
  })();

  return { seeded: true, novelId, counts };
}
