import type { StoryIdeaCardRow, StoryIdeaOutputRow } from '@/render/types/electron-api';
import type {
  StoryIdeaCardDraft,
  StoryIdeaSnapshot,
  StoryIdeaTermPoolEntry,
  StoryIdeaTermPoolSource,
  StoryIdeaTermPoolState,
  StoryIdeaTermSection,
} from './types';
import { cleanText } from './text';

const STORY_IDEA_TERM_LIMIT = 6;
const STORY_IDEA_POOL_LIMIT = 24;

export function normalizeIdeaTags(input: string[] | string): string[] {
  const items = Array.isArray(input) ? input : input.split(/[\uff0c,\u3001]/g);
  const seen = new Set<string>();
  return items
    .map((item) => cleanText(item, 20))
    .filter((item) => {
      if (!item) return false;
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    })
    .slice(0, 8);
}

export function normalizeIdeaTerms(input: string[] | string): string[] {
  const items = Array.isArray(input) ? input : input.split(/[\uff0c,\u3001/|\uff5c\n]/g);
  const seen = new Set<string>();
  return items
    .map((item) => cleanText(item, 16))
    .filter((item) => {
      if (!item) return false;
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    })
    .slice(0, STORY_IDEA_TERM_LIMIT);
}

export function normalizeIdeaTermPool(input: string[] | string): string[] {
  const items = Array.isArray(input) ? input : input.split(/[\uff0c,\u3001/|\uff5c\n]/g);
  const seen = new Set<string>();
  return items
    .map((item) => cleanText(item, 16))
    .filter((item) => {
      if (!item) return false;
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    })
    .slice(0, STORY_IDEA_POOL_LIMIT);
}

function normalizeIdeaTermPoolSources(
  input: StoryIdeaTermPoolSource[] | undefined
): StoryIdeaTermPoolSource[] {
  const allowed: StoryIdeaTermPoolSource[] = ['history', 'ai', 'manual'];
  const seen = new Set<StoryIdeaTermPoolSource>();
  return (input || [])
    .filter((item): item is StoryIdeaTermPoolSource => allowed.includes(item))
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function normalizeIdeaTermPoolEntries(
  input: Array<string | StoryIdeaTermPoolEntry>,
  defaultSource: StoryIdeaTermPoolSource
): StoryIdeaTermPoolEntry[] {
  const entryMap = new Map<string, Set<StoryIdeaTermPoolSource>>();
  input.forEach((item) => {
    const term = normalizeIdeaTerms(typeof item === 'string' ? [item] : [item.term])[0];
    if (!term) return;
    const sources =
      typeof item === 'string'
        ? [defaultSource]
        : normalizeIdeaTermPoolSources(item.sources).length > 0
          ? normalizeIdeaTermPoolSources(item.sources)
          : [defaultSource];
    const current = entryMap.get(term) || new Set<StoryIdeaTermPoolSource>();
    sources.forEach((source) => current.add(source));
    entryMap.set(term, current);
  });

  return [...entryMap.entries()].slice(0, STORY_IDEA_POOL_LIMIT).map(([term, sources]) => ({
    term,
    sources: normalizeIdeaTermPoolSources([...sources]),
  }));
}

export function getIdeaTermPoolValues(entries: StoryIdeaTermPoolEntry[]): string[] {
  return entries.map((entry) => entry.term);
}

export function buildStoryIdeaTermSummary(
  terms: string[],
  maxVisible = 3
): { visibleTerms: string[]; hiddenCount: number } {
  const normalized = normalizeIdeaTerms(terms);
  return {
    visibleTerms: normalized.slice(0, maxVisible),
    hiddenCount: Math.max(0, normalized.length - maxVisible),
  };
}

export function pickRandomStoryIdeaTerms(
  pool: StoryIdeaTermPoolEntry[],
  count = 3,
  excludeTerms: string[] = []
): string[] {
  const excluded = new Set(normalizeIdeaTerms(excludeTerms));
  const candidates = getIdeaTermPoolValues(pool).filter((term) => !excluded.has(term));
  if (candidates.length === 0) {
    return [];
  }

  const sampleSize = Math.min(count, candidates.length);
  const next = [...candidates];
  for (let index = 0; index < sampleSize; index += 1) {
    const swapIndex = index + Math.floor(Math.random() * (next.length - index));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return normalizeIdeaTerms(next.slice(0, sampleSize));
}

function serializeIdeaTerms(terms: string[]): string {
  return normalizeIdeaTerms(terms).join(' / ');
}

function parseSeedTerms(raw: string | undefined): string[] {
  return raw ? normalizeIdeaTerms(raw) : [];
}

function parseTagsJson(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? normalizeIdeaTags(parsed as string[]) : [];
  } catch {
    return [];
  }
}

export function createEmptyStoryIdeaDraft(): StoryIdeaCardDraft {
  return {
    title: '未命名创意卡',
    premise: '',
    tags: [],
    source: 'manual',
    status: 'draft',
    themeTerms: [],
    conflictTerms: [],
    twistTerms: [],
    selectedLogline: '',
    selectedDirection: '',
    note: '',
  };
}

export function createEmptyStoryIdeaTermPool(): StoryIdeaTermPoolState {
  return {
    theme: [],
    conflict: [],
    twist: [],
  };
}

export function getStoryIdeaTermsBySection(
  draft: StoryIdeaCardDraft,
  section: StoryIdeaTermSection
): string[] {
  if (section === 'theme') return draft.themeTerms;
  if (section === 'conflict') return draft.conflictTerms;
  return draft.twistTerms;
}

export function setStoryIdeaTermsBySection(
  draft: StoryIdeaCardDraft,
  section: StoryIdeaTermSection,
  nextTerms: string[]
): StoryIdeaCardDraft {
  const normalized = normalizeIdeaTerms(nextTerms);
  if (section === 'theme') return { ...draft, themeTerms: normalized };
  if (section === 'conflict') return { ...draft, conflictTerms: normalized };
  return { ...draft, twistTerms: normalized };
}

export function mergeStoryIdeaTermPool(
  ...pools: Array<Partial<StoryIdeaTermPoolState> | null | undefined>
): StoryIdeaTermPoolState {
  return {
    theme: normalizeIdeaTermPoolEntries(
      pools.flatMap((pool) => pool?.theme || []),
      'manual'
    ),
    conflict: normalizeIdeaTermPoolEntries(
      pools.flatMap((pool) => pool?.conflict || []),
      'manual'
    ),
    twist: normalizeIdeaTermPoolEntries(
      pools.flatMap((pool) => pool?.twist || []),
      'manual'
    ),
  };
}

export function buildStoryIdeaTermPoolFromCards(cards: StoryIdeaCardRow[]): StoryIdeaTermPoolState {
  return mergeStoryIdeaTermPool(
    cards.reduce<StoryIdeaTermPoolState>((pool, card) => {
      const draft = toStoryIdeaDraft(card);
      pool.theme.push(
        ...draft.themeTerms.map((term): StoryIdeaTermPoolEntry => ({ term, sources: ['history'] }))
      );
      pool.conflict.push(
        ...draft.conflictTerms.map(
          (term): StoryIdeaTermPoolEntry => ({ term, sources: ['history'] })
        )
      );
      pool.twist.push(
        ...draft.twistTerms.map((term): StoryIdeaTermPoolEntry => ({ term, sources: ['history'] }))
      );
      return pool;
    }, createEmptyStoryIdeaTermPool())
  );
}

export function parseStoryIdeaTermPool(raw: string | null | undefined): StoryIdeaTermPoolState {
  if (!raw) return createEmptyStoryIdeaTermPool();
  try {
    const parsed = JSON.parse(raw) as
      | Partial<StoryIdeaTermPoolState>
      | Partial<Record<StoryIdeaTermSection, string[]>>;
    return {
      theme: normalizeIdeaTermPoolEntries(
        (parsed.theme as Array<string | StoryIdeaTermPoolEntry>) || [],
        'manual'
      ),
      conflict: normalizeIdeaTermPoolEntries(
        (parsed.conflict as Array<string | StoryIdeaTermPoolEntry>) || [],
        'manual'
      ),
      twist: normalizeIdeaTermPoolEntries(
        (parsed.twist as Array<string | StoryIdeaTermPoolEntry>) || [],
        'manual'
      ),
    };
  } catch {
    return createEmptyStoryIdeaTermPool();
  }
}

export function serializeStoryIdeaTermPool(pool: StoryIdeaTermPoolState): string {
  return JSON.stringify(mergeStoryIdeaTermPool(pool));
}

export function buildStoryIdeaSnapshot(
  draft: StoryIdeaCardDraft,
  output?: StoryIdeaOutputRow | null
): StoryIdeaSnapshot {
  return {
    title: draft.title.trim() || '未命名创意卡',
    premise: draft.premise.trim(),
    tags: normalizeIdeaTags(draft.tags),
    themeTerms: normalizeIdeaTerms(draft.themeTerms),
    conflictTerms: normalizeIdeaTerms(draft.conflictTerms),
    twistTerms: normalizeIdeaTerms(draft.twistTerms),
    selectedLogline: draft.selectedLogline.trim(),
    selectedDirection: (output?.content || draft.selectedDirection || '').trim(),
    createdFromOutputId: output?.id,
  };
}

export function parseStoryIdeaSnapshot(raw: string | null | undefined): StoryIdeaSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoryIdeaSnapshot>;
    return {
      title: cleanText(parsed.title, 32),
      premise: cleanText(parsed.premise, 80),
      tags: normalizeIdeaTags(parsed.tags || []),
      themeTerms: normalizeIdeaTerms(parsed.themeTerms || []),
      conflictTerms: normalizeIdeaTerms(parsed.conflictTerms || []),
      twistTerms: normalizeIdeaTerms(parsed.twistTerms || []),
      selectedLogline: cleanText(parsed.selectedLogline, 160),
      selectedDirection: cleanText(parsed.selectedDirection, 200),
      createdFromOutputId:
        typeof parsed.createdFromOutputId === 'number' ? parsed.createdFromOutputId : undefined,
    };
  } catch {
    return null;
  }
}

export function replaceStoryIdeaTermRandomly(
  draft: StoryIdeaCardDraft,
  section: StoryIdeaTermSection,
  pool: StoryIdeaTermPoolEntry[]
): StoryIdeaCardDraft | null {
  const currentTerms = getStoryIdeaTermsBySection(draft, section);
  const candidates = pickRandomStoryIdeaTerms(pool, pool.length, currentTerms);
  if (candidates.length === 0) return null;
  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  const targetIndex =
    currentTerms.length > 0 ? Math.floor(Math.random() * currentTerms.length) : currentTerms.length;
  const nextTerms = [...currentTerms];
  if (targetIndex < nextTerms.length) nextTerms[targetIndex] = picked;
  else nextTerms.push(picked);
  return setStoryIdeaTermsBySection(draft, section, nextTerms);
}

export function toStoryIdeaDraft(row: StoryIdeaCardRow | null | undefined): StoryIdeaCardDraft {
  if (!row) {
    return createEmptyStoryIdeaDraft();
  }
  return {
    title: row.title || '未命名创意卡',
    premise: row.premise || '',
    tags: parseTagsJson(row.tags_json),
    source: row.source,
    status: row.status,
    themeTerms: parseSeedTerms(row.theme_seed),
    conflictTerms: parseSeedTerms(row.conflict_seed),
    twistTerms: parseSeedTerms(row.twist_seed),
    selectedLogline: row.selected_logline || '',
    selectedDirection: row.selected_direction || '',
    note: row.note || '',
  };
}

export function draftToStoryIdeaUpdatePayload(draft: StoryIdeaCardDraft) {
  return {
    title: draft.title.trim() || '未命名创意卡',
    premise: draft.premise.trim(),
    tags_json: JSON.stringify(normalizeIdeaTags(draft.tags)),
    source: draft.source,
    status: draft.status,
    theme_seed: serializeIdeaTerms(draft.themeTerms),
    conflict_seed: serializeIdeaTerms(draft.conflictTerms),
    twist_seed: serializeIdeaTerms(draft.twistTerms),
    protagonist_wish: '',
    core_obstacle: '',
    irony_or_gap: '',
    escalation_path: '',
    payoff_hint: '',
    selected_logline: draft.selectedLogline.trim(),
    selected_direction: draft.selectedDirection.trim(),
    note: draft.note.trim(),
  };
}

export function serializeStoryIdeaDraft(draft: StoryIdeaCardDraft): string {
  return JSON.stringify(draftToStoryIdeaUpdatePayload(draft));
}

export function buildStoryIdeaVersionName(draft: StoryIdeaCardDraft): string {
  const base = cleanText(draft.title, 18) || '三签草案';
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `三签草案 ${base} ${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function buildStoryIdeaSearchText(draft: StoryIdeaCardDraft): string {
  return [
    draft.title,
    draft.premise,
    draft.note,
    draft.tags.join(' '),
    draft.themeTerms.join(' '),
    draft.conflictTerms.join(' '),
    draft.twistTerms.join(' '),
  ]
    .join(' ')
    .toLowerCase();
}

export function pickSelectedOutput(
  outputs: StoryIdeaOutputRow[],
  type: StoryIdeaOutputRow['type']
): StoryIdeaOutputRow | null {
  return outputs.find((item) => item.type === type && item.is_selected === 1) || null;
}
