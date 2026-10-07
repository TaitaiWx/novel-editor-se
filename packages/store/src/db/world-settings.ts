import { getDatabase } from './connection';
import { buildAllowedUpdate } from './sql-helpers';

/**
 * 设定资料库
 *
 * attributes（JSON）：分类目录 folder、图集 media、封面 cover 等扩展字段（渲染进程 lore-data 解析）
 */
export const worldSettingOps = {
  create(
    novelId: number,
    category: string,
    title: string,
    content = '',
    tags = '[]',
    attributes = '{}'
  ) {
    return getDatabase()
      .prepare(
        'INSERT INTO world_settings (novel_id, category, title, content, tags, attributes) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(novelId, category, title, content, tags, attributes);
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
    fields: {
      category?: string;
      title?: string;
      content?: string;
      tags?: string;
      attributes?: string;
    }
  ) {
    const { updates, values } = buildAllowedUpdate(
      fields,
      new Set(['category', 'title', 'content', 'tags', 'attributes'])
    );
    updates.push("updated_at = datetime('now')");
    values.push(id);
    return getDatabase()
      .prepare(`UPDATE world_settings SET ${updates.join(', ')} WHERE id = ?`)
      .run(...values);
  },

  delete(id: number) {
    return getDatabase().prepare('DELETE FROM world_settings WHERE id = ?').run(id);
  },

  clearByNovel(novelId: number) {
    return getDatabase().prepare('DELETE FROM world_settings WHERE novel_id = ?').run(novelId);
  },

  bulkCreate(
    novelId: number,
    entries: Array<{
      category: string;
      title: string;
      content?: string;
      tags?: string;
      attributes?: string;
    }>
  ) {
    if (entries.length === 0) {
      return { changes: 0 };
    }
    const stmt = getDatabase().prepare(
      'INSERT INTO world_settings (novel_id, category, title, content, tags, attributes) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const transaction = getDatabase().transaction(() => {
      for (const entry of entries) {
        stmt.run(
          novelId,
          entry.category,
          entry.title,
          entry.content || '',
          entry.tags || '[]',
          entry.attributes || '{}'
        );
      }
    });
    transaction();
    return { changes: entries.length };
  },
};
