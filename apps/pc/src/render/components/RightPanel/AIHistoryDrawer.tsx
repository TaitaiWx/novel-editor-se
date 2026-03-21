import React, { useCallback } from 'react';
import styles from './styles.module.scss';
import { WORKFLOW_DEFS, getSeverityCounts, getHistorySummary } from './useAiWorkflow';
import type { WorkflowKey } from './useAiWorkflow';
import type { HistoryRecord } from './useAiHistory';
import { formatTimestamp } from './useAiHistory';

interface AIHistoryDrawerProps {
  history: HistoryRecord[];
  activeHistoryId: string | null;
  onRestore: (record: HistoryRecord) => void;
  onDelete: (id: string) => void;
}

export const AIHistoryDrawer: React.FC<AIHistoryDrawerProps> = React.memo(
  ({ history, activeHistoryId, onRestore, onDelete }) => {
    const handleDelete = useCallback(
      (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        onDelete(id);
      },
      [onDelete]
    );

    if (history.length === 0) {
      return (
        <div className={styles.aiHistoryPanel}>
          <div className={styles.aiHistoryEmpty}>暂无分析记录</div>
        </div>
      );
    }

    return (
      <div className={styles.aiHistoryPanel}>
        {history.map((record) => {
          const counts = getSeverityCounts(record.result);
          const summary = getHistorySummary(record.result);
          return (
            <div
              key={record.id}
              className={`${styles.aiHistoryItem} ${activeHistoryId === record.id ? styles.aiHistoryItemActive : ''}`}
            >
              <div className={styles.aiHistoryItemHeader} onClick={() => onRestore(record)}>
                <span className={styles.aiHistoryItemTag}>
                  {WORKFLOW_DEFS[record.workflow as WorkflowKey]?.title || record.workflow}
                </span>
              </div>
              {/* Severity badges */}
              {counts && (counts.high > 0 || counts.medium > 0 || counts.low > 0) && (
                <div className={styles.aiHistoryBadges} onClick={() => onRestore(record)}>
                  {counts.high > 0 && (
                    <span className={`${styles.aiHistoryBadge} ${styles.aiSeverityHigh}`}>
                      高 {counts.high}
                    </span>
                  )}
                  {counts.medium > 0 && (
                    <span className={`${styles.aiHistoryBadge} ${styles.aiSeverityMedium}`}>
                      中 {counts.medium}
                    </span>
                  )}
                  {counts.low > 0 && (
                    <span className={`${styles.aiHistoryBadge} ${styles.aiSeverityLow}`}>
                      低 {counts.low}
                    </span>
                  )}
                </div>
              )}
              {/* AI summary */}
              <div className={styles.aiHistoryItemPreview} onClick={() => onRestore(record)}>
                {summary}
              </div>
              <div className={styles.aiHistoryItemFooter} onClick={() => onRestore(record)}>
                <span className={styles.aiHistoryItemTime}>{formatTimestamp(record.timestamp)}</span>
              </div>
              <button
                className={styles.aiHistoryItemDelete}
                onClick={(e) => handleDelete(e, record.id)}
                title="删除此记录"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    );
  }
);
