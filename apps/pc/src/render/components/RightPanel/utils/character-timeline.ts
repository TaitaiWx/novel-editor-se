import type { CharacterTimelineItem } from '../types';

function normalizeTimelineText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function getCharacterTimelineOrderKey(item: CharacterTimelineItem): string {
  return item.autoKey || item.id;
}

export function parseTimelineOrderKeys(raw: string | null | undefined): string[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return Array.from(new Set(parsed.map((item) => normalizeTimelineText(item)).filter(Boolean)));
  } catch {
    return [];
  }
}

export function parseCharacterTimelineItems(
  raw: string | null | undefined
): CharacterTimelineItem[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item): CharacterTimelineItem | null => {
        if (!item || typeof item !== 'object') return null;
        const candidate = item as Record<string, unknown>;
        const id = normalizeTimelineText(candidate.id);
        const title = normalizeTimelineText(candidate.title);
        const summary = normalizeTimelineText(candidate.summary);
        const source = candidate.source === 'manual' ? 'manual' : 'auto';
        if (!id || !title || !summary) return null;
        return {
          id,
          title,
          summary,
          source,
          autoKey: normalizeTimelineText(candidate.autoKey) || undefined,
          chapterLabel: normalizeTimelineText(candidate.chapterLabel) || undefined,
          chapterNumber:
            typeof candidate.chapterNumber === 'number' && Number.isFinite(candidate.chapterNumber)
              ? candidate.chapterNumber
              : undefined,
          sourcePath: normalizeTimelineText(candidate.sourcePath) || undefined,
          startLine:
            typeof candidate.startLine === 'number' && Number.isFinite(candidate.startLine)
              ? candidate.startLine
              : undefined,
          endLine:
            typeof candidate.endLine === 'number' && Number.isFinite(candidate.endLine)
              ? candidate.endLine
              : undefined,
          mentionCount:
            typeof candidate.mentionCount === 'number' && Number.isFinite(candidate.mentionCount)
              ? candidate.mentionCount
              : undefined,
          sourceLabel: normalizeTimelineText(candidate.sourceLabel) || undefined,
        };
      })
      .filter((item): item is CharacterTimelineItem => Boolean(item));
  } catch {
    return [];
  }
}

export function mergeCharacterTimelineItems(
  autoItems: CharacterTimelineItem[],
  persistedItems: CharacterTimelineItem[],
  orderKeys: string[] = []
): CharacterTimelineItem[] {
  const persistedByAutoKey = new Map<string, CharacterTimelineItem>();
  const persistedManualItems: CharacterTimelineItem[] = [];

  persistedItems.forEach((item) => {
    if (item.autoKey) {
      persistedByAutoKey.set(item.autoKey, item);
      return;
    }
    if (item.source === 'manual') {
      persistedManualItems.push(item);
    }
  });

  const knownAutoKeys = new Set<string>();
  const mergedAutoItems = autoItems.map((item) => {
    const autoKey = item.autoKey || item.id;
    knownAutoKeys.add(autoKey);
    const persisted = persistedByAutoKey.get(autoKey);
    if (!persisted) return item;
    return {
      ...item,
      id: persisted.id || item.id,
      title: persisted.title,
      summary: persisted.summary,
      chapterLabel: persisted.chapterLabel || item.chapterLabel,
      chapterNumber: persisted.chapterNumber ?? item.chapterNumber,
      sourcePath: persisted.sourcePath || item.sourcePath,
      startLine: persisted.startLine ?? item.startLine,
      endLine: persisted.endLine ?? item.endLine,
      sourceLabel: persisted.sourceLabel || item.sourceLabel,
    } satisfies CharacterTimelineItem;
  });

  const orphanedPersistedItems = persistedItems
    .filter((item) => item.autoKey && !knownAutoKeys.has(item.autoKey))
    .map((item) => ({
      ...item,
      source: 'manual' as const,
      sourceLabel: item.sourceLabel || '手工整理',
    }));

  const defaultItems = [...mergedAutoItems, ...orphanedPersistedItems, ...persistedManualItems];
  if (orderKeys.length === 0) return defaultItems;

  const itemByOrderKey = new Map<string, CharacterTimelineItem>();
  defaultItems.forEach((item) => {
    itemByOrderKey.set(getCharacterTimelineOrderKey(item), item);
  });

  const usedKeys = new Set<string>();
  const orderedItems: CharacterTimelineItem[] = [];
  orderKeys.forEach((key) => {
    const matched = itemByOrderKey.get(key);
    if (!matched || usedKeys.has(key)) return;
    orderedItems.push(matched);
    usedKeys.add(key);
  });

  defaultItems.forEach((item) => {
    const key = getCharacterTimelineOrderKey(item);
    if (usedKeys.has(key)) return;
    orderedItems.push(item);
    usedKeys.add(key);
  });

  return orderedItems;
}
