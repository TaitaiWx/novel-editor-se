import React, { useRef, useEffect, useState } from 'react';
import Popover from '../Popover';
import Tooltip from '../Tooltip';
import styles from './styles.module.scss';
import type { OutlineEntry, OutlinePopoverAnchor } from './types';

const POPOVER_SHOW_DELAY = 150;

interface OutlinePopoverProps {
  anchor: OutlinePopoverAnchor | null;
  entry: OutlineEntry | null;
  aiTitle: string;
  summaryText: string;
  summaryState: 'idle' | 'loading' | 'success' | 'error';
  summaryError?: string;
  onRefreshSummary: (entry: OutlineEntry) => void;
  onClearTimeout: () => void;
  onStartTimeout: () => void;
}

export const OutlinePopover: React.FC<OutlinePopoverProps> = React.memo(
  ({
    anchor,
    entry,
    aiTitle,
    summaryText,
    summaryState,
    summaryError,
    onRefreshSummary,
    onClearTimeout,
    onStartTimeout,
  }) => {
    const [visible, setVisible] = useState(false);
    const showTimerRef = useRef<number | null>(null);
    const lastAnchorLineRef = useRef<number | null>(null);

    useEffect(() => {
      if (anchor && entry) {
        // Same line — keep visible, skip debounce (e.g. re-entering popover itself)
        if (lastAnchorLineRef.current === anchor.line && visible) return;

        lastAnchorLineRef.current = anchor.line;
        setVisible(false);

        if (showTimerRef.current !== null) window.clearTimeout(showTimerRef.current);
        showTimerRef.current = window.setTimeout(() => {
          setVisible(true);
          showTimerRef.current = null;
        }, POPOVER_SHOW_DELAY);
      } else {
        lastAnchorLineRef.current = null;
        setVisible(false);
        if (showTimerRef.current !== null) {
          window.clearTimeout(showTimerRef.current);
          showTimerRef.current = null;
        }
      }

      return () => {
        if (showTimerRef.current !== null) {
          window.clearTimeout(showTimerRef.current);
          showTimerRef.current = null;
        }
      };
    }, [anchor, entry]);

    if (!anchor || !entry) return null;

    return (
      <Popover
        open={visible}
        anchorRect={anchor.rect}
        placement="bottom"
        align="start"
        offset={8}
        crossOffset={20}
        viewportPadding={12}
        zIndex={10050}
        className={styles.outlinePopoverPortal}
        role="dialog"
        onMouseEnter={onClearTimeout}
        onMouseLeave={onStartTimeout}
      >
        <div className={styles.outlinePopoverHeader}>
          <span className={styles.outlinePopoverTitle}>
            {aiTitle ? `${entry.text} ${aiTitle}` : entry.text}
          </span>
          <span className={styles.outlinePopoverWordCount}>
            {entry.wordCount >= 1000
              ? `${(entry.wordCount / 1000).toFixed(1)}k 字`
              : `${entry.wordCount} 字`}
          </span>
        </div>
        <div className={styles.outlinePopoverDivider} />
        {summaryState === 'loading' ? (
          <div className={styles.outlinePopoverLoadingDots}>
            <span />
            <span />
            <span />
          </div>
        ) : summaryState === 'success' ? (
          <>
            <span className={styles.outlinePopoverAiBadge}>AI 生成</span>
            <div className={styles.outlinePopoverSummary}>{summaryText}</div>
            <button
              className={styles.outlineSummaryRefresh}
              onClick={() => onRefreshSummary(entry)}
              title="刷新总结"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
              </svg>
            </button>
          </>
        ) : summaryState === 'error' ? (
          <div className={styles.outlinePopoverErrorBlock}>
            <Tooltip content={summaryError || '摘要生成失败'} position="top">
              <span className={styles.outlinePopoverErrorText}>摘要生成失败</span>
            </Tooltip>
            <button
              className={styles.outlinePopoverRetryBtn}
              onClick={() => onRefreshSummary(entry)}
            >
              重试
            </button>
          </div>
        ) : (
          /* idle — AI summary not yet requested */
          <>
            <span className={styles.outlinePopoverExcerptBadge}>正文节选</span>
            <div className={styles.outlinePopoverSummary}>{summaryText}</div>
          </>
        )}
      </Popover>
    );
  }
);
