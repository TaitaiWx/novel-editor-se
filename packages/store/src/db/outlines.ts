import { getDatabase } from './connection';
import {
  buildOutlineScopeWhere,
  countOutlineNodes,
  normalizeOutlineScope,
  parseOutlineTree,
} from './sql-helpers';
import { OUTLINE_VERSION_SOURCES } from './types';
import type {
  OutlineScope,
  OutlineTreeNode,
  OutlineVersionRow,
  OutlineVersionSource,
} from './types';

/** 大纲树 */
export const outlineOps = {
  getByNovel(novelId: number) {
    return this.getByScope(novelId, { kind: 'project', path: '' });
  },

  getByScope(novelId: number, scope?: OutlineScope) {
    const normalizedScope = normalizeOutlineScope(scope);
    const { clause, values } = buildOutlineScopeWhere(normalizedScope);
    return getDatabase()
      .prepare(
        `SELECT * FROM outlines
         WHERE novel_id = ? AND ${clause}
         ORDER BY COALESCE(parent_id, id), sort_order, id`
      )
      .all(novelId, ...values);
  },

  clearByNovel(novelId: number) {
    return this.clearByScope(novelId, { kind: 'project', path: '' });
  },

  clearByScope(novelId: number, scope?: OutlineScope) {
    const normalizedScope = normalizeOutlineScope(scope);
    const { clause, values } = buildOutlineScopeWhere(normalizedScope);
    return getDatabase()
      .prepare(`DELETE FROM outlines WHERE novel_id = ? AND ${clause}`)
      .run(novelId, ...values);
  },

  reorder(ids: number[]) {
    const database = getDatabase();
    const stmt = database.prepare('UPDATE outlines SET sort_order = ? WHERE id = ?');
    const transaction = database.transaction(() => {
      ids.forEach((id, index) => stmt.run(index, id));
    });
    transaction();
  },

  replaceTree(novelId: number, entries: OutlineTreeNode[], scope?: OutlineScope) {
    const database = getDatabase();
    const normalizedScope = normalizeOutlineScope(scope);
    const { clause, values } = buildOutlineScopeWhere(normalizedScope);
    const deleteStmt = database.prepare(`DELETE FROM outlines WHERE novel_id = ? AND ${clause}`);
    const insertStmt = database.prepare(
      'INSERT INTO outlines (novel_id, scope_kind, scope_path, title, content, anchor_text, line_hint, parent_id, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );

    const insertNodes = (nodes: OutlineTreeNode[], parentId: number | null) => {
      nodes.forEach((node, index) => {
        const result = insertStmt.run(
          novelId,
          normalizedScope.kind,
          normalizedScope.path,
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
      deleteStmt.run(novelId, ...values);
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
    return this.listByScope(novelId, { kind: 'project', path: '' });
  },

  listByScope(novelId: number, scope?: OutlineScope) {
    const normalizedScope = normalizeOutlineScope(scope);
    const { clause, values } = buildOutlineScopeWhere(normalizedScope);
    return getDatabase()
      .prepare(
        `SELECT * FROM outline_versions
         WHERE novel_id = ? AND ${clause}
         ORDER BY created_at DESC, id DESC`
      )
      .all(novelId, ...values) as OutlineVersionRow[];
  },

  create(
    novelId: number,
    name: string,
    source: OutlineVersionSource,
    note = '',
    entries: OutlineTreeNode[],
    options?: {
      scope?: OutlineScope;
      storyIdeaCardId?: number | null;
      storyIdeaSnapshotJson?: string;
    }
  ) {
    if (!OUTLINE_VERSION_SOURCES.includes(source)) {
      throw new Error(`Unsupported outline version source: ${source}`);
    }
    const normalizedScope = normalizeOutlineScope(options?.scope);
    return getDatabase()
      .prepare(
        `INSERT INTO outline_versions (
          novel_id, scope_kind, scope_path, name, source, note, story_idea_card_id, story_idea_snapshot_json, tree_json, total_nodes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        novelId,
        normalizedScope.kind,
        normalizedScope.path,
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

    return { ...row, tree: parseOutlineTree(row.tree_json) };
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
