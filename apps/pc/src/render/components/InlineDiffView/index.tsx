/**
 * InlineDiffView — VSCode Copilot 风格的内联差异对比组件
 *
 * 功能：
 * - 行级差异对比（LCS 算法）
 * - 字符级变更高亮（中英文自适应）
 * - 上下文折叠（仅展示变更附近 N 行）
 * - 接受 / 拒绝 / 复制 操作
 */
import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  computeLineDiff,
  computeCharDiff,
  collapseContext,
  buildCharDiffMap,
  isCollapsedBlock,
  type DiffLine,
  type CharSegment,
} from '@novel-editor/basic-algorithm';
import styles from './styles.module.scss';

export type { DiffLine, CharSegment };
export { computeLineDiff, computeCharDiff, collapseContext } from '@novel-editor/basic-algorithm';

export interface InlineDiffViewProps {
  /** 原始文本 */
  original: string;
  /** 修改后文本 */
  modified: string;
  /** 变更说明 (可选) */
  explanation?: string;
  /** 接受变更 */
  onAccept?: () => void;
  /** 拒绝变更 */
  onReject?: () => void;
  /** 标题 (默认: "修改建议") */
  title?: string;
  /** 是否已应用 */
  applied?: boolean;
  /** 上下文行数，变更前后保留几行 (默认 3，0=全部显示) */
  contextLines?: number;
}

// ─── CharDiffLine: line with character-level highlights ─────────────────────

const CharDiffLine: React.FC<{
  segments: CharSegment[];
  lineType: 'del' | 'add';
}> = React.memo(({ segments, lineType }) => {
  // For del line: show keep+del, filter out add
  // For add line: show keep+add, filter out del
  const skipType = lineType === 'del' ? 'add' : 'del';
  return (
    <span className={styles.diffText}>
      {segments
        .filter((seg) => seg.type !== skipType)
        .map((seg, i) => {
          if (seg.type === 'keep') return <span key={i}>{seg.text}</span>;
          return (
            <span key={i} className={seg.type === 'del' ? styles.charDel : styles.charAdd}>
              {seg.text}
            </span>
          );
        })}
    </span>
  );
});

// ─── Main component ─────────────────────────────────────────────────────────

export const InlineDiffView: React.FC<InlineDiffViewProps> = React.memo(
  ({
    original,
    modified,
    explanation,
    onAccept,
    onReject,
    title = '修改建议',
    applied,
    contextLines = 3,
  }) => {
    const [copied, setCopied] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout>>();

    // Cleanup timer on unmount
    useEffect(
      () => () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      },
      []
    );

    const diffLines = useMemo(
      () => computeLineDiff(original.split('\n'), modified.split('\n')),
      [original, modified]
    );

    const charDiffMap = useMemo(() => buildCharDiffMap(diffLines), [diffLines]);

    const displayItems = useMemo(
      () => collapseContext(diffLines, contextLines),
      [diffLines, contextLines]
    );

    // Annotate display items with original diffLines index for char-diff lookup
    const annotated = useMemo(() => {
      const items: Array<
        { kind: 'line'; line: DiffLine; origIdx: number } | { kind: 'collapsed'; count: number }
      > = [];
      let origIdx = 0;
      for (const item of displayItems) {
        if (isCollapsedBlock(item)) {
          items.push({ kind: 'collapsed', count: item.count });
          origIdx += item.count;
        } else {
          items.push({ kind: 'line', line: item, origIdx });
          origIdx++;
        }
      }
      return items;
    }, [displayItems]);

    const stats = useMemo(() => {
      let adds = 0;
      let dels = 0;
      for (const l of diffLines) {
        if (l.type === 'add') adds++;
        if (l.type === 'del') dels++;
      }
      return { adds, dels };
    }, [diffLines]);

    const handleCopy = useCallback(() => {
      void navigator.clipboard.writeText(modified).then(() => {
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 2000);
      });
    }, [modified]);

    return (
      <div className={styles.inlineDiff}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.title}>{title}</span>
            <span className={styles.stats}>
              {stats.adds > 0 && <span className={styles.statsAdd}>+{stats.adds}</span>}
              {stats.dels > 0 && <span className={styles.statsDel}>-{stats.dels}</span>}
            </span>
          </div>
          <div className={styles.actions}>
            {onAccept && (
              <button
                className={styles.acceptButton}
                onClick={onAccept}
                title="接受修改，应用到源文件"
                disabled={applied}
              >
                {applied ? '✓ 已应用' : '✓ 接受'}
              </button>
            )}
            {onReject && !applied && (
              <button className={styles.rejectButton} onClick={onReject} title="拒绝修改">
                ✕ 拒绝
              </button>
            )}
            <button className={styles.copyButton} onClick={handleCopy} title="复制修改后文本">
              {copied ? '✓ 已复制' : '复制'}
            </button>
          </div>
        </div>

        {/* Explanation */}
        {explanation && <div className={styles.explanation}>{explanation}</div>}

        {/* Diff content */}
        <div className={styles.diffBody}>
          {annotated.map((item, di) => {
            if (item.kind === 'collapsed') {
              return (
                <div key={`c-${di}`} className={styles.collapsedBlock}>
                  <span className={styles.collapsedText}>⋯ {item.count} 行未变更 ⋯</span>
                </div>
              );
            }
            const { line, origIdx } = item;
            const charSegs = charDiffMap.get(origIdx);
            const lineClass =
              line.type === 'add'
                ? styles.diffLineAdd
                : line.type === 'del'
                  ? styles.diffLineDel
                  : styles.diffLineKeep;
            return (
              <div key={di} className={`${styles.diffLine} ${lineClass}`}>
                <span className={styles.diffGutter}>
                  {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                </span>
                {charSegs && line.type !== 'keep' ? (
                  <CharDiffLine segments={charSegs} lineType={line.type} />
                ) : (
                  <span className={styles.diffText}>{line.text || '\u00A0'}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
);
