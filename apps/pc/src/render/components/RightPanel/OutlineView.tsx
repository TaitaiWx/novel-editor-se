import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import styles from './styles.module.scss';
import type { OutlineEntry, OutlinePopoverAnchor } from './types';
import { OUTLINE_POPOVER_HIDE_DELAY } from './constants';
import { useAiTitles } from './useAiTitles';
import { useAiSummaries } from './useAiSummaries';
import { OutlinePopover } from './OutlinePopover';
import { OutlineEntryItem } from './OutlineEntryItem';
import { useAiConfig } from './useAiConfig';
import { useOutlineEntries } from './useOutlineEntries';

export const OutlineView: React.FC<{
  content: string;
  folderPath: string | null;
  dbReady: boolean;
  onScrollToLine?: (line: number, contentKey?: string) => void;
  onReplaceLineText?: (line: number, text: string) => void;
}> = React.memo(({ content, folderPath, dbReady, onScrollToLine, onReplaceLineText }) => {
  const aiConfig = useAiConfig();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [hoverAnchor, setHoverAnchor] = useState<OutlinePopoverAnchor | null>(null);
  const [visibleVersion, setVisibleVersion] = useState(0);
  const [appliedLines, setAppliedLines] = useState<Set<number>>(new Set());
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const entryNodeRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const visibleLinesRef = useRef<Set<number>>(new Set());
  const hoverTimeoutRef = useRef<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const {
    outlineEntries,
    hasPersistedOutline,
    loading,
    importing,
    statusMessage,
    importOutline,
    rebuildFromContent,
    clearPersisted,
    reorderEntries,
  } = useOutlineEntries(folderPath, content, dbReady, aiConfig.ready);

  const activeLine = useMemo(
    () => (activeIndex !== null ? (outlineEntries[activeIndex]?.line ?? null) : null),
    [activeIndex, outlineEntries]
  );
  const visibleLines = useMemo(() => new Set(visibleLinesRef.current), [visibleVersion]);

  // --- Extracted hooks (hooks 内部从 AiConfigContext 读取 aiReady，无需外部传参) ---
  const { aiTitles, aiStates, aiErrors, failedAiEntries, retryAiEntry, retryFailedEntries } =
    useAiTitles(content, outlineEntries, activeLine, visibleLines);

  const { aiSummaryTexts, aiSummaryStates, aiSummaryErrors, requestAiSummary, refreshSummary } =
    useAiSummaries(content, outlineEntries, visibleLines);

  const summaryHoverModeByLine = useMemo(() => {
    const modeMap: Record<number, 'card' | 'tooltip-only'> = {};
    outlineEntries.forEach((entry) => {
      const summaryState = aiSummaryStates[entry.line] || 'idle';
      modeMap[entry.line] = summaryState === 'error' ? 'tooltip-only' : 'card';
    });
    return modeMap;
  }, [outlineEntries, aiSummaryStates]);

  const hoveredEntry = useMemo(
    () => outlineEntries.find((item) => item.line === hoverAnchor?.line) || null,
    [outlineEntries, hoverAnchor]
  );

  // --- Hover delay management ---
  const clearHoverTimeout = useCallback(() => {
    if (hoverTimeoutRef.current !== null) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  }, []);

  const startHoverTimeout = useCallback(() => {
    clearHoverTimeout();
    hoverTimeoutRef.current = window.setTimeout(() => {
      setHoverAnchor(null);
    }, OUTLINE_POPOVER_HIDE_DELAY);
  }, [clearHoverTimeout]);

  const handleSelect = useCallback(
    (index: number, line: number, text: string) => {
      setActiveIndex(index);
      const targetEntry = outlineEntries[index];
      if (!targetEntry) {
        return;
      }
      const targetLine = targetEntry.source === 'database' ? (targetEntry.lineHint ?? 0) : line;
      if (targetLine > 0) {
        onScrollToLine?.(targetLine, targetEntry.anchorText || text);
      }
    },
    [onScrollToLine, outlineEntries]
  );

  const handleApplyTitle = useCallback(
    (line: number, title: string) => {
      onReplaceLineText?.(line, title);
      setAppliedLines((prev) => new Set(prev).add(line));
    },
    [onReplaceLineText]
  );

  const handleDragStart = useCallback((index: number) => {
    dragIndexRef.current = index;
  }, []);

  const handleDragOver = useCallback((index: number) => {
    setDragOverIndex(index);
  }, []);

  const handleDragEnd = useCallback(() => {
    const from = dragIndexRef.current;
    const to = dragOverIndex;
    dragIndexRef.current = null;
    setDragOverIndex(null);
    if (from !== null && to !== null && from !== to) {
      void reorderEntries(from, to);
    }
  }, [dragOverIndex, reorderEntries]);

  const handleEntryMouseEnter = useCallback(
    (entry: OutlineEntry, rect: DOMRect) => {
      clearHoverTimeout();
      if (entry.source !== 'database') {
        requestAiSummary(entry);
      }
      if (summaryHoverModeByLine[entry.line] !== 'card') {
        setHoverAnchor(null);
        return;
      }
      setHoverAnchor({ line: entry.line, rect });
    },
    [clearHoverTimeout, requestAiSummary, summaryHoverModeByLine]
  );

  useEffect(() => {
    if (!hoverAnchor) return;
    if (summaryHoverModeByLine[hoverAnchor.line] !== 'card') {
      setHoverAnchor(null);
    }
  }, [hoverAnchor, summaryHoverModeByLine]);

  // Reset hover anchor on content change
  useEffect(() => {
    setHoverAnchor(null);
    visibleLinesRef.current.clear();
    setVisibleVersion((v) => v + 1);
  }, [content]);

  // Visibility tracking via IntersectionObserver
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        let changed = false;
        entries.forEach((ioEntry) => {
          const line = Number(ioEntry.target.getAttribute('data-line') || 0);
          if (!line) return;
          if (ioEntry.isIntersecting) {
            if (!visibleLinesRef.current.has(line)) {
              visibleLinesRef.current.add(line);
              changed = true;
            }
          } else if (visibleLinesRef.current.delete(line)) {
            changed = true;
          }
        });
        if (changed) setVisibleVersion((v) => v + 1);
      },
      { threshold: 0.15 }
    );

    outlineEntries.forEach((entry) => {
      const node = entryNodeRefs.current[entry.line];
      if (node) observer.observe(node);
    });

    return () => observer.disconnect();
  }, [outlineEntries]);

  const handleOpenAiSettings = useCallback(() => {
    window.dispatchEvent(new CustomEvent('open-settings-tab', { detail: 'ai' }));
  }, []);

  if (!content) {
    return <div className={styles.emptyHint}>打开文件后查看目录</div>;
  }

  if (outlineEntries.length === 0) {
    return (
      <div className={styles.emptyHint}>
        未检测到标题结构
        <br />
        <span className={styles.hintSub}>支持 Markdown 标题、中文章节标记、数字编号等格式</span>
      </div>
    );
  }

  const totalWords = outlineEntries.reduce((sum, e) => sum + e.wordCount, 0);
  const completedCount = outlineEntries.filter(
    (e) => e.needsAiTitle && aiTitles[e.line]?.trim()
  ).length;
  const needsAiCount = outlineEntries.filter((e) => e.needsAiTitle).length;

  // 纯数据驱动: 有已完成/加载中/失败的 AI 条目即视为活跃
  const hasAiData =
    completedCount > 0 ||
    failedAiEntries.length > 0 ||
    outlineEntries.some((e) => aiStates[e.line] === 'loading');

  return (
    <div className={styles.outlineTree}>
      <div className={styles.outlineStatsBar}>
        <span className={styles.outlineStatChip}>{outlineEntries.length} 章</span>
        <span className={styles.outlineStatChip}>
          {totalWords >= 10000
            ? `${(totalWords / 10000).toFixed(1)} 万字`
            : `${totalWords.toLocaleString()} 字`}
        </span>
        {needsAiCount > 0 && hasAiData && (
          <span className={styles.outlineStatChip}>
            AI {completedCount}/{needsAiCount}
          </span>
        )}
        {hasPersistedOutline && <span className={styles.outlineImportChip}>已入库</span>}
        {loading && <span className={styles.outlineLoadingChip}>加载中...</span>}
        {importing && <span className={styles.outlineLoadingChip}>处理中...</span>}
        {aiConfig.loaded && !aiConfig.ready && (
          <span
            className={styles.outlineAiHintChip}
            onClick={handleOpenAiSettings}
            title="配置 AI 功能"
          >
            开启 AI
          </span>
        )}
      </div>
      {failedAiEntries.length > 0 && (
        <div className={styles.outlineToolbar}>
          <button className={styles.outlineRetryAllButton} onClick={retryFailedEntries}>
            重试失败项 ({failedAiEntries.length})
          </button>
        </div>
      )}
      <div className={styles.outlineToolbar}>
        <button
          className={styles.outlineActionButton}
          onClick={importOutline}
          disabled={!folderPath || !dbReady || importing}
        >
          导入大纲
        </button>
        <button
          className={styles.outlineActionButton}
          onClick={rebuildFromContent}
          disabled={!folderPath || !dbReady || importing || !content.trim()}
        >
          从正文重建
        </button>
        {hasPersistedOutline && (
          <button
            className={styles.outlineSecondaryButton}
            onClick={clearPersisted}
            disabled={importing}
          >
            清空入库
          </button>
        )}
      </div>
      {statusMessage && <div className={styles.outlineImportStatus}>{statusMessage}</div>}
      {outlineEntries.map((entry, i) => (
        <OutlineEntryItem
          key={entry.cacheKey}
          entry={entry}
          index={i}
          isLast={i === outlineEntries.length - 1}
          isActive={activeIndex === i}
          aiTitle={aiTitles[entry.line]?.trim() || ''}
          aiState={aiStates[entry.line] || 'idle'}
          aiError={aiErrors[entry.line]}
          summaryState={
            entry.source === 'database' ? 'idle' : aiSummaryStates[entry.line] || 'idle'
          }
          summaryText={
            entry.source === 'database'
              ? entry.summary
              : aiSummaryStates[entry.line] === 'error'
                ? aiSummaryErrors[entry.line]?.trim() || ''
                : aiSummaryTexts[entry.line]?.trim() || ''
          }
          summaryError={aiSummaryErrors[entry.line]?.trim() || ''}
          isApplied={appliedLines.has(entry.line)}
          canReplaceText={!!onReplaceLineText}
          draggable={hasPersistedOutline}
          isDragOver={dragOverIndex === i}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onSelect={handleSelect}
          onRetryTitle={retryAiEntry}
          onApplyTitle={handleApplyTitle}
          onRefreshSummary={refreshSummary}
          onMouseEnter={handleEntryMouseEnter}
          onMouseLeave={startHoverTimeout}
          entryRef={(node) => {
            entryNodeRefs.current[entry.line] = node;
          }}
        />
      ))}

      {/* Popover for detailed view on hover */}
      <OutlinePopover
        anchor={hoverAnchor}
        entry={hoveredEntry}
        aiTitle={hoveredEntry ? aiTitles[hoveredEntry.line]?.trim() || '' : ''}
        summaryText={
          hoveredEntry
            ? hoveredEntry.source === 'database'
              ? hoveredEntry.summary || ''
              : (aiSummaryTexts[hoveredEntry.line]?.trim()
                  ? aiSummaryTexts[hoveredEntry.line]
                  : hoveredEntry.summary) || ''
            : ''
        }
        summaryState={
          hoveredEntry
            ? hoveredEntry.source === 'database'
              ? 'idle'
              : aiSummaryTexts[hoveredEntry.line]?.trim()
                ? 'success'
                : aiSummaryStates[hoveredEntry.line] || 'idle'
            : 'idle'
        }
        summaryError={hoveredEntry ? aiSummaryErrors[hoveredEntry.line] : undefined}
        onRefreshSummary={refreshSummary}
        onClearTimeout={clearHoverTimeout}
        onStartTimeout={startHoverTimeout}
      />
    </div>
  );
});
