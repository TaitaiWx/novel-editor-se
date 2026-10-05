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
import EditorFileHeader from './EditorFileHeader';
import styles from './styles.module.scss';

const DEFAULT_SHOW_LINE_NUMBERS = false;

export type { EditorViewportSnapshot } from './types';
export type { InlineDiffRange };
export type { CharacterHighlightPattern };

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

  const emitCursorPosition = useCallback((view: EditorView | null) => {
    if (!view) return;
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    onCursorChangeRef.current?.({
      line: line.number,
      column: pos - line.from + 1,
    });
  }, []);

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

  // Save on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
      if (transientHighlightTimerRef.current) {
        window.clearTimeout(transientHighlightTimerRef.current);
      }
      if (appliedLineMarkerTimerRef.current) {
        window.clearTimeout(appliedLineMarkerTimerRef.current);
      }
      if (
        isPersistablePath(currentFilePathRef.current) &&
        currentContentRef.current !== currentOriginalContentRef.current &&
        !readOnlyRef.current
      ) {
        window.electron.ipcRenderer
          .invoke('write-file', currentFilePathRef.current, currentContentRef.current)
          .catch((err) => {
            console.error('Failed to save on unmount:', err);
          });
      }
    };
  }, []);

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
