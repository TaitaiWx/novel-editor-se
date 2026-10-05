import { getDatabase } from './connection';
import { buildAllowedUpdate } from './sql-helpers';

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
    const { updates, values } = buildAllowedUpdate(
      fields,
      new Set(['name', 'role', 'description', 'attributes'])
    );
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

  clearByNovel(novelId: number) {
    return getDatabase().prepare('DELETE FROM characters WHERE novel_id = ?').run(novelId);
  },
};
