import type { OutlineNode, ActNode } from '@novel-editor/basic-algorithm';
import type {
  OutlineEntry,
  Character,
  CharacterLink,
  CharacterRelation,
  CharacterCamp,
  CharacterGraphAICharacter,
  CharacterGraphAIRelation,
  CharacterGraphAIResult,
  PlotActBoard,
  RelationTone,
} from './types';
import { RELATION_TONE_LABELS, ROLE_COLORS } from './constants';

/**
 * FNV-1a 32-bit hash — fast, synchronous, zero-dependency.
 * Returns a compact 8-char hex string suitable for cache keys.
 */
function fnv1a32(input: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Content-addressable cache key — independent of line number so cache
 * survives line shifts after edits in other chapters.
 * Uses FNV-1a hash for compact, O(1) lookup in Map and SQLite.
 */
export function buildOutlineEntryCacheKey(entry: OutlineEntry): string {
  const title = entry.originalText || entry.text;
  return fnv1a32(title);
}

/** Check whether a DB cache_key is already in the new hash format */
const HASH_KEY_RE = /^[0-9a-f]{8}$/;

/**
 * Migrate a legacy DB cache_key (raw title or "title|fingerprint") to
 * the new FNV-1a hash format. Returns `null` if already migrated.
 */
export function migrateCacheKey(oldKey: string): string | null {
  if (HASH_KEY_RE.test(oldKey)) return null; // already new format
  const title = oldKey.includes('|') ? oldKey.slice(0, oldKey.indexOf('|')) : oldKey;
  return fnv1a32(title);
}

export function sanitizeAiSummary(raw: string): string {
  return raw
    .replace(/^['"""]|['"""]$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createLoreStorageKey(folderPath: string | null): string | null {
  return folderPath ? `novel-editor:lore:${folderPath}` : null;
}

export function createRelationStorageKey(folderPath: string | null): string | null {
  return folderPath ? `novel-editor:character-relations:${folderPath}` : null;
}

export function createPlotStorageKey(folderPath: string | null): string | null {
  return folderPath ? `novel-editor:plot-board:${folderPath}` : null;
}

export function createGraphLayoutStorageKey(folderPath: string | null): string | null {
  return folderPath ? `novel-editor:graph-layout:${folderPath}` : null;
}

export function createActBoardKey(act: ActNode, index: number): string {
  return `${index}:${act.line}:${act.title}`;
}

export function normalizePersonName(value: string): string {
  return value.replace(/\s+/g, '').trim().toLowerCase();
}

export function splitTextIntoChunks(content: string, maxChars: number): string[] {
  const sanitized = content.trim();
  if (!sanitized) return [];

  const paragraphs = sanitized.split(/\n{2,}/).filter((item) => item.trim());
  const chunks: string[] = [];
  let current = '';

  const pushCurrent = () => {
    if (current.trim()) {
      chunks.push(current.trim());
      current = '';
    }
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      pushCurrent();
      for (let index = 0; index < paragraph.length; index += maxChars) {
        chunks.push(paragraph.slice(index, index + maxChars));
      }
      continue;
    }

    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > maxChars) {
      pushCurrent();
      current = paragraph;
    } else {
      current = next;
    }
  }

  pushCurrent();
  return chunks;
}

export function extractJsonBlock(raw: string): string | null {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const objectStart = raw.indexOf('{');
  const objectEnd = raw.lastIndexOf('}');
  if (objectStart !== -1 && objectEnd > objectStart) {
    return raw.slice(objectStart, objectEnd + 1).trim();
  }

  return null;
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

  const resolveCharacterKey = (character: CharacterGraphAICharacter) => {
    const candidates = [character.name, ...(character.aliases || [])]
      .map((item) => normalizePersonName(item || ''))
      .filter(Boolean);
    for (const candidate of candidates) {
      if (characterMap.has(candidate)) return candidate;
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

export function parseCharacterAttributes(attributes: string): {
  avatar?: string;
  aliases?: string[];
} {
  try {
    const parsed = JSON.parse(attributes || '{}') as { avatar?: string; aliases?: string[] };
    return parsed || {};
  } catch {
    return {};
  }
}

export function mapCharacterRows(
  rows: Array<{
    id: number;
    name: string;
    role: string;
    description: string;
    attributes: string;
  }>
): Character[] {
  return rows.map((row) => {
    const attrs = parseCharacterAttributes(row.attributes);
    return {
      id: row.id,
      name: row.name,
      role: row.role || '',
      description: row.description || '',
      avatar: attrs.avatar || undefined,
    };
  });
}

export function extractLineSummary(lines: string[], startLine: number, endLine: number): string {
  const body = lines
    .slice(Math.max(0, startLine - 1), Math.max(0, endLine - 1))
    .map((item) => item.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/[#*`>\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!body) return '暂无内容摘要';
  return body.length > 110 ? `${body.slice(0, 110)}...` : body;
}

export function extractChapterContent(
  content: string,
  entries: OutlineEntry[],
  entryIndex: number,
  maxChars: number
): string {
  if (entryIndex < 0 || entryIndex >= entries.length) return '';
  const lines = content.split(/\r?\n/);
  const entry = entries[entryIndex];
  const nextLine = entries[entryIndex + 1]?.line || lines.length + 1;
  const body = lines
    .slice(entry.line, nextLine - 1)
    .join('\n')
    .trim();
  return body.length > maxChars ? body.slice(0, maxChars) : body;
}

export function isGenericOutlineTitle(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/^第[一二三四五六七八九十百千万零〇\d]+[章幕节卷部回篇集]$/.test(trimmed)) return true;
  if (/^(chapter|part|act|scene)\s*\d+$/i.test(trimmed)) return true;
  return false;
}

export function isChapterHeading(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^第[一二三四五六七八九十百千万零〇\d]+[章幕节卷部回篇集](?:[：:：\-\s].+)?$/.test(trimmed))
    return true;
  if (/^(chapter|part|act)\s*\d+(?:\s*[:：\-]\s*.+)?$/i.test(trimmed)) return true;
  return false;
}

export function selectChapterHeadings(headings: OutlineNode[]): OutlineNode[] {
  if (headings.length === 0) return [];

  const normalized = headings.filter((item) => item.text.trim());
  if (normalized.length === 0) return [];

  const chapterCandidates = normalized.filter((item) => isChapterHeading(item.text));
  if (chapterCandidates.length >= 2) return chapterCandidates;

  const minLevel = Math.min(...normalized.map((item) => item.level || 1));
  const topLevel = normalized.filter((item) => (item.level || 1) === minLevel);
  return topLevel.length > 0 ? topLevel : normalized;
}

export function parseOutlineTitleCompletions(raw: string): Array<{ line: number; title: string }> {
  const jsonBlock = extractJsonBlock(raw);
  if (!jsonBlock) {
    return raw
      .split(/\r?\n/)
      .map((line) => {
        const match = line.match(/line\s*[:=]\s*(\d+)\s*[,，;；\s]+title\s*[:=]\s*(.+)$/i);
        if (!match) return null;
        return {
          line: Number(match[1]) || 0,
          title: (match[2] || '').replace(/^['"""]|['"""]$/g, '').trim(),
        };
      })
      .filter((item): item is { line: number; title: string } => Boolean(item?.line && item.title));
  }

  try {
    const parsed = JSON.parse(jsonBlock) as
      | Array<{ line?: number; title?: string }>
      | {
          items?: Array<{ line?: number; title?: string }>;
          titles?: Array<{ line?: number; title?: string }>;
          result?: Array<{ line?: number; title?: string }>;
          [line: string]: unknown;
        };

    const entries: Array<{ line?: number; title?: string }> = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.items)
        ? parsed.items
        : Array.isArray(parsed.titles)
          ? parsed.titles
          : Array.isArray(parsed.result)
            ? parsed.result
            : Object.entries(parsed)
                .map(([key, value]) => {
                  const maybeLine = Number(key);
                  if (!Number.isFinite(maybeLine)) return null;
                  if (typeof value === 'string') return { line: maybeLine, title: value };
                  if (value && typeof value === 'object') {
                    const item = value as { title?: string };
                    return { line: maybeLine, title: item.title || '' };
                  }
                  return null;
                })
                .filter((item): item is { line: number; title: string } => Boolean(item));

    return entries
      .map((item) => ({
        line: Number(item.line) || 0,
        title: (item.title || '').trim(),
      }))
      .filter((item) => item.line > 0 && item.title);
  } catch {
    return [];
  }
}

export function buildOutlineEntries(content: string, headings: OutlineNode[]): OutlineEntry[] {
  const lines = content.split(/\r?\n/);
  if (!content.trim()) return [];

  const chapterHeadings = selectChapterHeadings(headings);

  if (chapterHeadings.length === 0) {
    const bodyText = lines.join('\n').trim();
    return [
      {
        line: 1,
        level: 1,
        text: '未命名章节',
        originalText: '',
        summary: extractLineSummary(lines, 1, lines.length + 1),
        autoGenerated: false,
        needsAiTitle: true,
        wordCount: bodyText.replace(/\s+/g, '').length,
      },
    ];
  }

  return chapterHeadings.map((heading, index) => {
    const nextLine = chapterHeadings[index + 1]?.line || lines.length + 1;
    const normalizedText = heading.text.trim();
    const chapterBody = lines
      .slice(heading.line, nextLine - 1)
      .join('\n')
      .trim();
    return {
      line: heading.line,
      level: 1,
      text: normalizedText || '未命名章节',
      originalText: normalizedText,
      summary: extractLineSummary(lines, heading.line + 1, nextLine),
      autoGenerated: false,
      needsAiTitle: isGenericOutlineTitle(normalizedText),
      wordCount: chapterBody.replace(/\s+/g, '').length,
    };
  });
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function estimateAppearanceHeat(content: string, name: string): number {
  if (!name.trim()) return 0;
  const reg = new RegExp(escapeRegex(name.trim()), 'g');
  const matches = content.match(reg);
  return matches ? matches.length : 0;
}

export function inferCharacterCamp(
  character: Character,
  relations: CharacterRelation[]
): CharacterCamp {
  const role = character.role.toLowerCase();
  if (/主角|主人公|男主|女主/.test(role)) return 'protagonist';
  if (/反派|对立|宿敌|敌/.test(role)) return 'antagonist';
  const hostile = relations.filter(
    (item) =>
      (item.sourceId === character.id || item.targetId === character.id) && item.tone === 'rival'
  ).length;
  const allied = relations.filter(
    (item) =>
      (item.sourceId === character.id || item.targetId === character.id) && item.tone !== 'rival'
  ).length;
  if (hostile > allied + 1) return 'antagonist';
  if (allied >= hostile) return 'protagonist';
  return 'support';
}

export function inferRelationStage(note: string): string {
  const text = note.trim();
  if (!text) return '未标注阶段';
  if (/(前期|初识|开端|早期)/.test(text)) return '前期';
  if (/(中期|升级|加深|矛盾)/.test(text)) return '中期';
  if (/(后期|决裂|和解|终局|结局)/.test(text)) return '后期';
  return '阶段未定义';
}

export function createDefaultActBoard(act: ActNode, actIndex: number): PlotActBoard {
  return {
    premise: '',
    goal: '',
    conflict: '',
    twist: '',
    payoff: '',
    structureNodes: [],
    aiSuggestion: '',
    sceneBoards: act.scenes.map((scene, sceneIndex) => ({
      sceneKey: `${actIndex}:${sceneIndex}:${scene.line}`,
      title: scene.title,
      objective: '',
      tension: '',
      outcome: '',
      status: 'draft',
    })),
  };
}

export function mergeActBoard(act: ActNode, actIndex: number, board?: PlotActBoard): PlotActBoard {
  const fallback = createDefaultActBoard(act, actIndex);
  if (!board) return fallback;

  return {
    premise: board.premise || '',
    goal: board.goal || '',
    conflict: board.conflict || '',
    twist: board.twist || '',
    payoff: board.payoff || '',
    structureNodes: Array.isArray(board.structureNodes) ? board.structureNodes : [],
    aiSuggestion: board.aiSuggestion || '',
    sceneBoards: fallback.sceneBoards.map((scene) => {
      const saved = board.sceneBoards.find(
        (item) => item.sceneKey === scene.sceneKey || item.title === scene.title
      );
      return saved ? { ...scene, ...saved } : scene;
    }),
  };
}

export function buildCharacterLinks(characters: Character[]): CharacterLink[] {
  if (characters.length < 2) return [];
  return characters.slice(0, Math.min(characters.length - 1, 5)).map((character, index) => ({
    sourceId: character.id,
    targetId: characters[index + 1].id,
    label: character.role && characters[index + 1].role ? '角色关联' : '待定义',
  }));
}

export function getRoleColor(role: string): string {
  if (ROLE_COLORS[role]) return ROLE_COLORS[role];
  for (const key of Object.keys(ROLE_COLORS)) {
    if (role.includes(key)) return ROLE_COLORS[key];
  }
  return '#007acc';
}
