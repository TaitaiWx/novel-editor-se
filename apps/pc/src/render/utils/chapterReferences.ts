import type { ChapterMetadata } from './chapterWorkspace';

export interface ChapterReferenceCandidate {
  id: number;
  name: string;
  aliases?: string[];
  tags?: string[];
}

type ReferenceKind = 'character' | 'lore';

function uniqueIds(values: number[]): number[] {
  return Array.from(new Set(values.filter((value) => Number.isFinite(value)))).sort((a, b) => a - b);
}

function arraysEqual(left: number[] | undefined, right: number[] | undefined): boolean {
  const normalizedLeft = uniqueIds(left || []);
  const normalizedRight = uniqueIds(right || []);
  if (normalizedLeft.length !== normalizedRight.length) return false;
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSearchableText(value: string): string {
  return value.replace(/[\s"'`~!@#$%^&*()\-_=+[\]{};:,.<>/?\\|，。！？；：、（）《》【】“”‘’·]/g, '').toLowerCase();
}

function hasCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function shouldIgnoreToken(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (hasCjk(trimmed)) {
    return normalizeSearchableText(trimmed).length < 2;
  }
  return trimmed.replace(/\s+/g, '').length < 3;
}

function matchesToken(rawText: string, normalizedText: string, token: string): boolean {
  if (shouldIgnoreToken(token)) return false;
  if (hasCjk(token)) {
    return normalizedText.includes(normalizeSearchableText(token));
  }

  const pattern = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(token)}([^A-Za-z0-9_]|$)`, 'i');
  return pattern.test(rawText);
}

export function detectReferenceIds(
  rawText: string,
  candidates: ChapterReferenceCandidate[]
): number[] {
  if (!rawText.trim()) return [];

  const normalizedText = normalizeSearchableText(rawText);
  return uniqueIds(
    candidates
      .filter((candidate) => {
        const tokens = [candidate.name, ...(candidate.aliases || []), ...(candidate.tags || [])];
        return tokens.some((token) => matchesToken(rawText, normalizedText, token));
      })
      .map((candidate) => candidate.id)
  );
}

function getManualKey(kind: ReferenceKind): keyof ChapterMetadata {
  return kind === 'character' ? 'linkedCharacterIds' : 'linkedLoreIds';
}

function getAutoKey(kind: ReferenceKind): keyof ChapterMetadata {
  return kind === 'character' ? 'autoLinkedCharacterIds' : 'autoLinkedLoreIds';
}

function getDismissedKey(kind: ReferenceKind): keyof ChapterMetadata {
  return kind === 'character' ? 'dismissedCharacterIds' : 'dismissedLoreIds';
}

export function buildEffectiveReferenceIds(
  metadata: ChapterMetadata,
  kind: ReferenceKind
): number[] {
  const manualIds = (metadata[getManualKey(kind)] as number[] | undefined) || [];
  const autoIds = (metadata[getAutoKey(kind)] as number[] | undefined) || [];
  const dismissedIds = new Set((metadata[getDismissedKey(kind)] as number[] | undefined) || []);

  return uniqueIds([...autoIds.filter((id) => !dismissedIds.has(id)), ...manualIds]);
}

export function deriveReferenceOverrideState(
  selectedIds: number[],
  autoIds: number[]
): {
  manualIds: number[];
  dismissedIds: number[];
} {
  const normalizedSelected = uniqueIds(selectedIds);
  const normalizedAuto = uniqueIds(autoIds);
  return {
    manualIds: normalizedSelected.filter((id) => !normalizedAuto.includes(id)),
    dismissedIds: normalizedAuto.filter((id) => !normalizedSelected.includes(id)),
  };
}

export function withAutoReferenceIds(
  metadata: ChapterMetadata,
  nextCharacterIds: number[],
  nextLoreIds: number[]
): ChapterMetadata {
  return {
    ...metadata,
    autoLinkedCharacterIds: uniqueIds(nextCharacterIds),
    autoLinkedLoreIds: uniqueIds(nextLoreIds),
  };
}

export function autoReferenceIdsChanged(
  metadata: ChapterMetadata,
  nextCharacterIds: number[],
  nextLoreIds: number[]
): boolean {
  return !arraysEqual(metadata.autoLinkedCharacterIds, nextCharacterIds) ||
    !arraysEqual(metadata.autoLinkedLoreIds, nextLoreIds);
}
