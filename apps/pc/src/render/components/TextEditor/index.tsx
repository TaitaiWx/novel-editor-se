import React, { useEffect, useRef, useCallback } from 'react';
import type { EditorView } from '@codemirror/view';
import LoadingSpinner from '../LoadingSpinner';
import ErrorState from '../ErrorState';
import EmptyState from '../EmptyState';
import { useToast } from '../Toast';
import type { CharacterHighlightPattern } from './writing-decorations';
import type { InlineDiffRange } from './inline-diff';
import {
  getDisplayFileName,
  getLanguageBadge,
  isChangelogPath,
  isPersistablePath,
  isUntitledPath,
} from './editor-paths';
import type { TextEditorProps } from './types';
import { useSyncedRef } from './hooks/useSyncedRef';
import { useEditorRuntime } from './hooks/useEditorRuntime';
import { useViewportSnapshots } from './hooks/useViewportSnapshots';
import { useEditorSave } from './hooks/useEditorSave';
import { useCodeMirrorView } from './hooks/useCodeMirrorView';
import { useEditorFileLoader } from './hooks/useEditorFileLoader';
import { useEditorRequests } from './hooks/useEditorRequests';
import { useDirtyStateBroadcast } from './hooks/useDirtyStateBroadcast';
import { useActiveEditorRegistration } from './hooks/useActiveEditorRegistration';
import { useEditorAssistExtension } from './hooks/useEditorAssistExtension';
import EditorFileHeader from './EditorFileHeader';
import styles from './styles.module.scss';

const DEFAULT_SHOW_LINE_NUMBERS = false;

export type { EditorViewportSnapshot } from './types';
export type { InlineDiffRange };
export type { CharacterHighlightPattern };
export type { EditorAssistConfig } from './assist/types';

interface UnmountFlushRefs {
  autoSaveTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
  transientHighlightTimerRef: React.MutableRefObject<number | null>;
  appliedLineMarkerTimerRef: React.MutableRefObject<number | null>;
  currentFilePathRef: React.MutableRefObject<string | null>;
  currentContentRef: React.MutableRefObject<string>;
  currentOriginalContentRef: React.MutableRefObject<string>;
  readOnlyRef: React.MutableRefObject<boolean>;
}

/**
 * 编辑器卸载时清理定时器，并把未保存的内容写回磁盘。
 * 刻意在调用时才读取 ref.current，确保拿到卸载那一刻的最新文件路径与内容。
 */
function flushEditorOnUnmount(refs: UnmountFlushRefs) {
  if (refs.autoSaveTimeoutRef.current) {
    clearTimeout(refs.autoSaveTimeoutRef.current);
  }
  if (refs.transientHighlightTimerRef.current) {
    window.clearTimeout(refs.transientHighlightTimerRef.current);
  }
  if (refs.appliedLineMarkerTimerRef.current) {
    window.clearTimeout(refs.appliedLineMarkerTimerRef.current);
  }
  const filePath = refs.currentFilePathRef.current;
  const content = refs.currentContentRef.current;
  if (
    isPersistablePath(filePath) &&
    content !== refs.currentOriginalContentRef.current &&
    !refs.readOnlyRef.current
  ) {
    window.electron.ipcRenderer.invoke('write-file', filePath, content).catch((err) => {
      console.error('Failed to save on unmount:', err);
    });
  }
}

const TextEditor: React.FC<TextEditorProps> = ({
  filePath,
  reloadToken,
  focusMode = false,
  wordWrap = true,
  showLineNumbers = DEFAULT_SHOW_LINE_NUMBERS,
  showThousandCharMarkers = true,
  thousandCharMarkerStep = 1000,
  readOnly = false,
  hideHeader = false,
  virtualContent,
  encoding = 'UTF-8',
  characterHighlights = [],
  scrollToLine,
  transientHighlightLine,
  replaceLineRequest,
  inlineDiff,
  editorViewRef,
  viewportSnapshots,
  onViewportSnapshotChange,
  onContentChange,
  onCursorChange,
  onSaveUntitled,
  onScrollProcessed,
  onTransientHighlightProcessed,
  settingsComponent,
  emptyStateActions,
  assist,
}) => {
  const isUntitled = isUntitledPath(filePath);
  const isChangelog = isChangelogPath(filePath);
  const toast = useToast();

  const editorContainerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const currentFilePathRef = useRef<string | null>(null);
  const currentContentRef = useRef<string>('');
  const currentOriginalContentRef = useRef<string>('');
  const transientHighlightTimerRef = useRef<number | null>(null);
  const appliedLineMarkerTimerRef = useRef<number | null>(null);

  // Stable refs for callbacks to avoid re-creating EditorView
  const onContentChangeRef = useSyncedRef(onContentChange);
  const onCursorChangeRef = useSyncedRef(onCursorChange);
  const onSaveUntitledRef = useSyncedRef(onSaveUntitled);
  const readOnlyRef = useSyncedRef(readOnly);
  const filePathRef = useSyncedRef(filePath);

  const { saveViewportSnapshot, restoreViewportSnapshot } = useViewportSnapshots({
    viewRef,
    currentFilePathRef,
    viewportSnapshots,
    onViewportSnapshotChange,
  });

  const { editorRuntime, editorInitError } = useEditorRuntime();

  const emitCursorPosition = useCallback(
    (view: EditorView | null) => {
      if (!view) return;
      const pos = view.state.selection.main.head;
      const line = view.state.doc.lineAt(pos);
      onCursorChangeRef.current?.({
        line: line.number,
        column: pos - line.from + 1,
      });
    },
    [onCursorChangeRef]
  );

  const {
    autoSaving,
    lastSaved,
    setLastSaved,
    hasChanges,
    setHasChanges,
    scheduleAutoSave,
    handleManualSave,
    handleManualSaveRef,
  } = useEditorSave({
    currentFilePathRef,
    currentContentRef,
    currentOriginalContentRef,
    readOnlyRef,
    filePathRef,
    onSaveUntitledRef,
    autoSaveTimeoutRef,
    toast,
  });
  useDirtyStateBroadcast(filePath, hasChanges);
  // 应用菜单的 保存 / 另存为 / 查找 作用于最近聚焦的编辑器
  useActiveEditorRegistration({
    editorContainerRef,
    viewRef,
    currentFilePathRef,
    currentContentRef,
    readOnlyRef,
    handleManualSaveRef,
  });

  const { editorReady, readOnlyCompartment, wordWrapCompartment } = useCodeMirrorView({
    editorContainerRef,
    viewRef,
    editorViewRef,
    editorRuntime,
    currentContentRef,
    currentOriginalContentRef,
    onContentChangeRef,
    onCursorChangeRef,
    handleManualSaveRef,
    setHasChanges,
    scheduleAutoSave,
    saveViewportSnapshot,
    filePath,
    isUntitled,
    readOnly,
    wordWrap,
    focusMode,
    showLineNumbers,
    showThousandCharMarkers,
    thousandCharMarkerStep,
    characterHighlights,
  });

  // 人物悬停卡片 / 行内续写（懒加载，配置经 ref 读取最新值）
  useEditorAssistExtension({ viewRef, editorReady, assist, filePath, readOnly });

  // Save on unmount：卸载时读取各 ref 的最新值（而非挂载时快照），交由模块级函数处理
  useEffect(() => {
    return () =>
      flushEditorOnUnmount({
        autoSaveTimeoutRef,
        transientHighlightTimerRef,
        appliedLineMarkerTimerRef,
        currentFilePathRef,
        currentContentRef,
        currentOriginalContentRef,
        readOnlyRef,
      });
  }, [readOnlyRef]);

  const { loading, error, isLargeFile, handleRetry } = useEditorFileLoader({
    editorReady,
    editorInitError,
    filePath,
    encoding,
    reloadToken,
    virtualContent,
    readOnly,
    wordWrap,
    focusMode,
    viewRef,
    currentFilePathRef,
    currentContentRef,
    currentOriginalContentRef,
    readOnlyRef,
    readOnlyCompartment,
    wordWrapCompartment,
    setHasChanges,
    setLastSaved,
    emitCursorPosition,
    restoreViewportSnapshot,
    saveViewportSnapshot,
    onContentChange,
    onCursorChange,
  });

  useEditorRequests({
    viewRef,
    scrollToLine,
    transientHighlightLine,
    inlineDiff,
    replaceLineRequest,
    onScrollProcessed,
    onTransientHighlightProcessed,
    transientHighlightTimerRef,
    appliedLineMarkerTimerRef,
  });

  const language = getLanguageBadge(filePath);
  const fileName = getDisplayFileName(filePath);

  const resolvedError = editorInitError ?? error;

  // Determine which overlay to show (if any)
  const showEmpty = !filePath;
  const showLoading = !!filePath && !resolvedError && (!editorReady || loading);
  const showError = !!filePath && !showLoading && !!resolvedError;
  const showEditor = !!filePath && editorReady && !loading && !resolvedError;

  return (
    <div className={`${styles.textEditor} ${focusMode ? styles.focusModeEditor : ''}`}>
      {/* File header — only visible when a file is active */}
      {showEditor && !focusMode && !hideHeader && (
        <EditorFileHeader
          fileName={fileName}
          language={language}
          hasChanges={hasChanges}
          isLargeFile={isLargeFile}
          readOnly={readOnly}
          isChangelog={isChangelog}
          autoSaving={autoSaving}
          lastSaved={lastSaved}
          onSave={handleManualSave}
          settingsComponent={settingsComponent}
        />
      )}

      {/* Editor container — ALWAYS rendered so the EditorView DOM node is never removed */}
      <div className={styles.editorContainer} style={{ display: showEditor ? undefined : 'none' }}>
        <div ref={editorContainerRef} className={styles.cmHost} />
      </div>

      {/* Overlay states */}
      {showEmpty && (
        <div className={styles.overlay}>
          <EmptyState
            title="选择文件开始编辑"
            description="从左侧文件树中选择一个文件来开始编辑"
            variant="file"
            actions={emptyStateActions}
          />
        </div>
      )}
      {showLoading && (
        <div className={styles.overlay}>
          <LoadingSpinner message="正在加载文件内容..." size="medium" />
        </div>
      )}
      {showError && (
        <div className={styles.overlay}>
          <ErrorState
            title="文件加载失败"
            message={resolvedError!}
            size="medium"
            onRetry={handleRetry}
          />
        </div>
      )}
    </div>
  );
};

export default TextEditor;
