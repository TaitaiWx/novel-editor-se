/**
 * DiffEditor — 基于 @codemirror/merge 的差异对比编辑器
 *
 * 用于版本对比、修订查看。左侧为原始内容，右侧为修改后内容。
 */
import React, { useEffect, useRef, useCallback, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { MergeView, goToNextChunk, goToPreviousChunk } from '@codemirror/merge';
import styles from './styles.module.scss';

interface DiffEditorProps {
  /** 原始文本 */
  original: string;
  /** 修改后文本 */
  modified: string;
  /** 原始文件名（显示用） */
  originalLabel?: string;
  /** 修改后文件名（显示用） */
  modifiedLabel?: string;
  /** 关闭回调 */
  onClose?: () => void;
  /** 接受变更回调（用于 AI 修复确认） */
  onAccept?: () => void;
}

/** 共用暗色主题 */
const diffDarkTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: '#1e1e1e',
      color: '#d4d4d4',
      fontSize: '14px',
    },
    '.cm-content': {
      fontFamily: "'Fira Code', 'Monaco', 'Menlo', 'Ubuntu Mono', monospace",
      caretColor: '#d4d4d4',
      padding: '12px 0',
      lineHeight: '1.6',
    },
    '.cm-gutters': {
      backgroundColor: '#1e1e1e',
      color: '#555',
      border: 'none',
      borderRight: '1px solid #2d2d2d',
      minWidth: '42px',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 8px 0 6px',
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: "'Fira Code', 'Monaco', 'Menlo', 'Ubuntu Mono', monospace",
    },
    '&.cm-focused': {
      outline: 'none',
    },
  },
  { dark: true }
);

const sharedExtensions = [lineNumbers(), diffDarkTheme, EditorView.editable.of(false)];

const DiffEditor: React.FC<DiffEditorProps> = ({
  original,
  modified,
  originalLabel = '原始版本',
  modifiedLabel = '修改版本',
  onClose,
  onAccept,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mergeViewRef = useRef<MergeView | null>(null);
  const [chunkCount, setChunkCount] = useState(0);
  const [activeChunkIndex, setActiveChunkIndex] = useState<number>(0);

  const resolveActiveChunkIndex = useCallback((view: EditorView, merge: MergeView): number => {
    if (merge.chunks.length === 0) return 0;
    const pos = view.state.selection.main.head;

    for (let i = 0; i < merge.chunks.length; i++) {
      const chunk = merge.chunks[i];
      const from = chunk.fromB;
      const to = Math.max(chunk.toB, from + 1);
      if (pos >= from && pos <= to) return i + 1;
      if (pos < from) return i + 1;
    }

    return merge.chunks.length;
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    // 清除旧实例
    if (mergeViewRef.current) {
      mergeViewRef.current.destroy();
    }

    const view = new MergeView({
      a: {
        doc: original,
        extensions: [...sharedExtensions, EditorState.readOnly.of(true)],
      },
      b: {
        doc: modified,
        extensions: [...sharedExtensions, EditorState.readOnly.of(true)],
      },
      parent: containerRef.current,
      collapseUnchanged: { margin: 4, minSize: 6 },
      highlightChanges: true,
      gutter: true,
      diffConfig: {
        scanLimit: 2000,
      },
    });

    mergeViewRef.current = view;
    setChunkCount(view.chunks.length);
    setActiveChunkIndex(view.chunks.length > 0 ? 1 : 0);

    // 打开 diff 时自动定位并高亮首个变更块（VS Code 风格）
    if (view.chunks.length > 0) {
      requestAnimationFrame(() => {
        view.b.focus();
        goToNextChunk(view.b);
        setActiveChunkIndex(resolveActiveChunkIndex(view.b, view));
      });
    }

    return () => {
      view.destroy();
      mergeViewRef.current = null;
      setChunkCount(0);
    };
  }, [original, modified, resolveActiveChunkIndex]);

  const handleClose = useCallback(() => {
    onClose?.();
  }, [onClose]);

  const handleNavigateChunk = useCallback(
    (direction: 'previous' | 'next') => {
      const merge = mergeViewRef.current;
      const editorView = merge?.b;
      if (!editorView || !merge) {
        return;
      }

      editorView.focus();
      if (direction === 'previous') {
        goToPreviousChunk(editorView);
        setActiveChunkIndex(resolveActiveChunkIndex(editorView, merge));
        return;
      }

      goToNextChunk(editorView);
      setActiveChunkIndex(resolveActiveChunkIndex(editorView, merge));
    },
    [resolveActiveChunkIndex]
  );

  return (
    <div className={styles.diffEditor}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.label} title={originalLabel}>
            {originalLabel}
          </span>
          <span className={styles.label}>↔</span>
          <span className={styles.label} title={modifiedLabel}>
            {modifiedLabel}
          </span>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.summaryBadge}>
            {chunkCount > 0 ? `共${chunkCount}处` : '无变更'}
          </span>
          {chunkCount > 0 && (
            <span className={styles.summaryBadge}>
              {activeChunkIndex}/{chunkCount}
            </span>
          )}
          <button
            className={styles.navButton}
            onClick={() => handleNavigateChunk('previous')}
            disabled={chunkCount === 0}
            title="上一处变更"
          >
            上
          </button>
          <button
            className={styles.navButton}
            onClick={() => handleNavigateChunk('next')}
            disabled={chunkCount === 0}
            title="下一处变更"
          >
            下
          </button>
          {onAccept && (
            <button
              className={styles.navButton}
              onClick={onAccept}
              title="接受修改"
              style={{ color: '#73c991', fontWeight: 600 }}
            >
              ✓ 接受修改
            </button>
          )}
          <button className={styles.closeButton} onClick={handleClose} title="关闭对比">
            ✕
          </button>
        </div>
      </div>
      <div className={styles.mergeContainer} ref={containerRef} />
    </div>
  );
};

export default DiffEditor;
