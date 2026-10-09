import { useCallback, useEffect, useState } from 'react';
import type { LoreCategory, LoreEntry } from './types';
import { createLoreStorageKey } from './utils';
import {
  buildLoreDedupKey,
  loadLoreEntriesByFolder,
  stringifyLoreAttributes,
  type LoreDraft,
} from './lore-data';

interface LegacyLoreEntry {
  category?: LoreCategory;
  title?: string;
  summary?: string;
}

async function migrateLegacyLoreIfNeeded(folderPath: string | null, existing: LoreEntry[]) {
  const ipc = window.electron?.ipcRenderer;
  if (!ipc || !folderPath || existing.length > 0) {
    return false;
  }

  const legacyKey = createLoreStorageKey(folderPath);
  if (!legacyKey) {
    return false;
  }

  const raw = (await ipc.invoke('db-settings-get', legacyKey)) as string | null | undefined;
  if (!raw) {
    return false;
  }

  let parsed: LegacyLoreEntry[] = [];
  try {
    const value = JSON.parse(raw) as LegacyLoreEntry[];
    parsed = Array.isArray(value) ? value : [];
  } catch {
    parsed = [];
  }

  const entries = parsed
    .map((item) => ({
      category: item.category || 'world',
      title: item.title?.trim() || '',
      summary: item.summary?.trim() || '',
    }))
    .filter((item) => item.title);

  if (entries.length === 0) {
    return false;
  }

  await ipc.invoke(
    'db-world-setting-bulk-create-by-folder',
    folderPath,
    entries.map((item) => ({
      category: item.category,
      title: item.title,
      content: item.summary,
      tags: '[]',
    }))
  );
  return true;
}

export function useLoreEntries(folderPath: string | null) {
  const [entries, setEntries] = useState<LoreEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      let nextEntries = await loadLoreEntriesByFolder(folderPath);
      const migrated = await migrateLegacyLoreIfNeeded(folderPath, nextEntries);
      if (migrated) {
        nextEntries = await loadLoreEntriesByFolder(folderPath);
      }
      setEntries(nextEntries);
    } catch (error) {
      // 数据库读取失败时保留当前条目，避免未处理的 Promise 拒绝
      console.error('[lore] 加载设定条目失败:', error);
    } finally {
      setLoading(false);
    }
  }, [folderPath]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createEntry = useCallback(
    async (draft: LoreDraft) => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc || !folderPath) return;
      await ipc.invoke(
        'db-world-setting-create-by-folder',
        folderPath,
        draft.category,
        draft.title,
        draft.summary,
        JSON.stringify(draft.tags || []),
        stringifyLoreAttributes({
          folder: draft.folder,
          group: draft.group,
          cover: draft.cover,
          media: draft.media,
        })
      );
      await reload();
    },
    [folderPath, reload]
  );

  const updateEntry = useCallback(
    async (id: number, patch: Partial<LoreDraft>) => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return;
      const current = entries.find((entry) => entry.id === id);
      const touchesAttributes =
        patch.folder !== undefined ||
        patch.group !== undefined ||
        patch.cover !== undefined ||
        patch.media !== undefined;
      await ipc.invoke('db-world-setting-update', id, {
        category: patch.category,
        title: patch.title,
        content: patch.summary,
        tags: patch.tags ? JSON.stringify(patch.tags) : undefined,
        attributes: touchesAttributes
          ? stringifyLoreAttributes({
              folder: patch.folder ?? current?.folder,
              group: patch.group ?? current?.group,
              cover: patch.cover ?? current?.cover,
              media: patch.media ?? current?.media,
            })
          : undefined,
      });
      await reload();
    },
    [entries, reload]
  );

  const deleteEntry = useCallback(
    async (id: number) => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return;
      await ipc.invoke('db-world-setting-delete', id);
      await reload();
    },
    [reload]
  );

  const importEntries = useCallback(
    async (drafts: LoreDraft[]) => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc || !folderPath || drafts.length === 0) {
        return { imported: 0, skipped: drafts.length };
      }

      const existingKeys = new Set(entries.map((item) => buildLoreDedupKey(item)));
      const deduped = drafts.filter((draft) => {
        const key = buildLoreDedupKey(draft);
        if (existingKeys.has(key)) {
          return false;
        }
        existingKeys.add(key);
        return true;
      });

      if (deduped.length > 0) {
        await ipc.invoke(
          'db-world-setting-bulk-create-by-folder',
          folderPath,
          deduped.map((item) => ({
            category: item.category,
            title: item.title,
            content: item.summary,
            tags: JSON.stringify(item.tags || []),
          }))
        );
        await reload();
      }

      return { imported: deduped.length, skipped: drafts.length - deduped.length };
    },
    [entries, folderPath, reload]
  );

  return {
    entries,
    loading,
    reload,
    createEntry,
    updateEntry,
    deleteEntry,
    importEntries,
  };
}
