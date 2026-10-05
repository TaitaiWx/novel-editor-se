import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import type { PersistedOutlineScopeInput } from '@/render/types/electron-api';
import styles from '../styles.module.scss';
import type { OutlineEntry, OutlinePopoverAnchor, StorylineViewMode } from '../types';
import { OUTLINE_POPOVER_HIDE_DELAY } from '../constants';
import { useAiTitles } from '../useAiTitles';
import { useAiSummaries } from '../useAiSummaries';
import { OutlinePopover } from '../OutlinePopover';
import { OutlineEntryItem } from '../OutlineEntryItem';
import {
  DEFAULT_OUTLINE_AI_OPTIONS,
  OUTLINE_AI_GRANULARITY_LABELS,
  OUTLINE_AI_STYLE_LABELS,
  type OutlineAiGenerationOptions,
} from '../outline-import';
import { useAiConfig } from '../useAiConfig';
import { useOutlineEntries } from '../useOutlineEntries';
import { useDialog } from '../../Dialog';
import { getOutlineScopeLabel, OUTLINE_VERSION_SOURCE_LABELS } from './helpers';
import { useOutlineVersionCenter } from './useOutlineVersionCenter';
import { OutlineVersionsPanel } from './OutlineVersionsPanel';
import { OutlineAiPresetPanel } from './OutlineAiPresetPanel';

export const OutlineView: React.FC<{
  mode: Extract<StorylineViewMode, 'catalog' | 'outline'>;
  content: string;
  folderPath: string | null;
  dbReady: boolean;
  scope?: PersistedOutlineScopeInput | null;
  scopeLabel?: string;
  onScrollToLine?: (line: number, contentKey?: string) => void;
  onReplaceLineText?: (line: number, text: string) => void;
}> = React.memo(
  ({
    mode,
    content,
    folderPath,
    dbReady,
    scope = null,
    scopeLabel = '当前作品',
    onScrollToLine,
    onReplaceLineText,
  }) => {
    const aiConfig = useAiConfig();
    const dialog = useDialog();
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const [hoverAnchor, setHoverAnchor] = useState<OutlinePopoverAnchor | null>(null);
    const [visibleVersion, setVisibleVersion] = useState(0);
    const [appliedLines, setAppliedLines] = useState<Set<number>>(new Set());
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const [aiOutlineOptions, setAiOutlineOptions] = useState<OutlineAiGenerationOptions>(
      DEFAULT_OUTLINE_AI_OPTIONS
    );
    const [showAiPresetPanel, setShowAiPresetPanel] = useState(false);

    const entryNodeRefs = useRef<Record<number, HTMLDivElement | null>>({});
    const visibleLinesRef = useRef<Set<number>>(new Set());
    const hoverTimeoutRef = useRef<number | null>(null);
    const dragIndexRef = useRef<number | null>(null);
    const {
      liveEntries,
      persistedEntries,
      versions,
      hasPersistedOutline,
      loading,
      importing,
      statusMessage,
      importOutline,
      rebuildFromContent,
      clearPersisted,
      saveOutlineVersion,
      applyOutlineVersion,
      updateOutlineVersion,
      deleteOutlineVersion,
      generateAiOutline,
      reorderEntries,
    } = useOutlineEntries(folderPath, content, dbReady, aiConfig.ready, scope);

    const isOutlineMode = mode === 'outline';
    const outlineEntries = isOutlineMode ? persistedEntries : liveEntries;
    const scopeKind = scope?.kind ?? 'project';
    const outlineScopeText = useMemo(() => getOutlineScopeLabel(scopeKind), [scopeKind]);

    const activeLine = useMemo(
      () => (activeIndex !== null ? (outlineEntries[activeIndex]?.line ?? null) : null),
      [activeIndex, outlineEntries]
    );
    // visibleLinesRef 由 IntersectionObserver 原地修改，visibleVersion 作为变更信号触发快照重建
    // eslint-disable-next-line react-hooks/exhaustive-deps -- visibleVersion 是 ref 原地变更的版本号信号，必须保留以重建可见行快照
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

    // 大纲版本中心（保存 / 应用 / 对比）
    const {
      compareBaseVersionId,
      compareTargetVersionId,
      highlightedStoryIdeaVersionId,
      handleSaveVersion,
      handleApplyVersion,
      handleEditVersion,
      handleDeleteVersion,
      handleSetCompareBase,
      handleSetCompareTarget,
      previewData,
    } = useOutlineVersionCenter({
      dialog,
      versions,
      persistedEntries,
      scopeKind,
      saveOutlineVersion,
      applyOutlineVersion,
      updateOutlineVersion,
      deleteOutlineVersion,
    });

    const handleGenerateAiOutline = useCallback(async () => {
      await generateAiOutline(aiOutlineOptions);
    }, [aiOutlineOptions, generateAiOutline]);

    const aiOptionsLabel = useMemo(
      () =>
        `${OUTLINE_AI_STYLE_LABELS[aiOutlineOptions.style]} / ${OUTLINE_AI_GRANULARITY_LABELS[aiOutlineOptions.granularity]} / ${aiOutlineOptions.maxDepth} 层`,
      [aiOutlineOptions]
    );

    const renderVersions = useCallback(
      () => (
        <OutlineVersionsPanel
          versions={versions}
          highlightedStoryIdeaVersionId={highlightedStoryIdeaVersionId}
          sourceLabels={OUTLINE_VERSION_SOURCE_LABELS}
          importing={importing}
          compareBaseVersionId={compareBaseVersionId}
          compareTargetVersionId={compareTargetVersionId}
          previewData={previewData}
          handleSetCompareBase={handleSetCompareBase}
          handleSetCompareTarget={handleSetCompareTarget}
          handleEditVersion={handleEditVersion}
          handleApplyVersion={handleApplyVersion}
          handleDeleteVersion={handleDeleteVersion}
        />
      ),
      [
        handleApplyVersion,
        handleDeleteVersion,
        handleEditVersion,
        handleSetCompareBase,
        handleSetCompareTarget,
        highlightedStoryIdeaVersionId,
        importing,
        compareBaseVersionId,
        compareTargetVersionId,
        previewData,
        versions,
      ]
    );

    const renderAiPresetPanel = useCallback(
      () => (
        <OutlineAiPresetPanel
          aiOptionsLabel={aiOptionsLabel}
          aiOutlineOptions={aiOutlineOptions}
          setAiOutlineOptions={setAiOutlineOptions}
          importing={importing}
        />
      ),
      [aiOptionsLabel, aiOutlineOptions, importing]
    );

    if (!content && !isOutlineMode) {
      return <div className={styles.emptyHint}>打开文件后查看目录</div>;
    }

    if (outlineEntries.length === 0) {
      if (isOutlineMode) {
        return (
          <div className={styles.emptyHint}>
            暂无入库{outlineScopeText}
            <br />
            <span className={styles.hintSub}>
              {scopeKind === 'chapter'
                ? `可为「${scopeLabel}」导入、生成或重建独立章纲`
                : `可为「${scopeLabel}」导入、生成或重建独立${outlineScopeText}`}
            </span>
            <div className={styles.outlineToolbar} style={{ marginTop: 10 }}>
              <button
                className={styles.outlineActionButton}
                onClick={importOutline}
                disabled={!folderPath || !dbReady || importing}
              >
                导入大纲
              </button>
              <button
                className={styles.outlineActionButton}
                onClick={() => void handleGenerateAiOutline()}
                disabled={
                  !folderPath || !dbReady || importing || !content.trim() || !aiConfig.ready
                }
              >
                AI 生成大纲
              </button>
              <button
                className={styles.outlineSecondaryButton}
                onClick={() => setShowAiPresetPanel((current) => !current)}
                disabled={importing || !aiConfig.ready}
              >
                {showAiPresetPanel ? '收起预设' : 'AI 预设'}
              </button>
              <button
                className={styles.outlineSecondaryButton}
                onClick={handleSaveVersion}
                disabled={!hasPersistedOutline || importing}
              >
                保存为大纲版本
              </button>
              <button
                className={styles.outlineActionButton}
                onClick={rebuildFromContent}
                disabled={!folderPath || !dbReady || importing || !content.trim()}
              >
                从正文重建
              </button>
            </div>
            {showAiPresetPanel && aiConfig.ready && renderAiPresetPanel()}
            {statusMessage && <div className={styles.outlineImportStatus}>{statusMessage}</div>}
            {versions.length > 0 && renderVersions()}
          </div>
        );
      }
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
          <span className={styles.outlineStatChip}>{outlineEntries.length} 节点</span>
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
          {isOutlineMode && aiConfig.ready && (
            <span className={styles.outlineStatChip}>AI 生成：{aiOptionsLabel}</span>
          )}
          {isOutlineMode && hasPersistedOutline && (
            <span className={styles.outlineImportChip}>已入库{outlineScopeText}</span>
          )}
          {!isOutlineMode && hasPersistedOutline && (
            <span className={styles.outlineImportChip}>目录（实时）</span>
          )}
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
        {!isOutlineMode && failedAiEntries.length > 0 && (
          <div className={styles.outlineToolbar}>
            <button className={styles.outlineRetryAllButton} onClick={retryFailedEntries}>
              重试失败项 ({failedAiEntries.length})
            </button>
          </div>
        )}
        {isOutlineMode && (
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
            <button
              className={styles.outlineActionButton}
              onClick={() => void handleGenerateAiOutline()}
              disabled={!folderPath || !dbReady || importing || !content.trim() || !aiConfig.ready}
            >
              AI 生成大纲
            </button>
            <button
              className={styles.outlineSecondaryButton}
              onClick={() => setShowAiPresetPanel((current) => !current)}
              disabled={importing || !aiConfig.ready}
            >
              {showAiPresetPanel ? '收起预设' : 'AI 预设'}
            </button>
            <button
              className={styles.outlineSecondaryButton}
              onClick={() => void handleSaveVersion()}
              disabled={!hasPersistedOutline || importing}
            >
              保存为大纲版本
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
        )}
        {isOutlineMode && showAiPresetPanel && aiConfig.ready && renderAiPresetPanel()}
        {statusMessage && <div className={styles.outlineImportStatus}>{statusMessage}</div>}
        {isOutlineMode && renderVersions()}
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
            draggable={isOutlineMode && hasPersistedOutline}
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
  }
);
