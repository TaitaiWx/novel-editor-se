/** 人物图谱的 AI 草稿协议，与人物资料中的关系说明分开。 */
export const ENRICHMENT_RELATION_LABELS = {
  ally: '盟友',
  rival: '对立',
  family: '亲缘',
  mentor: '师承',
  other: '其他',
} as const;
export interface EnrichmentRelation {
  id: string;
  sourceId: number;
  targetId: number;
  tone: keyof typeof ENRICHMENT_RELATION_LABELS;
  label: string;
  note: string;
}
export interface EnrichmentNetwork {
  characters: { id: number; name: string; description?: string; role?: string }[];
  relations: EnrichmentRelation[];
  chapters?: { path: string; label: string; excerpt?: string }[];
}
export const relationPairKey = (sourceId: number, targetId: number) =>
  [sourceId, targetId].sort((a, b) => a - b).join(':');

/** 严格检查端点、类型、重复关系和全员覆盖；不把说明文本冒充连线。 */
export function parseRelationAdditions(
  raw: unknown,
  network: EnrichmentNetwork | undefined,
  currentId: number,
  scope: 'current' | 'all',
  makeId: () => string
): EnrichmentRelation[] {
  if (!network || network.characters.length < 2)
    throw new Error('建立关系至少需要作品中已有两个人物。');
  if (!Array.isArray(raw))
    throw new Error('模型没有返回关系连线，请重试；未将结果作为关系说明填入。');
  const ids = new Set(network.characters.map((character) => character.id));
  const pairs = new Set(
    network.relations.map((edge) => relationPairKey(edge.sourceId, edge.targetId))
  );
  const additions: EnrichmentRelation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error('返回的关系连线格式不正确，请重试。');
    const edge = item as Record<string, unknown>;
    if (
      typeof edge.sourceId !== 'number' ||
      typeof edge.targetId !== 'number' ||
      !ids.has(edge.sourceId) ||
      !ids.has(edge.targetId) ||
      edge.sourceId === edge.targetId ||
      typeof edge.tone !== 'string' ||
      !Object.hasOwn(ENRICHMENT_RELATION_LABELS, edge.tone) ||
      (edge.note !== undefined && typeof edge.note !== 'string')
    )
      throw new Error('关系连线包含无效人物、类型或说明，请重试。');
    if (scope === 'current' && edge.sourceId !== currentId && edge.targetId !== currentId)
      throw new Error('返回了当前人物以外的关系，未填入，请重试。');
    const key = relationPairKey(edge.sourceId, edge.targetId);
    if (pairs.has(key)) continue;
    pairs.add(key);
    const tone = edge.tone as EnrichmentRelation['tone'];
    additions.push({
      id: makeId(),
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      tone,
      label: ENRICHMENT_RELATION_LABELS[tone],
      note: typeof edge.note === 'string' ? edge.note.trim().slice(0, 4000) : '',
    });
  }
  if (scope === 'all') {
    const connected = new Set(
      [...network.relations, ...additions].flatMap((edge) => [edge.sourceId, edge.targetId])
    );
    const missing = network.characters.filter((character) => !connected.has(character.id));
    if (missing.length)
      throw new Error(
        `关系连线未覆盖全部人物，仍缺少：${missing.map((character) => character.name).join('、')}。请重试或补充这些人物的关系依据。`
      );
  } else if (!additions.length) {
    throw new Error('未返回新的有效关系连线，可能与已有关系重复，请补充要关联的人物后重试。');
  }
  return additions;
}
