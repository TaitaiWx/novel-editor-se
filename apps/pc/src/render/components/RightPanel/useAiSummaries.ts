import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { OutlineEntry, OutlineSummaryAiState } from './types';
import { OUTLINE_SUMMARY_MAX_CONCURRENCY } from './constants';
import { buildOutlineEntryCacheKey, sanitizeAiSummary, extractChapterContent } from './utils';
import { useAiCache } from './AiCacheContext';
import { useAiConfig } from './useAiConfig';

export function useAiSummaries(
  content: string,
  outlineEntries: OutlineEntry[],
  _visibleLines: Set<number>
) {
  const { ready: aiReady } = useAiConfig();
  const { summaryCache, cacheReady } = useAiCache();

  const [aiSummaryTextsByKey, setAiSummaryTextsByKey] = useState<Record<string, string>>({});
  const [aiSummaryStatesByKey, setAiSummaryStatesByKey] = useState<
    Record<string, OutlineSummaryAiState>
  >({});
  const [aiSummaryErrorsByKey, setAiSummaryErrorsByKey] = useState<Record<string, string>>({});

  const summaryQueueRef = useRef<OutlineEntry[]>([]);
  const summaryInFlightRef = useRef(0);
  const summaryGenerationRef = useRef(0);
  const contentRef = useRef(content);
  contentRef.current = content;
  const outlineEntriesRef = useRef(outlineEntries);
  outlineEntriesRef.current = outlineEntries;
  const scheduleTimerRef = useRef<number | null>(null);
  const aiReadyRef = useRef(aiReady);
  aiReadyRef.current = aiReady;
  const aiSummaryTextsByKeyRef = useRef(aiSummaryTextsByKey);
  aiSummaryTextsByKeyRef.current = aiSummaryTextsByKey;
  const aiSummaryStatesByKeyRef = useRef(aiSummaryStatesByKey);
  aiSummaryStatesByKeyRef.current = aiSummaryStatesByKey;

  const processSummaryQueue = useCallback(() => {
    if (!aiReadyRef.current) return;
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const generation = summaryGenerationRef.current;

    const runSummary = async (entry: OutlineEntry) => {
      const cacheKey = buildOutlineEntryCacheKey(entry);
      const cached = summaryCache.get(cacheKey);
      if (cached) {
        setAiSummaryTextsByKey((prev) =>
          prev[cacheKey] === cached ? prev : { ...prev, [cacheKey]: cached }
        );
        setAiSummaryStatesByKey((prev) =>
          prev[cacheKey] === 'success' ? prev : { ...prev, [cacheKey]: 'success' }
        );
        return;
      }

      if (!entry.summary || entry.summary === '暂无内容摘要') {
        setAiSummaryStatesByKey((prev) => ({ ...prev, [cacheKey]: 'error' }));
        setAiSummaryErrorsByKey((prev) => ({
          ...prev,
          [cacheKey]: '未提取到可用正文，已回退为节选',
        }));
        return;
      }

      setAiSummaryStatesByKey((prev) => ({ ...prev, [cacheKey]: 'loading' }));
      setAiSummaryErrorsByKey((prev) => {
        const next = { ...prev };
        delete next[cacheKey];
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
          setAiSummaryStatesByKey((prev) => ({ ...prev, [cacheKey]: 'error' }));
          setAiSummaryErrorsByKey((prev) => ({
            ...prev,
            [cacheKey]: response.error || 'AI 总结失败',
          }));
          return;
        }

        const text = sanitizeAiSummary(response.text || '');
        if (!text) {
          setAiSummaryStatesByKey((prev) => ({ ...prev, [cacheKey]: 'error' }));
          setAiSummaryErrorsByKey((prev) => ({
            ...prev,
            [cacheKey]: 'AI 未返回可用总结',
          }));
          return;
        }

        summaryCache.set(cacheKey, text);
        // Persist to SQLite (fire-and-forget)
        void ipc.invoke('ai-cache-set', cacheKey, 'summary', text);
        setAiSummaryTextsByKey((prev) => ({ ...prev, [cacheKey]: text }));
        setAiSummaryStatesByKey((prev) => ({ ...prev, [cacheKey]: 'success' }));
        setAiSummaryErrorsByKey((prev) => {
          const next = { ...prev };
          delete next[cacheKey];
          return next;
        });
      } catch (error) {
        if (generation !== summaryGenerationRef.current) return;
        setAiSummaryStatesByKey((prev) => ({ ...prev, [cacheKey]: 'error' }));
        setAiSummaryErrorsByKey((prev) => ({
          ...prev,
          [cacheKey]: error instanceof Error ? error.message : 'AI 总结失败',
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
      const cacheKey = buildOutlineEntryCacheKey(entry);
      if (summaryCache.has(cacheKey) || aiSummaryTextsByKeyRef.current[cacheKey]?.trim()) return;
      const state = aiSummaryStatesByKeyRef.current[cacheKey] || 'idle';
      if (state === 'loading' || state === 'success') return;
      if (summaryQueueRef.current.some((item) => item.cacheKey === entry.cacheKey)) return;
      summaryQueueRef.current.push(entry);
      processSummaryQueue();
    },
    [processSummaryQueue, summaryCache]
  );

  const refreshSummary = useCallback(
    (entry: OutlineEntry) => {
      const cacheKey = buildOutlineEntryCacheKey(entry);
      summaryCache.delete(cacheKey);
      // Delete from SQLite (fire-and-forget)
      void window.electron?.ipcRenderer?.invoke('ai-cache-delete', cacheKey, 'summary');
      setAiSummaryTextsByKey((prev) => {
        const next = { ...prev };
        delete next[cacheKey];
        return next;
      });
      setAiSummaryStatesByKey((prev) => ({ ...prev, [cacheKey]: 'idle' }));
      setAiSummaryErrorsByKey((prev) => {
        const next = { ...prev };
        delete next[cacheKey];
        return next;
      });
      summaryQueueRef.current = summaryQueueRef.current.filter(
        (item) => item.cacheKey !== entry.cacheKey
      );
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

    if (!cacheReady) return;

    setAiSummaryTextsByKey((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const entry of outlineEntriesRef.current) {
        const cacheKey = buildOutlineEntryCacheKey(entry);
        const cached = summaryCache.get(cacheKey);
        if (cached && next[cacheKey] !== cached) {
          next[cacheKey] = cached;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setAiSummaryStatesByKey((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const entry of outlineEntriesRef.current) {
        const cacheKey = buildOutlineEntryCacheKey(entry);
        if (
          (summaryCache.has(cacheKey) || aiSummaryTextsByKeyRef.current[cacheKey]?.trim()) &&
          next[cacheKey] !== 'success'
        ) {
          next[cacheKey] = 'success';
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setAiSummaryErrorsByKey((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const entry of outlineEntriesRef.current) {
        const cacheKey = buildOutlineEntryCacheKey(entry);
        if (
          (summaryCache.has(cacheKey) || aiSummaryTextsByKeyRef.current[cacheKey]?.trim()) &&
          cacheKey in next
        ) {
          delete next[cacheKey];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [content, cacheReady, summaryCache]);

  // 摘要改为按需请求：悬浮或显式刷新时才触发，避免列表滚动时大规模排队请求。

  const aiSummaryTexts = useMemo(() => {
    const next: Record<number, string> = {};
    outlineEntries.forEach((entry) => {
      const text = aiSummaryTextsByKey[buildOutlineEntryCacheKey(entry)];
      if (text) next[entry.line] = text;
    });
    return next;
  }, [aiSummaryTextsByKey, outlineEntries]);

  const aiSummaryStates = useMemo(() => {
    const next: Record<number, OutlineSummaryAiState> = {};
    outlineEntries.forEach((entry) => {
      const cacheKey = buildOutlineEntryCacheKey(entry);
      if (summaryCache.has(cacheKey) || aiSummaryTextsByKey[cacheKey]?.trim()) {
        next[entry.line] = 'success';
        return;
      }
      const state = aiSummaryStatesByKey[cacheKey];
      if (state) next[entry.line] = state;
    });
    return next;
  }, [aiSummaryStatesByKey, aiSummaryTextsByKey, outlineEntries, summaryCache]);

  const aiSummaryErrors = useMemo(() => {
    const next: Record<number, string> = {};
    outlineEntries.forEach((entry) => {
      const error = aiSummaryErrorsByKey[buildOutlineEntryCacheKey(entry)];
      if (error) next[entry.line] = error;
    });
    return next;
  }, [aiSummaryErrorsByKey, outlineEntries]);

  return {
    aiSummaryTexts,
    aiSummaryStates,
    aiSummaryErrors,
    requestAiSummary,
    refreshSummary,
  };
}
