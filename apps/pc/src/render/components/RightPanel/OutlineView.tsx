import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { extractOutline, type OutlineNode } from '@novel-editor/basic-algorithm';
import styles from './styles.module.scss';
import type { OutlineEntry, OutlinePopoverAnchor } from './types';
import { OUTLINE_POPOVER_HIDE_DELAY } from './constants';
import { buildOutlineEntries } from './utils';
import { useAiTitles } from './useAiTitles';
import { useAiSummaries } from './useAiSummaries';
import { OutlinePopover } from './OutlinePopover';
import { OutlineEntryItem } from './OutlineEntryItem';
import { useAiConfig } from './useAiConfig';

export const OutlineView: React.FC<{
  content: string;
  onScrollToLine?: (line: number) => void;
  onReplaceLineText?: (line: number, text: string) => void;
}> = React.memo(({ content, onScrollToLine, onReplaceLineText }) => {
  const aiConfig = useAiConfig();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [hoverAnchor, setHoverAnchor] = useState<OutlinePopoverAnchor | null>(null);
  const [visibleVersion, setVisibleVersion] = useState(0);
  const [appliedLines, setAppliedLines] = useState<Set<number>>(new Set());

  const entryNodeRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const visibleLinesRef = useRef<Set<number>>(new Set());
  const hoverTimeoutRef = useRef<number | null>(null);

  const headings: OutlineNode[] = useMemo(
    () => extractOutline(content, { enableHeuristic: false }),
    [content]
  );
  const outlineEntries = useMemo(() => buildOutlineEntries(content, headings), [content, headings]);

  const activeLine = useMemo(
    () => (activeIndex !== null ? (outlineEntries[activeIndex]?.line ?? null) : null),
    [activeIndex, outlineEntries]
  );
  const visibleLines = useMemo(() => new Set(visibleLinesRef.current), [visibleVersion]);

  // --- Extracted hooks (hooks 内部从 AiConfigContext 读取 aiReady，无需外部传参) ---
  const { aiTitles, aiStates, aiErrors, failedAiEntries, retryAiEntry, retryFailedEntries } =
    useAiTitles(content, outlineEntries, activeLine, visibleLines);

  const { aiSummaryTexts, aiSummaryStates, aiSummaryErrors, refreshSummary } = useAiSummaries(
    content,
    outlineEntries,
    visibleLines
  );

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
    (index: number, line: number) => {
      setActiveIndex(index);
      onScrollToLine?.(line);
    },
    [onScrollToLine]
  );

  const handleApplyTitle = useCallback(
    (line: number, title: string) => {
      onReplaceLineText?.(line, title);
      setAppliedLines((prev) => new Set(prev).add(line));
    },
    [onReplaceLineText]
  );

  const handleEntryMouseEnter = useCallback(
    (entry: OutlineEntry, rect: DOMRect) => {
      clearHoverTimeout();
      setHoverAnchor({ line: entry.line, rect });
    },
    [clearHoverTimeout]
  );

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
      {outlineEntries.map((entry, i) => (
        <OutlineEntryItem
          key={entry.line}
          entry={entry}
          index={i}
          isLast={i === outlineEntries.length - 1}
          isActive={activeIndex === i}
          aiTitle={aiTitles[entry.line]?.trim() || ''}
          aiState={aiStates[entry.line] || 'idle'}
          aiError={aiErrors[entry.line]}
          summaryState={aiSummaryStates[entry.line] || 'idle'}
          summaryText={aiSummaryTexts[entry.line]?.trim() || ''}
          isApplied={appliedLines.has(entry.line)}
          canReplaceText={!!onReplaceLineText}
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
            ? (aiSummaryTexts[hoveredEntry.line]?.trim()
                ? aiSummaryTexts[hoveredEntry.line]
                : hoveredEntry.summary) || ''
            : ''
        }
        summaryState={
          hoveredEntry
            ? aiSummaryTexts[hoveredEntry.line]?.trim()
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
