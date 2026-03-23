import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { OutlineEntry, OutlineAiState } from './types';
import {
  OUTLINE_AI_DEBOUNCE_MS,
  OUTLINE_AI_BATCH_SIZE,
  OUTLINE_AI_MAX_CONCURRENCY,
  OUTLINE_AI_PREFETCH_SIZE,
} from './constants';
import { buildOutlineEntryCacheKey, parseOutlineTitleCompletions } from './utils';
import { useAiCache } from './AiCacheContext';
import { useAiConfig } from './useAiConfig';
import { useDebounce } from './useDebounce';

// ─────────────────────────────────────────────────────────────────────────────
// Architecture: 4-phase pipeline
//
//   Phase 1 – Resolution  : classify every entry (resolved / pending / failed / loading)
//   Phase 2 – Prioritisation : sort pending by visibility & proximity
//   Phase 3 – Request engine : queue → batch → API → persist
//   Phase 4 – Auto-prefetch  : debounced trigger for visible pending entries
//
// The Resolution phase is the SINGLE source of truth. Downstream phases
// only see entries that Resolution explicitly marks as "pending".
// This eliminates scattered if-else cache checks.
// ─────────────────────────────────────────────────────────────────────────────

/** Categorised result of Phase 1 */
interface TitleResolution {
  /** cacheKey → title for every resolved entry (from persistent cache OR API) */
  titles: Record<string, string>;
  /** Entries that genuinely need AI generation */
  pending: OutlineEntry[];
  /** Entries whose last attempt failed */
  failed: OutlineEntry[];
  /** Number of entries currently in-flight */
  loadingCount: number;
}

const EMPTY_RESOLUTION: TitleResolution = {
  titles: {},
  pending: [],
  failed: [],
  loadingCount: 0,
};

export function useAiTitles(
  content: string,
  outlineEntries: OutlineEntry[],
  activeLine: number | null,
  visibleLines: Set<number>
) {
  const { ready: aiReady } = useAiConfig();
  const { titleCache, cacheReady } = useAiCache();

  // Debounce content (300ms) to reduce effect churn on every keystroke
  const debouncedContent = useDebounce(content, 300);

  // ─── API-local state (populated only by runBatch API results) ─────────────
  const [aiTitlesByKey, setAiTitlesByKey] = useState<Record<string, string>>({});
  const [aiStatesByKey, setAiStatesByKey] = useState<Record<string, OutlineAiState>>({});
  const [aiErrorsByKey, setAiErrorsByKey] = useState<Record<string, string>>({});

  // Refs for closure access inside processQueue / debounce callbacks
  const queueRef = useRef<OutlineEntry[]>([]);
  const inFlightRef = useRef(0);
  const debounceTimerRef = useRef<number | null>(null);
  const requestGenerationRef = useRef(0);
  const contentRef = useRef(content);
  contentRef.current = content;
  const outlineEntriesRef = useRef(outlineEntries);
  outlineEntriesRef.current = outlineEntries;
  const aiReadyRef = useRef(aiReady);
  aiReadyRef.current = aiReady;
  const aiTitlesByKeyRef = useRef(aiTitlesByKey);
  aiTitlesByKeyRef.current = aiTitlesByKey;

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 1 – Resolution
  //
  // Classifies EVERY entry by checking:
  //   L1: titleCache (persistent Map hydrated from SQLite)
  //   L2: aiTitlesByKey (API-resolved this session, not yet in L1 at render time)
  //   L3: aiStatesByKey (inflight / error markers)
  //
  // Key dep: cacheReady — forces re-computation when the persistent cache
  // finishes hydration. Without this, titleCache.has() returns false for
  // entries that ARE cached, because the memo ran before hydration completed
  // and titleCache is a stable Map ref that doesn't trigger memo re-runs.
  // ═══════════════════════════════════════════════════════════════════════════
  const resolution = useMemo<TitleResolution>(() => {
    if (!cacheReady) return EMPTY_RESOLUTION;

    const titles: Record<string, string> = {};
    const pending: OutlineEntry[] = [];
    const failed: OutlineEntry[] = [];
    let loadingCount = 0;

    for (const entry of outlineEntries) {
      if (!entry.needsAiTitle) continue;
      const key = buildOutlineEntryCacheKey(entry);

      // L1: persistent cache (hydrated from SQLite, mutated by runBatch)
      const cached = titleCache.get(key);
      if (cached) {
        titles[key] = cached;
        continue;
      }

      // L2: API-resolved this session
      const local = aiTitlesByKey[key];
      if (local?.trim()) {
        titles[key] = local;
        continue;
      }

      // L3: check inflight / error state
      const state = aiStatesByKey[key];
      if (state === 'loading') {
        loadingCount++;
      } else if (state === 'error') {
        failed.push(entry);
      } else {
        pending.push(entry);
      }
    }

    return { titles, pending, failed, loadingCount };
  }, [outlineEntries, cacheReady, titleCache, aiTitlesByKey, aiStatesByKey]);

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 2 – Prioritisation
  // Sort pending by: active line > visible > off-screen, then by proximity.
  // ═══════════════════════════════════════════════════════════════════════════
  const prioritizedPending = useMemo(() => {
    return [...resolution.pending].sort((a, b) => {
      const aPri = a.line === activeLine ? 0 : visibleLines.has(a.line) ? 1 : 2;
      const bPri = b.line === activeLine ? 0 : visibleLines.has(b.line) ? 1 : 2;
      if (aPri !== bPri) return aPri - bPri;
      if (activeLine === null) return a.line - b.line;
      return Math.abs(a.line - activeLine) - Math.abs(b.line - activeLine);
    });
  }, [resolution.pending, activeLine, visibleLines]);

  const visiblePendingCount = useMemo(
    () => prioritizedPending.filter((e) => visibleLines.has(e.line)).length,
    [prioritizedPending, visibleLines]
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 3 – Request engine
  // ═══════════════════════════════════════════════════════════════════════════
  const processQueue = useCallback(() => {
    if (!aiReadyRef.current) return;
    if (!contentRef.current.trim()) return;
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const generation = requestGenerationRef.current;

    const runBatch = async (entries: OutlineEntry[]) => {
      // Final cache gate: re-check right before API call.
      // Between queue-time and now, cache may have been populated.
      const uncached = entries.filter((entry) => {
        const cacheKey = buildOutlineEntryCacheKey(entry);
        if (titleCache.has(cacheKey)) return false;
        return !aiTitlesByKeyRef.current[cacheKey]?.trim();
      });

      if (!uncached.length) return;

      const cacheKeys = uncached.map((entry) => buildOutlineEntryCacheKey(entry));
      setAiStatesByKey((prev) => {
        const next = { ...prev };
        cacheKeys.forEach((k) => {
          next[k] = 'loading';
        });
        return next;
      });
      setAiErrorsByKey((prev) => {
        const next = { ...prev };
        cacheKeys.forEach((k) => {
          delete next[k];
        });
        return next;
      });

      try {
        const response = (await ipc.invoke('ai-request', {
          prompt:
            '请根据每个章节的原始标题和内容摘要，补全缺失或过于泛化的章节标题。只返回 JSON 数组，每项包含 line 和 title。title 必须是简洁中文标题，不超过 18 个字；如果原始标题是"第一章"这类泛标题，只返回补充副标题，不要重复序号。',
          systemPrompt:
            '你是小说章节标题编辑。你只能输出严格 JSON，不要解释，不要 Markdown，不要代码块外文本。',
          context: [
            `正文抽样:\n${contentRef.current.slice(0, 5000)}`,
            `待补全章节:\n${uncached
              .map(
                (entry) =>
                  `line=${entry.line}\n原始标题=${entry.originalText || '（无）'}\n内容摘要=${entry.summary}`
              )
              .join('\n\n')}`,
          ].join('\n\n'),
          maxTokens: 8192,
          temperature: 1.3,
        })) as { ok: boolean; text?: string; error?: string };

        if (generation !== requestGenerationRef.current) return;

        if (!response.ok) {
          const message = response.error || 'AI 标题补全失败';
          setAiStatesByKey((prev) => {
            const next = { ...prev };
            cacheKeys.forEach((k) => {
              next[k] = 'error';
            });
            return next;
          });
          setAiErrorsByKey((prev) => {
            const next = { ...prev };
            cacheKeys.forEach((k) => {
              next[k] = message;
            });
            return next;
          });
          return;
        }

        const completions = parseOutlineTitleCompletions(response.text || '');
        const completionMap = new Map<number, string>();
        completions.forEach((item) => completionMap.set(item.line, item.title.trim()));

        setAiTitlesByKey((prev) => {
          const next = { ...prev };
          uncached.forEach((entry) => {
            const title = completionMap.get(entry.line);
            if (title) {
              const cacheKey = buildOutlineEntryCacheKey(entry);
              next[cacheKey] = title;
              titleCache.set(cacheKey, title);
              void ipc.invoke('ai-cache-set', cacheKey, 'title', title);
            }
          });
          return next;
        });
        setAiStatesByKey((prev) => {
          const next = { ...prev };
          uncached.forEach((entry) => {
            next[buildOutlineEntryCacheKey(entry)] = completionMap.get(entry.line)
              ? 'success'
              : 'error';
          });
          return next;
        });
        setAiErrorsByKey((prev) => {
          const next = { ...prev };
          uncached.forEach((entry) => {
            const cacheKey = buildOutlineEntryCacheKey(entry);
            if (completionMap.get(entry.line)) {
              delete next[cacheKey];
            } else {
              next[cacheKey] = '该章节未返回可用标题';
            }
          });
          return next;
        });
      } catch (error) {
        if (generation !== requestGenerationRef.current) return;
        const message = error instanceof Error ? error.message : 'AI 标题补全失败';
        setAiStatesByKey((prev) => {
          const next = { ...prev };
          cacheKeys.forEach((k) => {
            next[k] = 'error';
          });
          return next;
        });
        setAiErrorsByKey((prev) => {
          const next = { ...prev };
          cacheKeys.forEach((k) => {
            next[k] = message;
          });
          return next;
        });
      }
    };

    const startNext = () => {
      while (inFlightRef.current < OUTLINE_AI_MAX_CONCURRENCY && queueRef.current.length > 0) {
        const batch = queueRef.current.splice(0, OUTLINE_AI_BATCH_SIZE);
        inFlightRef.current += 1;
        void runBatch(batch).finally(() => {
          inFlightRef.current = Math.max(0, inFlightRef.current - 1);
          startNext();
        });
      }
    };

    startNext();
  }, [titleCache]);

  const requestAiTitles = useCallback(
    (entries: OutlineEntry[]) => {
      if (!entries.length) return;
      const dedupMap = new Map<number, OutlineEntry>();
      entries.forEach((entry) => dedupMap.set(entry.line, entry));
      const uniqueEntries = Array.from(dedupMap.values());

      setAiStatesByKey((prev) => {
        let changed = false;
        const next = { ...prev };
        uniqueEntries.forEach((entry) => {
          const cacheKey = buildOutlineEntryCacheKey(entry);
          if (next[cacheKey] === 'error') {
            next[cacheKey] = 'idle';
            changed = true;
          }
        });
        return changed ? next : prev;
      });
      setAiErrorsByKey((prev) => {
        let changed = false;
        const next = { ...prev };
        uniqueEntries.forEach((entry) => {
          const cacheKey = buildOutlineEntryCacheKey(entry);
          if (cacheKey in next) {
            delete next[cacheKey];
            changed = true;
          }
        });
        return changed ? next : prev;
      });

      const queuedLines = new Set(queueRef.current.map((item) => item.line));
      uniqueEntries.forEach((entry) => {
        if (!queuedLines.has(entry.line)) {
          queueRef.current.push(entry);
          queuedLines.add(entry.line);
        }
      });
      processQueue();
    },
    [processQueue]
  );

  // ─── Content change: reset generation & queue ─────────────────────────────
  // No cache → state promotion needed: resolution reads titleCache directly.
  useEffect(() => {
    requestGenerationRef.current += 1;
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    queueRef.current = [];
    inFlightRef.current = 0;
  }, [debouncedContent]);

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 4 – Auto-prefetch
  //
  // Only fires when ALL conditions are met:
  //   - AI configured & cache hydrated
  //   - Content is non-empty
  //   - Phase 1 says there are visible pending entries (visiblePendingCount > 0)
  //
  // The debounce callback uses prioritizedPending directly — already filtered
  // by the Resolution phase. No redundant cache re-checks needed.
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!aiReady || !cacheReady || !debouncedContent.trim() || visiblePendingCount === 0) return;
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      const visiblePending = prioritizedPending.filter((e) => visibleLines.has(e.line));
      if (visiblePending.length > 0) {
        requestAiTitles(visiblePending.slice(0, OUTLINE_AI_PREFETCH_SIZE));
      }
    }, OUTLINE_AI_DEBOUNCE_MS);
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, [
    aiReady,
    cacheReady,
    debouncedContent,
    visiblePendingCount,
    prioritizedPending,
    requestAiTitles,
    visibleLines,
  ]);

  // ─── Output memos ─────────────────────────────────────────────────────────
  // All derive from resolution.titles (which combines persistent cache + API).
  const aiTitles = useMemo(() => {
    const out: Record<number, string> = {};
    for (const entry of outlineEntries) {
      const title = resolution.titles[buildOutlineEntryCacheKey(entry)];
      if (title) out[entry.line] = title;
    }
    return out;
  }, [outlineEntries, resolution.titles]);

  const aiStates = useMemo(() => {
    const out: Record<number, OutlineAiState> = {};
    for (const entry of outlineEntries) {
      if (!entry.needsAiTitle) continue;
      const key = buildOutlineEntryCacheKey(entry);
      if (resolution.titles[key]) {
        out[entry.line] = 'success';
        continue;
      }
      const state = aiStatesByKey[key];
      if (state) out[entry.line] = state;
    }
    return out;
  }, [outlineEntries, resolution.titles, aiStatesByKey]);

  const aiErrors = useMemo(() => {
    const out: Record<number, string> = {};
    for (const entry of outlineEntries) {
      const err = aiErrorsByKey[buildOutlineEntryCacheKey(entry)];
      if (err) out[entry.line] = err;
    }
    return out;
  }, [outlineEntries, aiErrorsByKey]);

  return {
    aiTitles,
    aiStates,
    aiErrors,
    failedAiEntries: resolution.failed,
    requestAiTitles,
    retryAiEntry: useCallback((entry: OutlineEntry) => requestAiTitles([entry]), [requestAiTitles]),
    retryFailedEntries: useCallback(() => {
      if (resolution.failed.length) requestAiTitles(resolution.failed);
    }, [resolution.failed, requestAiTitles]),
  };
}
