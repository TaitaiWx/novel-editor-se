import React, { useCallback } from 'react';
import { CHAPTER_MATERIALS_STORAGE_PREFIX } from '@/render/app/types';
import { createChapterMaterialsStorageKey } from '@/render/utils/workspace';
import { formatMaterialUsageLabel } from '@/render/app/aiGeneration';
import { getNodeDisplayName, isPathInWorkspace } from '@/render/app/fileTreeUtils';
import type { WorkspaceDerivedState } from './useWorkspaceDerivedState';
import type { WorkspaceState } from './state/useWorkspaceState';
import type { EntitiesState } from './state/useEntitiesState';

export type UseChapterMaterialsContext = Pick<
  WorkspaceDerivedState,
  'activeDocumentTab' | 'chapterAssistantEnabled'
> &
  Pick<WorkspaceState, 'folderPath'> &
  Pick<EntitiesState, 'setChapterMaterialPaths' | 'setMaterialUsageMap'>;

/**
 * 章节关联资料：资料使用情况统计与章节资料的增删持久化
 */
export function useChapterMaterials(ctx: UseChapterMaterialsContext) {
  const {
    activeDocumentTab,
    chapterAssistantEnabled,
    folderPath,
    setChapterMaterialPaths,
    setMaterialUsageMap,
  } = ctx;

  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc || !folderPath) {
      setMaterialUsageMap({});
      return;
    }
    let cancelled = false;
    const loadMaterialUsage = async () => {
      try {
        const rows = (await ipc.invoke('db-settings-all')) as Array<{ key: string; value: string }>;
        if (cancelled) return;
        const materialUsage = new Map<string, string[]>();
        rows.forEach((row) => {
          if (
            !row ||
            typeof row.key !== 'string' ||
            !row.key.startsWith(CHAPTER_MATERIALS_STORAGE_PREFIX)
          ) {
            return;
          }
          const chapterPath = row.key.slice(CHAPTER_MATERIALS_STORAGE_PREFIX.length);
          if (!chapterPath || !isPathInWorkspace(chapterPath, folderPath)) return;
          let materialPaths: unknown;
          try {
            materialPaths = JSON.parse(row.value);
          } catch {
            return;
          }
          if (!Array.isArray(materialPaths)) return;
          const chapterName = getNodeDisplayName(chapterPath);
          materialPaths.forEach((materialPath) => {
            if (typeof materialPath !== 'string' || !isPathInWorkspace(materialPath, folderPath)) {
              return;
            }
            const next = materialUsage.get(materialPath) ?? [];
            next.push(chapterName);
            materialUsage.set(materialPath, next);
          });
        });
        setMaterialUsageMap(
          Object.fromEntries(
            Array.from(materialUsage.entries()).map(([materialPath, chapterNames]) => [
              materialPath,
              formatMaterialUsageLabel(chapterNames),
            ])
          )
        );
      } catch {
        if (!cancelled) {
          setMaterialUsageMap({});
        }
      }
    };
    const dispose = ipc.on?.('settings-updated', (_event, key?: string) => {
      if (
        typeof key === 'string' &&
        key.startsWith(CHAPTER_MATERIALS_STORAGE_PREFIX) &&
        !cancelled
      ) {
        void loadMaterialUsage();
      }
    });
    void loadMaterialUsage();
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [folderPath]);

  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    const storageKey = createChapterMaterialsStorageKey(activeDocumentTab);
    if (!ipc || !storageKey || !chapterAssistantEnabled) {
      setChapterMaterialPaths([]);
      return;
    }
    let cancelled = false;
    const loadChapterMaterials = async () => {
      try {
        const raw = (await ipc.invoke('db-settings-get', storageKey)) as string | null;
        if (cancelled) return;
        const parsed = raw ? (JSON.parse(raw) as string[]) : [];
        setChapterMaterialPaths(
          Array.isArray(parsed)
            ? parsed.filter((item): item is string => typeof item === 'string')
            : []
        );
      } catch {
        if (!cancelled) setChapterMaterialPaths([]);
      }
    };
    void loadChapterMaterials();
    return () => {
      cancelled = true;
    };
  }, [activeDocumentTab, chapterAssistantEnabled]);

  const persistChapterMaterials = useCallback(
    async (nextPaths: string[]) => {
      const ipc = window.electron?.ipcRenderer;
      const storageKey = createChapterMaterialsStorageKey(activeDocumentTab);
      if (!ipc || !storageKey) return;
      await ipc.invoke('db-settings-set', storageKey, JSON.stringify(nextPaths));
    },
    [activeDocumentTab]
  );

  const handleAddChapterMaterial = useCallback(
    (path: string) => {
      setChapterMaterialPaths((prev) => {
        if (prev.includes(path)) return prev;
        const next = [...prev, path];
        void persistChapterMaterials(next);
        return next;
      });
    },
    [persistChapterMaterials]
  );

  const handleRemoveChapterMaterial = useCallback(
    (path: string) => {
      setChapterMaterialPaths((prev) => {
        const next = prev.filter((item) => item !== path);
        void persistChapterMaterials(next);
        return next;
      });
    },
    [persistChapterMaterials]
  );

  return {
    persistChapterMaterials,
    handleAddChapterMaterial,
    handleRemoveChapterMaterial,
  };
}

export type ChapterMaterialsApi = ReturnType<typeof useChapterMaterials>;
