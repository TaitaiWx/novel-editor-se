export function createLoreStorageKey(folderPath: string | null): string | null {
  return folderPath ? `novel-editor:lore:${folderPath}` : null;
}

export function createRelationStorageKey(folderPath: string | null): string | null {
  return folderPath ? `novel-editor:character-relations:${folderPath}` : null;
}

/** 旧版「剧情板」的存储键（按作品目录）；卷纲首次打开时从这里迁移，见 VolumePlanView/volumePlanState.ts */
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
