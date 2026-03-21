import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import styles from './styles.module.scss';
import { tryParseJSON, SEVERITY_LABELS, TYPE_LABELS } from './useAiWorkflow';
import type { AIResultItem, FixResult } from './useAiWorkflow';
import { InlineDiffView } from '../InlineDiffView';

// ─── Fix actions bar (copy / save) ─────────────────────────────────────────
interface AIFixActionsBarProps {
  copied: boolean;
  saved: boolean;
  onCopy: () => void;
  onSave: () => void;
}

export const AIFixActionsBar: React.FC<AIFixActionsBarProps> = React.memo(
  ({ copied, saved, onCopy, onSave }) => (
    <>
      <div className={styles.aiActionDivider} />
      <div className={styles.aiResultActions}>
        <button className={styles.aiCopyButton} onClick={onCopy} title="复制全部分析结果">
          {copied ? '✓ 已复制' : '复制全部'}
        </button>
        <button
          className={styles.aiSaveButton}
          onClick={onSave}
          title="保存到项目 ai-reports/ 目录"
        >
          {saved ? '✓ 已保存到 ai-reports/' : '保存为文件'}
        </button>
      </div>
    </>
  )
);

// ─── Structured JSON result renderer ───────────────────────────────────────
interface AIResultPanelProps {
  result: string;
  loading: boolean;
  onAutoFix?: (item: AIResultItem) => Promise<FixResult>;
  onApplyFixToSource?: (fix: FixResult) => Promise<void>;
  persistedFixes?: Record<number, FixResult>;
  onPersistFix?: (idx: number, fix: FixResult) => void;
  onRejectFix?: (idx: number) => void;
}

export const AIResultPanel: React.FC<AIResultPanelProps> = React.memo(
  ({
    result,
    loading,
    onAutoFix,
    onApplyFixToSource,
    persistedFixes,
    onPersistFix,
    onRejectFix,
  }) => {
    if (loading) {
      return (
        <div className={styles.aiResultBox}>
          <span className={styles.aiResultLoading}>正在分析...</span>
        </div>
      );
    }

    if (!result) return null;

    return (
      <div className={styles.aiResultBox}>
        <AIResultDisplay
          result={result}
          onAutoFix={onAutoFix}
          onApplyFixToSource={onApplyFixToSource}
          persistedFixes={persistedFixes}
          onPersistFix={onPersistFix}
          onRejectFix={onRejectFix}
        />
      </div>
    );
  }
);

// ─── Internal: structured result with per-item fix management ──────────────
const AIResultDisplay: React.FC<{
  result: string;
  onAutoFix?: (item: AIResultItem) => Promise<FixResult>;
  onApplyFixToSource?: (fix: FixResult) => Promise<void>;
  persistedFixes?: Record<number, FixResult>;
  onPersistFix?: (idx: number, fix: FixResult) => void;
  onRejectFix?: (idx: number) => void;
}> = React.memo(
  ({ result, onAutoFix, onApplyFixToSource, persistedFixes, onPersistFix, onRejectFix }) => {
    const parsed = useMemo(() => tryParseJSON(result), [result]);
    const [fixStates, setFixStates] = useState<
      Record<
        number,
        {
          loading: boolean;
          fix: FixResult | null;
          copied: boolean;
          applied: boolean;
          applyError?: string;
        }
      >
    >({});
    const copyFixTimerRef = useRef<ReturnType<typeof setTimeout>>();

    useEffect(
      () => () => {
        if (copyFixTimerRef.current) clearTimeout(copyFixTimerRef.current);
      },
      []
    );

    const handleFix = useCallback(
      async (idx: number, item: AIResultItem) => {
        if (!onAutoFix) return;
        setFixStates((prev) => ({
          ...prev,
          [idx]: { loading: true, fix: null, copied: false, applied: false },
        }));
        const fix = await onAutoFix(item);
        onPersistFix?.(idx, { ...fix, applied: false });
        setFixStates((prev) => ({
          ...prev,
          [idx]: { loading: false, fix, copied: false, applied: false },
        }));
      },
      [onAutoFix, onPersistFix]
    );

    const handleCopyFix = useCallback((idx: number, text: string) => {
      void navigator.clipboard.writeText(text).then(() => {
        setFixStates((prev) => ({
          ...prev,
          [idx]: { ...prev[idx], copied: true },
        }));
        if (copyFixTimerRef.current) clearTimeout(copyFixTimerRef.current);
        copyFixTimerRef.current = setTimeout(() => {
          setFixStates((prev) => ({
            ...prev,
            [idx]: { ...prev[idx], copied: false },
          }));
        }, 2000);
      });
    }, []);

    const handleApply = useCallback(
      async (idx: number, fix: FixResult) => {
        if (!onApplyFixToSource) return;
        if (fixStates[idx]?.applied || fix.applied) return;
        try {
          await onApplyFixToSource(fix);
          onPersistFix?.(idx, { ...fix, applied: true });
          setFixStates((prev) => ({
            ...prev,
            [idx]: { ...prev[idx], applied: true, applyError: undefined },
          }));
        } catch (error) {
          const msg = error instanceof Error ? error.message : '自动修复应用失败';
          setFixStates((prev) => ({
            ...prev,
            [idx]: { ...prev[idx], applyError: msg, applied: false },
          }));
        }
      },
      [onApplyFixToSource, onPersistFix, fixStates]
    );

    const handleReject = useCallback(
      (idx: number) => {
        if (fixStates[idx]?.applied || persistedFixes?.[idx]?.applied) return;
        onRejectFix?.(idx);
        setFixStates((prev) => {
          const next = { ...prev };
          delete next[idx];
          return next;
        });
      },
      [onRejectFix, fixStates, persistedFixes]
    );

    // Fallback: raw text
    if (!parsed) {
      return <div className={styles.aiResultContent}>{result}</div>;
    }

    return (
      <div className={styles.aiJsonResult}>
        {parsed.summary && <div className={styles.aiJsonSummary}>{parsed.summary}</div>}

        {parsed.items.map((item, idx) => {
          const sev = item.severity ? SEVERITY_LABELS[item.severity] : null;
          const persisted = persistedFixes?.[idx];
          const fix = fixStates[idx]
            ? fixStates[idx]
            : persisted
              ? {
                  loading: false,
                  fix: persisted,
                  copied: false,
                  applied: !!persisted.applied,
                  applyError: undefined,
                }
              : undefined;
          return (
            <div key={idx} className={styles.aiJsonItem}>
              <div className={styles.aiJsonItemHeader}>
                <span className={styles.aiJsonItemTitle}>{item.title}</span>
                <div className={styles.aiJsonItemTags}>
                  {fix?.applied && <span className={styles.aiFixAppliedBadge}>✓ 已接受</span>}
                  {item.type && (
                    <span className={styles.aiJsonItemType}>
                      {TYPE_LABELS[item.type] || item.type}
                    </span>
                  )}
                  {sev && (
                    <span className={`${styles.aiJsonItemSeverity} ${styles[sev.cls]}`}>
                      {sev.label}
                    </span>
                  )}
                </div>
              </div>
              <div className={styles.aiJsonItemDesc}>{item.description}</div>
              {item.impact && (
                <div className={styles.aiJsonItemField}>
                  <span className={styles.aiJsonFieldLabel}>影响</span>
                  {item.impact}
                </div>
              )}
              {item.suggestion && (
                <div className={styles.aiJsonItemField}>
                  <span className={styles.aiJsonFieldLabel}>建议</span>
                  {item.suggestion}
                </div>
              )}
              {/* Auto-fix area */}
              {onAutoFix && item.suggestion && (
                <div className={styles.aiJsonItemActions}>
                  {!fix?.fix && !fix?.loading && (
                    <button className={styles.aiAutoFixButton} onClick={() => handleFix(idx, item)}>
                      ✨ 自动修改
                    </button>
                  )}
                  {fix?.loading && (
                    <span className={styles.aiAutoFixLoading}>
                      <span className={styles.aiAutoFixSpinner} aria-hidden="true" />
                      修改生成中...
                    </span>
                  )}
                </div>
              )}
              {/* Inline fix result */}
              {fix?.fix && !fix.loading && (
                <>
                  {fix.fix.original && fix.fix.modified ? (
                    <InlineDiffView
                      original={fix.fix.original}
                      modified={fix.fix.modified}
                      explanation={
                        fix.fix.text !== fix.fix.modified
                          ? fix.fix.text.split('\n\n修改后：')[0]
                          : undefined
                      }
                      onAccept={
                        onApplyFixToSource && !fix.applied
                          ? () => handleApply(idx, fix.fix!)
                          : undefined
                      }
                      onReject={!fix.applied ? () => handleReject(idx) : undefined}
                      applied={fix.applied}
                    />
                  ) : (
                    <div className={styles.aiFixResult}>
                      <div className={styles.aiFixResultHeader}>
                        <span className={styles.aiFixResultLabel}>修改建议</span>
                        <div className={styles.aiFixResultActions}>
                          <button
                            className={styles.aiFixCopyButton}
                            onClick={() => handleCopyFix(idx, fix.fix!.text)}
                          >
                            {fix.copied ? '✓ 已复制' : '复制'}
                          </button>
                        </div>
                      </div>
                      <div className={styles.aiFixResultContent}>{fix.fix.text}</div>
                    </div>
                  )}

                  {fix.applyError && (
                    <div className={styles.aiFixResult} style={{ marginTop: 8 }}>
                      <div className={styles.aiFixResultHeader}>
                        <span className={styles.aiFixResultLabel} style={{ color: '#ff7875' }}>
                          命中失败诊断
                        </span>
                      </div>
                      <div className={styles.aiFixResultContent}>{fix.applyError}</div>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}

        {parsed.conclusion && <div className={styles.aiJsonConclusion}>{parsed.conclusion}</div>}
      </div>
    );
  }
);
