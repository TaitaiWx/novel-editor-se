/** 已移除的关系表单字段；图谱连线是关系内容的唯一维护入口。 */
const removedKeys = ['relationships', 'socialStyle', 'intimacyStyle'];
const sections = ['design', 'profileEvidence'];

/** 保存或导入旧人物资料时，丢弃废弃字段及其来源记录，保留其他属性。 */
export function cleanCharacterSocialAttributes(raw: string): string {
  let attributes: unknown;
  try {
    attributes = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return raw;
  let changed = false;
  for (const section of sections) {
    const fields = (attributes as Record<string, unknown>)[section];
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) continue;
    for (const key of removedKeys) {
      if (!Object.hasOwn(fields, key)) continue;
      delete (fields as Record<string, unknown>)[key];
      changed = true;
    }
  }
  return changed ? JSON.stringify(attributes) : raw;
}

const paths = sections.flatMap((section) => removedKeys.map((key) => `'$.${section}.${key}'`));

/** 幂等清理存量数据；CASE 避免历史无效 JSON 导致数据库初始化失败。 */
export const CLEAN_CHARACTER_SOCIAL_SQL = `
  UPDATE characters
  SET attributes = json_remove(attributes, ${paths.join(', ')}), updated_at = datetime('now')
  WHERE CASE WHEN json_valid(attributes) THEN
    ${paths.map((path) => `json_type(attributes, ${path}) IS NOT NULL`).join(' OR ')}
  ELSE 0 END;
`;
