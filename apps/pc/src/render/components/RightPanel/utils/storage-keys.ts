import type { ActNode } from '@novel-editor/basic-algorithm';

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

export function createCharacterTimelineStorageKey(
  novelId: number | null,
  characterId: number
): string | null {
  return novelId === null ? null : `novel-editor:character-timeline:${novelId}:${characterId}`;
}

export function createCharacterTimelineOrderStorageKey(
  novelId: number | null,
  characterId: number
): string | null {
  return novelId === null
    ? null
    : `novel-editor:character-timeline-order:${novelId}:${characterId}`;
}

export function createActBoardKey(act: ActNode, index: number): string {
  return `${index}:${act.line}:${act.title}`;
}
