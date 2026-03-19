import { useState, useCallback, useRef, useEffect } from 'react';
import type { OutlineEntry, OutlineSummaryAiState } from './types';
import { OUTLINE_SUMMARY_MAX_CONCURRENCY } from './constants';
import { buildOutlineEntryCacheKey, sanitizeAiSummary, extractChapterContent } from './utils';
import { useAiCache } from './AiCacheContext';
import { useAiConfig } from './useAiConfig';

/** Interval between scheduling next summary batch (ms) */
const SUMMARY_SCHEDULE_INTERVAL = 600;

export function useAiSummaries(
  content: string,
  outlineEntries: OutlineEntry[],
  visibleLines: Set<number>
) {
  const { ready: aiReady } = useAiConfig();
  const { summaryCache, cacheReady } = useAiCache();

  const [aiSummaryTexts, setAiSummaryTexts] = useState<Record<number, string>>({});
  const [aiSummaryStates, setAiSummaryStates] = useState<Record<number, OutlineSummaryAiState>>({});
  const [aiSummaryErrors, setAiSummaryErrors] = useState<Record<number, string>>({});

  const summaryQueueRef = useRef<OutlineEntry[]>([]);
  const summaryInFlightRef = useRef(0);
  const summaryGenerationRef = useRef(0);
  const contentRef = useRef(content);
  contentRef.current = content;
  const outlineEntriesRef = useRef(outlineEntries);
  outlineEntriesRef.current = outlineEntries;
  const aiSummaryStatesRef = useRef(aiSummaryStates);
  aiSummaryStatesRef.current = aiSummaryStates;
  const scheduleTimerRef = useRef<number | null>(null);
  const aiReadyRef = useRef(aiReady);
  aiReadyRef.current = aiReady;

  const processSummaryQueue = useCallback(() => {
    if (!aiReadyRef.current) return;
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const generation = summaryGenerationRef.current;

    const runSummary = async (entry: OutlineEntry) => {
      const cacheKey = buildOutlineEntryCacheKey(entry);
      const cached = summaryCache.get(cacheKey);
      if (cached) {
        setAiSummaryTexts((prev) =>
          prev[entry.line] === cached ? prev : { ...prev, [entry.line]: cached }
        );
        setAiSummaryStates((prev) =>
          prev[entry.line] === 'success' ? prev : { ...prev, [entry.line]: 'success' }
        );
        return;
      }

      if (!entry.summary || entry.summary === '暂无内容摘要') {
        setAiSummaryStates((prev) => ({ ...prev, [entry.line]: 'error' }));
        setAiSummaryErrors((prev) => ({
          ...prev,
          [entry.line]: '未提取到可用正文，已回退为节选',
        }));
        return;
      }

      setAiSummaryStates((prev) => ({ ...prev, [entry.line]: 'loading' }));
      setAiSummaryErrors((prev) => {
        const next = { ...prev };
        delete next[entry.line];
        return next;
      });

      try {
        const entryIdx = outlineEntriesRef.current.findIndex((e) => e.line === entry.line);
        const chapterContent = extractChapterContent(
          contentRef.current,
          outlineEntriesRef.current,
          entryIdx,
          4000
        );

        const response = (await ipc.invoke('ai-request', {
          prompt:
            '请根据以下章节的完整正文，写出一段简洁的中文剧情概括，包含关键事件与情节走向。使用正文中人物的真实姓名，禁止使用"主人公""主角""女主""男主"等泛称。只返回纯文本，不要标题、项目符号或解释，150-200字。',
          systemPrompt:
            '你是小说章节内容总结助手。只输出纯文本总结，不要 JSON、Markdown 或额外说明。必须紧扣该章节实际发生的主要事件。使用正文中的角色真名，严禁使用"主人公""主角"等代称。',
          context: `章节标题: ${entry.originalText || entry.text}\n\n正文内容:\n${chapterContent || entry.summary}`,
          maxTokens: 512,
          temperature: 0.7,
        })) as { ok: boolean; text?: string; error?: string };

        if (generation !== summaryGenerationRef.current) return;

        if (!response.ok) {
          setAiSummaryStates((prev) => ({ ...prev, [entry.line]: 'error' }));
          setAiSummaryErrors((prev) => ({
            ...prev,
            [entry.line]: response.error || 'AI 总结失败',
          }));
          return;
        }

        const text = sanitizeAiSummary(response.text || '');
        if (!text) {
          setAiSummaryStates((prev) => ({ ...prev, [entry.line]: 'error' }));
          setAiSummaryErrors((prev) => ({
            ...prev,
            [entry.line]: 'AI 未返回可用总结',
          }));
          return;
        }

        summaryCache.set(cacheKey, text);
        // Persist to SQLite (fire-and-forget)
        void ipc.invoke('ai-cache-set', cacheKey, 'summary', text);
        setAiSummaryTexts((prev) => ({ ...prev, [entry.line]: text }));
        setAiSummaryStates((prev) => ({ ...prev, [entry.line]: 'success' }));
        setAiSummaryErrors((prev) => {
          const next = { ...prev };
          delete next[entry.line];
          return next;
        });
      } catch (error) {
        if (generation !== summaryGenerationRef.current) return;
        setAiSummaryStates((prev) => ({ ...prev, [entry.line]: 'error' }));
        setAiSummaryErrors((prev) => ({
          ...prev,
          [entry.line]: error instanceof Error ? error.message : 'AI 总结失败',
        }));
      }
    };

    while (
      summaryInFlightRef.current < OUTLINE_SUMMARY_MAX_CONCURRENCY &&
      summaryQueueRef.current.length > 0
    ) {
      const entry = summaryQueueRef.current.shift();
      if (!entry) return;
      summaryInFlightRef.current += 1;
      void runSummary(entry).finally(() => {
        summaryInFlightRef.current = Math.max(0, summaryInFlightRef.current - 1);
        processSummaryQueue();
      });
    }
  }, []);

  const requestAiSummary = useCallback(
    (entry: OutlineEntry) => {
      const state = aiSummaryStatesRef.current[entry.line] || 'idle';
      if (state === 'loading' || state === 'success') return;
      if (summaryQueueRef.current.some((item) => item.line === entry.line)) return;
      summaryQueueRef.current.push(entry);
      processSummaryQueue();
    },
    [processSummaryQueue]
  );

  const refreshSummary = useCallback(
    (entry: OutlineEntry) => {
      const cacheKey = buildOutlineEntryCacheKey(entry);
      summaryCache.delete(cacheKey);
      // Delete from SQLite (fire-and-forget)
      void window.electron?.ipcRenderer?.invoke('ai-cache-delete', cacheKey, 'summary');
      setAiSummaryTexts((prev) => {
        const next = { ...prev };
        delete next[entry.line];
        return next;
      });
      setAiSummaryStates((prev) => ({ ...prev, [entry.line]: 'idle' }));
      setAiSummaryErrors((prev) => {
        const next = { ...prev };
        delete next[entry.line];
        return next;
      });
      summaryQueueRef.current = summaryQueueRef.current.filter((item) => item.line !== entry.line);
      summaryQueueRef.current.push(entry);
      processSummaryQueue();
    },
    [processSummaryQueue]
  );

  // Stale-while-revalidate on content change:
  // Restore cached summaries for entries that still exist, only clear truly stale data.
  useEffect(() => {
    summaryGenerationRef.current += 1;
    summaryQueueRef.current = [];
    summaryInFlightRef.current = 0;
    if (scheduleTimerRef.current !== null) {
      window.clearTimeout(scheduleTimerRef.current);
      scheduleTimerRef.current = null;
    }

    // Only restore state from cache after Provider hydration ensures cache is populated
    if (!cacheReady) return;

    const restoredTexts: Record<number, string> = {};
    const restoredStates: Record<number, OutlineSummaryAiState> = {};
    for (const entry of outlineEntriesRef.current) {
      const cacheKey = buildOutlineEntryCacheKey(entry);
      const cached = summaryCache.get(cacheKey);
      if (cached) {
        restoredTexts[entry.line] = cached;
        restoredStates[entry.line] = 'success';
      }
    }
    setAiSummaryTexts(restoredTexts);
    setAiSummaryStates(restoredStates);
    setAiSummaryErrors({});
  }, [content, cacheReady]);

  // Auto-generate summaries for visible entries that have no cache (first-time only, throttled)
  useEffect(() => {
    if (!aiReady || !cacheReady || visibleLines.size === 0 || !content.trim()) return;

    if (scheduleTimerRef.current !== null) {
      window.clearTimeout(scheduleTimerRef.current);
    }

    scheduleTimerRef.current = window.setTimeout(() => {
      const visibleEntries = outlineEntries.filter((entry) => {
        if (!visibleLines.has(entry.line)) return false;
        // Skip if already cached — only request entries without any cached result
        const cacheKey = buildOutlineEntryCacheKey(entry);
        if (summaryCache.has(cacheKey)) return false;
        return true;
      });
      for (const entry of visibleEntries) {
        requestAiSummary(entry);
      }
    }, SUMMARY_SCHEDULE_INTERVAL);

    return () => {
      if (scheduleTimerRef.current !== null) {
        window.clearTimeout(scheduleTimerRef.current);
      }
    };
  }, [aiReady, cacheReady, visibleLines, outlineEntries, content, requestAiSummary]);

  return {
    aiSummaryTexts,
    aiSummaryStates,
    aiSummaryErrors,
    requestAiSummary,
    refreshSummary,
  };
}
