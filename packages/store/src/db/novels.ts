import { getDatabase } from './connection';

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
