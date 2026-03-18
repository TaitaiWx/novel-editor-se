import React from 'react';
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
  isApplied: boolean;
  canReplaceText: boolean;
  onSelect: (index: number, line: number) => void;
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
    isApplied,
    canReplaceText,
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

    return (
      <div
        className={`${styles.outlineNode} ${isActive ? styles.outlineNodeActive : ''}`}
        onClick={() => onSelect(index, entry.line)}
        onMouseEnter={(event) => {
          if (isAiFailed) return;
          onMouseEnter(entry, event.currentTarget.getBoundingClientRect());
        }}
        onMouseLeave={() => {
          if (isAiFailed) return;
          onMouseLeave();
        }}
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
              <span className={styles.outlineErrorMessage} title={aiError || ''}>
                {aiError || '补全失败'}
              </span>
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

        {/* Inline AI summary */}
        {summaryState === 'loading' && (
          <div className={styles.outlineInlineSummary} style={{ paddingLeft: `${indent + 28}px` }}>
            <span className={styles.outlineInlineSummaryLoading}>摘要生成中...</span>
          </div>
        )}
        {summaryState === 'success' && summaryText && (
          <div className={styles.outlineInlineSummary} style={{ paddingLeft: `${indent + 28}px` }}>
            <span className={styles.outlinePopoverAiBadge}>AI 生成</span>
            <span className={styles.outlineInlineSummaryText}>{summaryText}</span>
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
          </div>
        )}
      </div>
    );
  }
);
