import React from 'react';
import Tooltip from '../Tooltip';
import styles from './styles.module.scss';
import type { OutlineEntry, OutlineAiState, OutlineSummaryAiState } from './types';

interface OutlineEntryItemProps {
  entry: OutlineEntry;
  index: number;
  isLast: boolean;
  isActive: boolean;
  aiTitle: string;
  aiState: OutlineAiState;
  aiError: string | undefined;
  summaryState: OutlineSummaryAiState;
  summaryText: string;
  summaryError?: string;
  isApplied: boolean;
  canReplaceText: boolean;
  draggable?: boolean;
  isDragOver?: boolean;
  onDragStart?: (index: number) => void;
  onDragOver?: (index: number) => void;
  onDragEnd?: () => void;
  onSelect: (index: number, line: number, text: string) => void;
  onRetryTitle: (entry: OutlineEntry) => void;
  onApplyTitle: (line: number, title: string) => void;
  onRefreshSummary: (entry: OutlineEntry) => void;
  onMouseEnter: (entry: OutlineEntry, rect: DOMRect) => void;
  onMouseLeave: () => void;
  entryRef: (node: HTMLDivElement | null) => void;
}

export const OutlineEntryItem: React.FC<OutlineEntryItemProps> = React.memo(
  ({
    entry,
    index,
    isLast,
    isActive,
    aiTitle,
    aiState,
    aiError,
    summaryState,
    summaryText,
    summaryError,
    isApplied,
    canReplaceText,
    draggable,
    isDragOver,
    onDragStart,
    onDragOver,
    onDragEnd,
    onSelect,
    onRetryTitle,
    onApplyTitle,
    onRefreshSummary,
    onMouseEnter,
    onMouseLeave,
    entryRef,
  }) => {
    const indent = (entry.level - 1) * 18;
    const state: OutlineAiState = aiTitle ? 'success' : aiState;
    const displayText = aiTitle ? `${entry.text} ${aiTitle}` : entry.text;
    const isAiCompleted = state === 'success';
    const isAiLoading = state === 'loading';
    const isAiFailed = state === 'error';
    const inlineSummaryText =
      summaryState === 'success' && summaryText ? summaryText : entry.summary;
    const hasInlineSummary = !!inlineSummaryText?.trim();

    return (
      <div
        className={`${styles.outlineNode} ${isActive ? styles.outlineNodeActive : ''} ${isDragOver ? styles.outlineNodeDragOver : ''}`}
        draggable={draggable}
        onDragStart={(e) => {
          if (!draggable) return;
          e.dataTransfer.effectAllowed = 'move';
          onDragStart?.(index);
        }}
        onDragOver={(e) => {
          if (!draggable) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          onDragOver?.(index);
        }}
        onDragEnd={() => {
          if (!draggable) return;
          onDragEnd?.();
        }}
        onDrop={(e) => {
          e.preventDefault();
          onDragEnd?.();
        }}
        onClick={() => onSelect(index, entry.line, entry.text)}
        onMouseEnter={(event) => {
          onMouseEnter(entry, event.currentTarget.getBoundingClientRect());
        }}
        onMouseLeave={onMouseLeave}
      >
        <div
          className={styles.outlineNodeContent}
          style={{ paddingLeft: `${indent}px` }}
          data-line={entry.line}
          ref={entryRef}
        >
          <div className={styles.outlineDotWrapper}>
            <span
              className={`${styles.outlineDot} ${isActive ? styles.outlineDotActive : ''} ${isAiCompleted ? styles.outlineDotAuto : ''} ${isAiLoading ? styles.outlineDotLoading : ''} ${isAiFailed ? styles.outlineDotError : ''}`}
            />
            {!isLast && <div className={styles.outlineConnectorLine} />}
          </div>
          <div className={styles.outlineTitleWrap}>
            <span
              className={`${styles.outlineText} ${isAiCompleted ? styles.outlineTextAuto : ''}`}
            >
              {displayText}
            </span>
            {entry.needsAiTitle && state === 'error' && (
              <Tooltip content={aiError || 'AI 标题补全失败'} position="top">
                <span className={styles.outlineErrorMessage}>标题失败</span>
              </Tooltip>
            )}
          </div>

          {entry.needsAiTitle && state === 'error' && (
            <button
              className={styles.outlineRetryButton}
              onClick={(event) => {
                event.stopPropagation();
                onRetryTitle(entry);
              }}
            >
              重试
            </button>
          )}

          {entry.needsAiTitle && aiTitle && !isApplied && canReplaceText && (
            <button
              className={styles.outlineApplyTitleBtn}
              onClick={(event) => {
                event.stopPropagation();
                onApplyTitle(entry.line, aiTitle);
              }}
              title="将 AI 标题写入正文"
            >
              应用
            </button>
          )}
          {isApplied && <span className={styles.outlineAppliedTag}>已应用</span>}

          <span className={styles.outlineLineNum}>
            {entry.wordCount >= 1000
              ? `${(entry.wordCount / 1000).toFixed(1)}k`
              : `${entry.wordCount}`}
          </span>
        </div>

        <div className={styles.outlineInlineSummary} style={{ paddingLeft: `${indent + 28}px` }}>
          {summaryState === 'success' && summaryText ? (
            <>
              <span className={styles.outlinePopoverAiBadge}>AI 生成</span>
              <span className={styles.outlineInlineSummaryText}>{summaryText}</span>
            </>
          ) : summaryState === 'loading' ? (
            <span className={styles.outlineInlineSummaryLoading}>摘要生成中...</span>
          ) : summaryState === 'error' ? (
            <Tooltip content={summaryError || summaryText || '摘要生成失败'} position="top">
              <span className={styles.outlineInlineSummaryError}>摘要失败</span>
            </Tooltip>
          ) : hasInlineSummary ? (
            <span className={styles.outlineInlineSummaryText}>{inlineSummaryText}</span>
          ) : (
            <span className={styles.outlineInlineSummaryMuted}>暂无摘要</span>
          )}
          {(summaryState === 'success' || summaryState === 'error') && (
            <button
              className={styles.outlineInlineRefreshBtn}
              onClick={(event) => {
                event.stopPropagation();
                onRefreshSummary(entry);
              }}
              title="刷新摘要"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
              </svg>
            </button>
          )}
        </div>
      </div>
    );
  }
);
