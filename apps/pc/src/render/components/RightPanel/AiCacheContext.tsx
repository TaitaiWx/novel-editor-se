import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { migrateCacheKey } from './utils';

interface AiCacheContextValue {
  /** L1 in-memory title cache (stable Map reference) */
  titleCache: Map<string, string>;
  /** L1 in-memory summary cache (stable Map reference) */
  summaryCache: Map<string, string>;
  /** Whether both caches have finished SQLite hydration */
  cacheReady: boolean;
}

const AiCacheContext = createContext<AiCacheContextValue | null>(null);

/**
 * Provides centralised L1 cache Maps for AI titles & summaries.
 *
 * Placed ABOVE OutlineView so that cache survives tab-switching
 * (目录 ↔ 情节板) and any OutlineView unmount/remount cycles.
 *
 * Hydration from SQLite runs exactly once per dbReady transition.
 */
export const AiCacheProvider: React.FC<{
  dbReady: boolean;
  children: React.ReactNode;
}> = ({ dbReady, children }) => {
  const titleCacheRef = useRef(new Map<string, string>());
  const summaryCacheRef = useRef(new Map<string, string>());
  const [cacheReady, setCacheReady] = useState(false);

  useEffect(() => {
    if (!dbReady) return;
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) {
      setCacheReady(true);
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        // --- Hydrate titles ---
        const titleRows = (await ipc.invoke('ai-cache-get-by-type', 'title')) as
          | { cache_key: string; value: string }[]
          | undefined;
        if (cancelled) return;
        if (titleRows?.length) {
          for (const row of titleRows) {
            const newKey = migrateCacheKey(row.cache_key);
            const key = newKey ?? row.cache_key;
            titleCacheRef.current.set(key, row.value);
            if (newKey) {
              void ipc.invoke('ai-cache-set', newKey, 'title', row.value);
              void ipc.invoke('ai-cache-delete', row.cache_key, 'title');
            }
          }
        }

        // --- Hydrate summaries ---
        const summaryRows = (await ipc.invoke('ai-cache-get-by-type', 'summary')) as
          | { cache_key: string; value: string }[]
          | undefined;
        if (cancelled) return;
        if (summaryRows?.length) {
          for (const row of summaryRows) {
            const newKey = migrateCacheKey(row.cache_key);
            const key = newKey ?? row.cache_key;
            summaryCacheRef.current.set(key, row.value);
            if (newKey) {
              void ipc.invoke('ai-cache-set', newKey, 'summary', row.value);
              void ipc.invoke('ai-cache-delete', row.cache_key, 'summary');
            }
          }
        }

        // TTL-based GC: clean up entries older than 30 days
        void ipc.invoke('ai-cache-cleanup', 30);

        // Touch all hydrated keys to refresh TTL
        const touchedKeys: Array<{ cacheKey: string; type: string }> = [];
        for (const [key] of titleCacheRef.current) {
          touchedKeys.push({ cacheKey: key, type: 'title' });
        }
        for (const [key] of summaryCacheRef.current) {
          touchedKeys.push({ cacheKey: key, type: 'summary' });
        }
        if (touchedKeys.length > 0) {
          void ipc.invoke('ai-cache-touch-keys', touchedKeys);
        }
      } catch {
        // DB read failed — degrade gracefully, hooks will work without pre-loaded cache
      } finally {
        if (!cancelled) setCacheReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dbReady]);

  const value = useMemo<AiCacheContextValue>(
    () => ({
      titleCache: titleCacheRef.current,
      summaryCache: summaryCacheRef.current,
      cacheReady,
    }),
    [cacheReady]
  );

  return <AiCacheContext.Provider value={value}>{children}</AiCacheContext.Provider>;
};

export function useAiCache(): AiCacheContextValue {
  const ctx = useContext(AiCacheContext);
  if (!ctx) throw new Error('useAiCache must be used within <AiCacheProvider>');
  return ctx;
}
