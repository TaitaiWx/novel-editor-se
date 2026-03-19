import { useState, useCallback, useRef, useEffect } from 'react';
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

export function useAiTitles(
  content: string,
  outlineEntries: OutlineEntry[],
  activeLine: number | null,
  visibleLines: Set<number>
) {
  const { ready: aiReady } = useAiConfig();
  const { titleCache, cacheReady } = useAiCache();

  const [aiTitles, setAiTitles] = useState<Record<number, string>>({});
  const [aiStates, setAiStates] = useState<Record<number, OutlineAiState>>({});
  const [aiErrors, setAiErrors] = useState<Record<number, string>>({});

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

  const pendingAiEntries = (() => {
    const candidates = outlineEntries.filter((entry) => {
      if (!entry.needsAiTitle) return false;
      if (aiTitles[entry.line]?.trim()) return false;
      return aiStates[entry.line] !== 'loading' && aiStates[entry.line] !== 'error';
    });
    return candidates.sort((a, b) => {
      const aPriority = a.line === activeLine ? 0 : visibleLines.has(a.line) ? 1 : 2;
      const bPriority = b.line === activeLine ? 0 : visibleLines.has(b.line) ? 1 : 2;
      if (aPriority !== bPriority) return aPriority - bPriority;
      if (activeLine === null) return a.line - b.line;
      return Math.abs(a.line - activeLine) - Math.abs(b.line - activeLine);
    });
  })();

  const failedAiEntries = outlineEntries.filter(
    (entry) => entry.needsAiTitle && aiStates[entry.line] === 'error' && !aiTitles[entry.line]
  );

  const processQueue = useCallback(() => {
    if (!aiReadyRef.current) return;
    if (!contentRef.current.trim()) return;
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const generation = requestGenerationRef.current;

    const runBatch = async (entries: OutlineEntry[]) => {
      const uncached = entries.filter((entry) => !titleCache.get(buildOutlineEntryCacheKey(entry)));

      if (uncached.length !== entries.length) {
        setAiTitles((prev) => {
          let changed = false;
          const next = { ...prev };
          entries.forEach((entry) => {
            const c = titleCache.get(buildOutlineEntryCacheKey(entry));
            if (c && next[entry.line] !== c) {
              next[entry.line] = c;
              changed = true;
            }
          });
          return changed ? next : prev;
        });
        setAiStates((prev) => {
          let changed = false;
          const next = { ...prev };
          entries.forEach((entry) => {
            if (
              titleCache.get(buildOutlineEntryCacheKey(entry)) &&
              next[entry.line] !== 'success'
            ) {
              next[entry.line] = 'success';
              changed = true;
            }
          });
          return changed ? next : prev;
        });
      }

      if (!uncached.length) return;

      const lines = uncached.map((entry) => entry.line);
      setAiStates((prev) => {
        const next = { ...prev };
        lines.forEach((line) => {
          next[line] = 'loading';
        });
        return next;
      });
      setAiErrors((prev) => {
        const next = { ...prev };
        lines.forEach((line) => {
          delete next[line];
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
          setAiStates((prev) => {
            const next = { ...prev };
            lines.forEach((line) => {
              next[line] = 'error';
            });
            return next;
          });
          setAiErrors((prev) => {
            const next = { ...prev };
            lines.forEach((line) => {
              next[line] = message;
            });
            return next;
          });
          return;
        }

        const completions = parseOutlineTitleCompletions(response.text || '');
        const completionMap = new Map<number, string>();
        completions.forEach((item) => completionMap.set(item.line, item.title.trim()));

        setAiTitles((prev) => {
          const next = { ...prev };
          uncached.forEach((entry) => {
            const title = completionMap.get(entry.line);
            if (title) {
              next[entry.line] = title;
              const ck = buildOutlineEntryCacheKey(entry);
              titleCache.set(ck, title);
              // Persist to SQLite (fire-and-forget)
              void ipc.invoke('ai-cache-set', ck, 'title', title);
            }
          });
          return next;
        });
        setAiStates((prev) => {
          const next = { ...prev };
          uncached.forEach((entry) => {
            next[entry.line] = completionMap.get(entry.line) ? 'success' : 'error';
          });
          return next;
        });
        setAiErrors((prev) => {
          const next = { ...prev };
          uncached.forEach((entry) => {
            if (completionMap.get(entry.line)) {
              delete next[entry.line];
            } else {
              next[entry.line] = '该章节未返回可用标题';
            }
          });
          return next;
        });
      } catch (error) {
        if (generation !== requestGenerationRef.current) return;
        const message = error instanceof Error ? error.message : 'AI 标题补全失败';
        setAiStates((prev) => {
          const next = { ...prev };
          lines.forEach((line) => {
            next[line] = 'error';
          });
          return next;
        });
        setAiErrors((prev) => {
          const next = { ...prev };
          lines.forEach((line) => {
            next[line] = message;
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
  }, []);

  const requestAiTitles = useCallback(
    (entries: OutlineEntry[]) => {
      if (!entries.length) return;
      const dedupMap = new Map<number, OutlineEntry>();
      entries.forEach((entry) => dedupMap.set(entry.line, entry));
      const uniqueEntries = Array.from(dedupMap.values());

      setAiStates((prev) => {
        let changed = false;
        const next = { ...prev };
        uniqueEntries.forEach((entry) => {
          if (next[entry.line] === 'error') {
            next[entry.line] = 'idle';
            changed = true;
          }
        });
        return changed ? next : prev;
      });
      setAiErrors((prev) => {
        let changed = false;
        const next = { ...prev };
        uniqueEntries.forEach((entry) => {
          if (entry.line in next) {
            delete next[entry.line];
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

  // Stale-while-revalidate on content change:
  // Restore cached titles for entries that still exist instead of clearing all.
  useEffect(() => {
    requestGenerationRef.current += 1;
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    queueRef.current = [];
    inFlightRef.current = 0;

    // Only restore state from cache after Provider hydration ensures cache is populated
    if (!cacheReady) return;

    const restoredTitles: Record<number, string> = {};
    const restoredStates: Record<number, OutlineAiState> = {};
    for (const entry of outlineEntriesRef.current) {
      const cacheKey = buildOutlineEntryCacheKey(entry);
      const cached = titleCache.get(cacheKey);
      if (cached) {
        restoredTitles[entry.line] = cached;
        restoredStates[entry.line] = 'success';
      }
    }
    setAiTitles(restoredTitles);
    setAiStates(restoredStates);
    setAiErrors({});
  }, [content, cacheReady]);

  // Debounced AI title prefetch for visible entries
  useEffect(() => {
    if (!aiReady || !cacheReady || !content.trim() || pendingAiEntries.length === 0) return;
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      requestAiTitles(pendingAiEntries.slice(0, OUTLINE_AI_PREFETCH_SIZE));
    }, OUTLINE_AI_DEBOUNCE_MS);
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, [aiReady, cacheReady, content, pendingAiEntries, requestAiTitles]);

  return {
    aiTitles,
    aiStates,
    aiErrors,
    failedAiEntries,
    requestAiTitles,
    retryAiEntry: useCallback((entry: OutlineEntry) => requestAiTitles([entry]), [requestAiTitles]),
    retryFailedEntries: useCallback(() => {
      if (failedAiEntries.length) requestAiTitles(failedAiEntries);
    }, [failedAiEntries, requestAiTitles]),
  };
}
