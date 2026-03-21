import type { LoreCategory, LoreEntry } from './types';

interface LoreRow {
  id: number;
  category: string;
  title: string;
  content: string;
  tags: string;
  created_at: string;
  updated_at: string;
}

export interface LoreDraft {
  category: LoreCategory;
  title: string;
  summary: string;
  tags?: string[];
}

function normalizeCategory(category: string): LoreCategory {
  if (
    category === 'world' ||
    category === 'faction' ||
    category === 'system' ||
    category === 'term'
  ) {
    return category;
  }
  return 'world';
}

export function mapLoreRow(row: LoreRow): LoreEntry {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags || '[]');
    if (Array.isArray(parsed)) {
      tags = parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    tags = [];
  }

  return {
    id: row.id,
    category: normalizeCategory(row.category),
    title: row.title || '',
    summary: row.content || '',
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadLoreEntriesByFolder(folderPath: string | null): Promise<LoreEntry[]> {
  const ipc = window.electron?.ipcRenderer;
  if (!ipc || !folderPath) {
    return [];
  }

  const rows = (await ipc.invoke('db-world-setting-list-by-folder', folderPath)) as LoreRow[];
  return rows.map(mapLoreRow);
}

export function buildLoreDedupKey(entry: Pick<LoreDraft, 'category' | 'title'>): string {
  return `${entry.category}::${entry.title.trim().toLowerCase()}`;
}
