/**
 * DiffEditor — 基于 @codemirror/merge 的差异对比编辑器
 *
 * 用于版本对比、修订查看。左侧为原始内容，右侧为修改后内容。
 */
import React, { useEffect, useRef, useCallback } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { MergeView } from '@codemirror/merge';
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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mergeViewRef = useRef<MergeView | null>(null);

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
      collapseUnchanged: { margin: 3, minSize: 4 },
    });

    mergeViewRef.current = view;

    return () => {
      view.destroy();
      mergeViewRef.current = null;
    };
  }, [original, modified]);

  const handleClose = useCallback(() => {
    onClose?.();
  }, [onClose]);

  return (
    <div className={styles.diffEditor}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.label}>{originalLabel}</span>
          <span className={styles.label}>↔</span>
          <span className={styles.label}>{modifiedLabel}</span>
        </div>
        <div className={styles.headerRight}>
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
