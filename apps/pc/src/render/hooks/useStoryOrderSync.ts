import React, { useCallback } from 'react';
import { type StoryOrderMap, createStoryOrderStorageKey } from '@/render/utils/workspace';
import { parseStoryOrderMap } from '@/render/app/storyOrder';
import type { WorkspaceState } from './state/useWorkspaceState';

export type UseStoryOrderSyncContext = Pick<
  WorkspaceState,
  'folderPathRef' | 'setStoryOrderMap' | 'storyOrderMapRef' | 'storyOrderStorageKey'
>;

/**
 * 正文排序映射的加载与持久化
 */
export function useStoryOrderSync(ctx: UseStoryOrderSyncContext) {
  const { folderPathRef, setStoryOrderMap, storyOrderMapRef, storyOrderStorageKey } = ctx;

  React.useEffect(() => {
    let cancelled = false;
    const ipc = window.electron?.ipcRenderer;

    if (!ipc || !storyOrderStorageKey) {
      storyOrderMapRef.current = {};
      setStoryOrderMap({});
      return;
    }

    const loadStoryOrderMap = async () => {
      try {
        const raw = (await ipc.invoke('db-settings-get', storyOrderStorageKey)) as string | null;
        if (cancelled) return;
        const nextStoryOrderMap = parseStoryOrderMap(raw);
        storyOrderMapRef.current = nextStoryOrderMap;
        setStoryOrderMap(nextStoryOrderMap);
      } catch {
        if (cancelled) return;
        storyOrderMapRef.current = {};
        setStoryOrderMap({});
      }
    };

    void loadStoryOrderMap();
    return () => {
      cancelled = true;
    };
  }, [setStoryOrderMap, storyOrderMapRef, storyOrderStorageKey]);

  const persistStoryOrderMap = useCallback(
    async (nextStoryOrderMap: StoryOrderMap) => {
      const ipc = window.electron?.ipcRenderer;
      const storageKey = createStoryOrderStorageKey(folderPathRef.current);
      if (!ipc || !storageKey) return;
      await ipc.invoke('db-settings-set', storageKey, JSON.stringify(nextStoryOrderMap));
    },
    [folderPathRef]
  );

  return {
    persistStoryOrderMap,
  };
}

export type StoryOrderSync = ReturnType<typeof useStoryOrderSync>;
