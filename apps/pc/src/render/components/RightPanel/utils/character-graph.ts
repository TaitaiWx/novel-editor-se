import type {
  CharacterGraphAICharacter,
  CharacterGraphAIRelation,
  CharacterGraphAIResult,
  RelationTone,
} from '../types';
import { RELATION_TONE_LABELS } from '../constants';
import { extractJsonBlock } from './text';

export function normalizePersonName(value: string): string {
  return value.replace(/\s+/g, '').trim().toLowerCase();
}

export function normalizeRelationTone(value?: string): RelationTone {
  const normalized = value?.toLowerCase().trim() || '';
  if (normalized.includes('ally') || normalized.includes('盟友') || normalized.includes('合作')) {
    return 'ally';
  }
  if (normalized.includes('rival') || normalized.includes('对立') || normalized.includes('敌')) {
    return 'rival';
  }
  if (normalized.includes('family') || normalized.includes('亲') || normalized.includes('血缘')) {
    return 'family';
  }
  if (normalized.includes('mentor') || normalized.includes('师') || normalized.includes('引导')) {
    return 'mentor';
  }
  return 'other';
}

export function parseCharacterGraphAIResult(raw: string): CharacterGraphAIResult | null {
  const jsonBlock = extractJsonBlock(raw);
  if (!jsonBlock) return null;

  try {
    const parsed = JSON.parse(jsonBlock) as Partial<CharacterGraphAIResult> & {
      cast?: CharacterGraphAICharacter[];
      links?: CharacterGraphAIRelation[];
    };

    const characters = Array.isArray(parsed.characters)
      ? parsed.characters
      : Array.isArray(parsed.cast)
        ? parsed.cast
        : [];
    const relations = Array.isArray(parsed.relations)
      ? parsed.relations
      : Array.isArray(parsed.links)
        ? parsed.links
        : [];

    return {
      characters: characters.filter((item) => item?.name?.trim()),
      relations: relations.filter((item) => item?.source?.trim() && item?.target?.trim()),
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
    };
  } catch {
    return null;
  }
}

export function mergeCharacterGraphResults(
  results: CharacterGraphAIResult[]
): CharacterGraphAIResult {
  const characterMap = new Map<
    string,
    CharacterGraphAICharacter & { descriptionParts: Set<string>; aliasSet: Set<string> }
  >();
  const relationMap = new Map<string, CharacterGraphAIRelation>();
  const summaries: string[] = [];

  /** 规范化名字/别名 → characterMap 中的主键，使后续分块可通过任一别名合并到同一人物 */
  const nameIndex = new Map<string, string>();

  const resolveCharacterKey = (character: CharacterGraphAICharacter) => {
    const candidates = [character.name, ...(character.aliases || [])]
      .map((item) => normalizePersonName(item || ''))
      .filter(Boolean);
    for (const candidate of candidates) {
      const indexed = nameIndex.get(candidate);
      if (indexed) return indexed;
    }
    return normalizePersonName(character.name);
  };

  for (const result of results) {
    if (result.summary) summaries.push(result.summary);

    for (const character of result.characters) {
      const name = character.name.trim();
      if (!name) continue;
      const key = resolveCharacterKey(character);
      const existing = characterMap.get(key);
      const descriptionParts = existing?.descriptionParts || new Set<string>();
      const aliasSet = existing?.aliasSet || new Set<string>();

      [character.description, character.highlight]
        .map((item) => item?.trim())
        .filter(Boolean)
        .forEach((item) => descriptionParts.add(item as string));
      (character.aliases || [])
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach((item) => aliasSet.add(item));

      // 登记主名与全部别名，供后续分块按别名命中
      for (const alias of [name, ...aliasSet]) {
        const normalized = normalizePersonName(alias);
        if (normalized && !nameIndex.has(normalized)) nameIndex.set(normalized, key);
      }
      if (!nameIndex.has(key)) nameIndex.set(key, key);

      characterMap.set(key, {
        name: existing?.name || name,
        role:
          (character.role && character.role.trim()) ||
          (existing?.role && existing.role.trim()) ||
          '',
        description: '',
        highlight: '',
        aliases: [],
        descriptionParts,
        aliasSet,
      });
    }

    for (const relation of result.relations) {
      const source = normalizePersonName(relation.source);
      const target = normalizePersonName(relation.target);
      if (!source || !target || source === target) continue;
      const label =
        relation.label?.trim() || RELATION_TONE_LABELS[normalizeRelationTone(relation.tone)];
      const relationKey = `${source}:${target}:${label}`;
      if (!relationMap.has(relationKey)) {
        relationMap.set(relationKey, {
          source: relation.source.trim(),
          target: relation.target.trim(),
          label,
          tone: normalizeRelationTone(relation.tone),
          note: relation.note?.trim() || '',
        });
      }
    }
  }

  return {
    characters: Array.from(characterMap.values()).map((item) => ({
      name: item.name,
      role: item.role,
      description: Array.from(item.descriptionParts).join('；').slice(0, 280),
      aliases: Array.from(item.aliasSet),
    })),
    relations: Array.from(relationMap.values()),
    summary: summaries.filter(Boolean).slice(0, 3).join(' / '),
  };
}
