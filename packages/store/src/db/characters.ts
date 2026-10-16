import { getDatabase } from './connection';
import { buildAllowedUpdate } from './sql-helpers';
import { cleanCharacterSocialAttributes } from './character-social-cleanup';

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
      .run(novelId, name, role, description, cleanCharacterSocialAttributes(attributes), sortOrder);
  },

  /** 采用人物建议：同名检查、字段 CAS 与来源记录在同一事务内完成。 */
  applyProfileSuggestion(
    novelId: number,
    input: {
      characterId: number | null;
      name: string;
      summary: string;
      chapter: string;
      source: 'text' | 'idea';
      quote: string;
      changes: { key: string; value: string; expected: string; quote: string }[];
    }
  ): { characterId: number; created: boolean } {
    const db = getDatabase();
    return db.transaction(() => {
      const rows = characterOps.getByNovel(novelId) as {
        id: number;
        name: string;
        attributes: string;
      }[];
      const normalize = (name: string) => name.trim().normalize('NFKC').toLowerCase();
      let attributes: Record<string, unknown> = {};
      if (input.characterId !== null) {
        const row = rows.find((c) => c.id === input.characterId);
        if (!row) throw new Error('人物不属于当前作品或已删除，请重新识别');
        attributes = JSON.parse(row.attributes || '{}');
      } else if (
        rows.some((row) => {
          const saved = JSON.parse(row.attributes || '{}');
          const aliases = Array.isArray(saved?.aliases)
            ? saved.aliases.filter((v: unknown) => typeof v === 'string')
            : [];
          return [row.name, ...aliases].some((n: string) => normalize(n) === normalize(input.name));
        })
      )
        throw new Error('已有同名或同别名人物，请选择关联已有角色');
      if (!attributes || Array.isArray(attributes) || typeof attributes !== 'object')
        throw new Error('人物资料格式无效');
      const originalDesign = attributes.design;
      if (
        originalDesign !== undefined &&
        (!originalDesign || typeof originalDesign !== 'object' || Array.isArray(originalDesign))
      )
        throw new Error('人物设定格式无效');
      const design = { ...(originalDesign as Record<string, unknown> | undefined) };
      const evidence =
        attributes.profileEvidence &&
        typeof attributes.profileEvidence === 'object' &&
        !Array.isArray(attributes.profileEvidence)
          ? { ...(attributes.profileEvidence as Record<string, unknown>) }
          : {};
      for (const change of input.changes) {
        if (['__proto__', 'constructor', 'prototype'].includes(change.key))
          throw new Error('人物字段无效');
        if ((design[change.key] ?? '') !== change.expected)
          throw new Error('人物字段已被修改，请重新识别后核对');
        design[change.key] = change.value;
        evidence[change.key] = {
          source: input.source,
          chapter: input.chapter,
          quote: change.quote,
          at: new Date().toISOString(),
        };
      }
      attributes.design = design;
      attributes.profileEvidence = evidence;
      if (input.characterId === null) {
        attributes.category = 'secondary';
        attributes.group = '临时人物';
        attributes.discoveredFrom = { chapter: input.chapter, quote: input.quote };
        const result = characterOps.create(
          novelId,
          input.name.trim(),
          '',
          input.summary,
          JSON.stringify(attributes)
        );
        return { characterId: Number(result.lastInsertRowid), created: true };
      }
      db.prepare(
        "UPDATE characters SET attributes = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(cleanCharacterSocialAttributes(JSON.stringify(attributes)), input.characterId);
      return { characterId: input.characterId, created: false };
    })();
  },

  getByNovel(novelId: number) {
    return getDatabase()
      .prepare('SELECT * FROM characters WHERE novel_id = ? ORDER BY sort_order')
      .all(novelId);
  },

  /** Compare-and-set only the edited nested fields; unrelated attributes never round-trip through a renderer. */
  patchAttributeGroups(
    id: number,
    groups: { section: string; patch: Record<string, string>; expected: Record<string, string> }[]
  ): void {
    getDatabase().transaction(() => {
      for (const group of groups)
        if (Object.keys(group.patch).length)
          characterOps.patchAttributeFields(id, group.section, group.patch, group.expected);
    })();
  },

  patchAttributeFields(
    id: number,
    section: string,
    patch: Record<string, string>,
    expected: Record<string, string>
  ) {
    const db = getDatabase();
    return db.transaction(() => {
      const row = db.prepare('SELECT attributes FROM characters WHERE id = ?').get(id) as
        | { attributes: string }
        | undefined;
      if (!row) throw new Error('人物不存在');
      const attributes = JSON.parse(row.attributes) as Record<string, unknown>;
      if (!attributes || Array.isArray(attributes) || typeof attributes !== 'object')
        throw new Error('人物属性格式无效');
      const current = attributes[section];
      if (
        current !== undefined &&
        (!current || typeof current !== 'object' || Array.isArray(current))
      )
        throw new Error('人物设计格式无效');
      const fields = { ...(current as Record<string, unknown> | undefined) };
      for (const [key, value] of Object.entries(patch)) {
        if (typeof expected[key] !== 'string' || (fields[key] ?? '') !== expected[key])
          throw new Error('此字段已被修改，请核对最新内容后重试');
        fields[key] = value;
      }
      attributes[section] = fields;
      db.prepare(
        "UPDATE characters SET attributes = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(cleanCharacterSocialAttributes(JSON.stringify(attributes)), id);
      return fields;
    })();
  },

  update(
    id: number,
    fields: {
      name?: string;
      role?: string;
      description?: string;
      /** Explicit full replacement for imports/CLI compatibility. GUI edits use attributePatch. */
      attributes?: string;
      /** Replace only explicitly edited top-level attributes, merging with the current row. */
      attributePatch?: Record<string, unknown>;
      /** AI suggestions add aliases without round-tripping an old alias list. */
      appendAliases?: string[];
    }
  ) {
    if (!Number.isSafeInteger(id) || id <= 0 || !fields || typeof fields !== 'object')
      throw new Error('人物更新参数无效');
    const { attributePatch, appendAliases, ...columns } = fields;
    const merging = attributePatch !== undefined || appendAliases !== undefined;
    if (merging && columns.attributes !== undefined) throw new Error('不能同时替换和合并人物属性');
    if (
      attributePatch !== undefined &&
      (!attributePatch ||
        typeof attributePatch !== 'object' ||
        Array.isArray(attributePatch) ||
        Object.keys(attributePatch).some((key) =>
          ['__proto__', 'constructor', 'prototype'].includes(key)
        ))
    )
      throw new Error('人物属性补丁格式无效');
    if (
      appendAliases !== undefined &&
      (!Array.isArray(appendAliases) || appendAliases.some((alias) => typeof alias !== 'string'))
    )
      throw new Error('人物别名格式无效');
    const db = getDatabase();
    return db.transaction(() => {
      if (merging) {
        const row = db.prepare('SELECT attributes FROM characters WHERE id = ?').get(id) as
          | { attributes: string }
          | undefined;
        if (!row) throw new Error('人物不存在');
        const current: unknown = JSON.parse(row.attributes || '{}');
        if (!current || typeof current !== 'object' || Array.isArray(current))
          throw new Error('人物属性格式无效');
        const attributes: Record<string, unknown> = { ...current };
        for (const [key, value] of Object.entries(attributePatch ?? {})) {
          if (value !== undefined) attributes[key] = value;
        }
        if (appendAliases) {
          const previous = Array.isArray(attributes.aliases)
            ? attributes.aliases.filter((alias): alias is string => typeof alias === 'string')
            : [];
          attributes.aliases = [
            ...new Set(
              [...previous, ...appendAliases].map((alias) => alias.trim()).filter(Boolean)
            ),
          ];
        }
        columns.attributes = JSON.stringify(attributes);
      }
      if (columns.attributes !== undefined)
        columns.attributes = cleanCharacterSocialAttributes(columns.attributes);
      const { updates, values } = buildAllowedUpdate(
        columns,
        new Set(['name', 'role', 'description', 'attributes'])
      );
      updates.push("updated_at = datetime('now')");
      values.push(id);
      return db.prepare(`UPDATE characters SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    })();
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
