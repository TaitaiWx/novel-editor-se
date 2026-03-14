import React, { useEffect, useState, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import LoadingSpinner from '../LoadingSpinner';
import ErrorState from '../ErrorState';
import EmptyState from '../EmptyState';
import styles from './styles.module.scss';

/** Threshold: files larger than this show a performance warning */
const LARGE_FILE_THRESHOLD = 500_000; // 500KB
/** Buffer lines rendered above/below viewport for smooth scrolling */
const LINE_BUFFER = 10;
/** Default line height in px (14px * 1.6) */
const DEFAULT_LINE_HEIGHT = 22.4;

interface CursorPosition {
  line: number;
  column: number;
}

interface ScrollToLineRequest {
  line: number;
  id: number;
}

interface TextEditorProps {
  filePath: string | null;
  showGrid?: boolean;
  showRowLines?: boolean;
  readOnly?: boolean;
  encoding?: string;
  scrollToLine?: ScrollToLineRequest | null;
  onContentChange?: (content: string) => void;
  onCursorChange?: (pos: CursorPosition) => void;
  onSaveUntitled?: (untitledPath: string, content: string) => void;
  settingsComponent?: React.ReactNode;
}

const isUntitledPath = (path: string | null): boolean =>
  path !== null && path.startsWith('__untitled__:');

const getLanguageFromPath = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase();
  const languageMap: Record<string, string> = {
    md: 'markdown',
    txt: 'text',
    json: 'json',
    js: 'javascript',
    ts: 'typescript',
    jsx: 'javascript',
    tsx: 'typescript',
  };
  return languageMap[ext || ''] || 'text';
};

const TextEditor: React.FC<TextEditorProps> = ({
  filePath,
  showGrid = false,
  showRowLines = false,
  readOnly = false,
  encoding = 'UTF-8',
  scrollToLine,
  onContentChange,
  onCursorChange,
  onSaveUntitled,
  settingsComponent,
}) => {
  const isUntitled = isUntitledPath(filePath);
  const [content, setContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [currentLine, setCurrentLine] = useState<number>(1);
  const [autoSaving, setAutoSaving] = useState<boolean>(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isLargeFile, setIsLargeFile] = useState(false);

  const [isFocused, setIsFocused] = useState(false);

  // Virtualized line numbers state
  const [visibleLineRange, setVisibleLineRange] = useState({ start: 0, end: 50 });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const lineHighlightRef = useRef<HTMLDivElement>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lineHeightRef = useRef<number>(0);

  const currentFilePathRef = useRef<string | null>(null);
  const currentContentRef = useRef<string>('');
  const currentOriginalContentRef = useRef<string>('');

  const handleScrollRef = useRef<() => void>(() => {});
  const updateCurrentLineRef = useRef<() => void>(() => {});
  const lastScrollIdRef = useRef(0);

  const getLineHeight = useCallback((): number => {
    if (lineHeightRef.current > 0) return lineHeightRef.current;
    if (!textareaRef.current) return DEFAULT_LINE_HEIGHT;
    const computed = parseFloat(getComputedStyle(textareaRef.current).lineHeight);
    lineHeightRef.current = computed || DEFAULT_LINE_HEIGHT;
    return lineHeightRef.current;
  }, []);

  // Compute visible line range from scroll position
  const updateVisibleRange = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const lh = getLineHeight();
    const scrollTop = textarea.scrollTop;
    const viewportHeight = textarea.clientHeight;
    const startLine = Math.max(0, Math.floor(scrollTop / lh) - LINE_BUFFER);
    const endLine = Math.ceil((scrollTop + viewportHeight) / lh) + LINE_BUFFER;
    setVisibleLineRange((prev) => {
      if (prev.start === startLine && prev.end === endLine) return prev;
      return { start: startLine, end: endLine };
    });
  }, [getLineHeight]);

  const updateLineHighlight = useCallback(
    (startLine: number, endLine?: number) => {
      if (!lineHighlightRef.current || !textareaRef.current) return;
      const lineHeight = getLineHeight();
      const padding = 12;
      const scrollTop = textareaRef.current.scrollTop;
      const end = endLine ?? startLine;
      const top = (startLine - 1) * lineHeight + padding - scrollTop;
      const height = (end - startLine + 1) * lineHeight;
      lineHighlightRef.current.style.top = `${top}px`;
      lineHighlightRef.current.style.height = `${height}px`;
    },
    [getLineHeight]
  );

  const handleScroll = useCallback(() => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
    updateLineHighlight(currentLine);
    updateVisibleRange();
  }, [currentLine, updateLineHighlight, updateVisibleRange]);
  handleScrollRef.current = handleScroll;

  const updateCurrentLine = useCallback(() => {
    if (!textareaRef.current) return;

    const textarea = textareaRef.current;
    const selStart = textarea.selectionStart;
    const selEnd = textarea.selectionEnd;
    const textBeforeStart = textarea.value.substring(0, selStart);
    const startLines = textBeforeStart.split('\n');
    const startLine = startLines.length;
    const columnNumber = startLines[startLines.length - 1].length + 1;

    const textBeforeEnd = textarea.value.substring(0, selEnd);
    const endLine = textBeforeEnd.split('\n').length;

    setCurrentLine(startLine);
    updateLineHighlight(startLine, endLine);
    onCursorChange?.({ line: startLine, column: columnNumber });
  }, [onCursorChange, updateLineHighlight]);
  updateCurrentLineRef.current = updateCurrentLine;

  const autoSaveFile = useCallback(async () => {
    const targetPath = currentFilePathRef.current;
    const targetContent = currentContentRef.current;

    if (!targetPath || readOnly || targetContent === currentOriginalContentRef.current) return;
    if (isUntitledPath(targetPath)) return;

    setAutoSaving(true);
    try {
      await window.electron.ipcRenderer.invoke('write-file', targetPath, targetContent);
      if (targetPath === filePath) {
        setOriginalContent(targetContent);
        setLastSaved(new Date());
      }
    } catch (error) {
      console.error('Auto-save failed:', error);
    } finally {
      setAutoSaving(false);
    }
  }, [filePath, readOnly]);

  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      currentContentRef.current = newContent;
      onContentChange?.(newContent);

      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }

      if (!readOnly) {
        autoSaveTimeoutRef.current = setTimeout(() => {
          autoSaveFile();
        }, 2000);
      }
    },
    [onContentChange, autoSaveFile, readOnly]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (isUntitled && filePath && onSaveUntitled) {
          onSaveUntitled(filePath, currentContentRef.current);
        } else {
          autoSaveFile();
        }
      }
    },
    [autoSaveFile, isUntitled, filePath, onSaveUntitled]
  );

  useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }

      if (
        currentFilePathRef.current &&
        !isUntitledPath(currentFilePathRef.current) &&
        currentContentRef.current !== currentOriginalContentRef.current &&
        !readOnly
      ) {
        window.electron.ipcRenderer
          .invoke('write-file', currentFilePathRef.current, currentContentRef.current)
          .catch((error) => {
            console.error('Failed to save on unmount:', error);
          });
      }
    };
  }, [readOnly]);

  useEffect(() => {
    const savePreviousFile = async () => {
      if (
        currentFilePathRef.current &&
        !isUntitledPath(currentFilePathRef.current) &&
        currentContentRef.current !== currentOriginalContentRef.current &&
        !readOnly
      ) {
        try {
          await window.electron.ipcRenderer.invoke(
            'write-file',
            currentFilePathRef.current,
            currentContentRef.current
          );
        } catch (error) {
          console.error('Failed to save previous file:', error);
        }
      }
    };

    if (filePath !== currentFilePathRef.current) {
      savePreviousFile();
    }

    currentFilePathRef.current = filePath;
    currentContentRef.current = content;
    currentOriginalContentRef.current = originalContent;
  }, [filePath, content, originalContent, readOnly]);

  useEffect(() => {
    const loadContent = async () => {
      if (!filePath) {
        setContent('');
        setOriginalContent('');
        setError(null);
        setIsLargeFile(false);
        currentFilePathRef.current = null;
        currentContentRef.current = '';
        currentOriginalContentRef.current = '';
        onContentChange?.('');
        onCursorChange?.({ line: 1, column: 1 });
        return;
      }

      if (isUntitledPath(filePath)) {
        setContent('');
        setOriginalContent('');
        setError(null);
        setLoading(false);
        setLastSaved(null);
        setCurrentLine(1);
        setIsLargeFile(false);
        currentFilePathRef.current = filePath;
        currentContentRef.current = '';
        currentOriginalContentRef.current = '';
        onContentChange?.('');
        onCursorChange?.({ line: 1, column: 1 });
        requestAnimationFrame(() => updateLineHighlight(1));
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const fileContent = await window.electron.ipcRenderer.invoke(
          'read-file',
          filePath,
          encoding
        );
        setContent(fileContent);
        setOriginalContent(fileContent);
        setIsLargeFile(fileContent.length > LARGE_FILE_THRESHOLD);
        setLastSaved(null);
        setCurrentLine(1);

        currentFilePathRef.current = filePath;
        currentContentRef.current = fileContent;
        currentOriginalContentRef.current = fileContent;

        onContentChange?.(fileContent);
        onCursorChange?.({ line: 1, column: 1 });

        requestAnimationFrame(() => {
          updateLineHighlight(1);
          updateVisibleRange();
        });
      } catch (error) {
        console.error('Error reading file:', error);
        setError(`无法读取文件: ${filePath}`);
        setContent('');
        setOriginalContent('');
        currentContentRef.current = '';
        currentOriginalContentRef.current = '';
      } finally {
        setLoading(false);
      }
    };

    loadContent();
  }, [
    filePath,
    encoding,
    onContentChange,
    onCursorChange,
    updateLineHighlight,
    updateVisibleRange,
  ]);

  // Event listeners (stable ref proxy)
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const onScroll = () => handleScrollRef.current();
    const onCursorUpdate = () => updateCurrentLineRef.current();

    let keyupTimer: ReturnType<typeof setTimeout> | null = null;
    const onKeyupDebounced = () => {
      if (keyupTimer) clearTimeout(keyupTimer);
      keyupTimer = setTimeout(onCursorUpdate, 30);
    };

    textarea.addEventListener('scroll', onScroll);
    textarea.addEventListener('click', onCursorUpdate);
    textarea.addEventListener('keyup', onKeyupDebounced);
    textarea.addEventListener('focus', onCursorUpdate);

    return () => {
      if (keyupTimer) clearTimeout(keyupTimer);
      textarea.removeEventListener('scroll', onScroll);
      textarea.removeEventListener('click', onCursorUpdate);
      textarea.removeEventListener('keyup', onKeyupDebounced);
      textarea.removeEventListener('focus', onCursorUpdate);
    };
  }, []);

  // Scroll to a specific line when requested (id-guarded to prevent re-triggering)
  useEffect(() => {
    if (!scrollToLine || !textareaRef.current) return;
    if (scrollToLine.id <= lastScrollIdRef.current) return;
    lastScrollIdRef.current = scrollToLine.id;

    const lh = getLineHeight();
    const textarea = textareaRef.current;
    const targetTop = (scrollToLine.line - 1) * lh;
    const viewportHeight = textarea.clientHeight;
    // Center the target line in the viewport
    textarea.scrollTop = Math.max(0, targetTop - viewportHeight / 3);

    // Sync line numbers scroll immediately
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textarea.scrollTop;
    }

    // Update cursor position to the target line
    const text = currentContentRef.current;
    let charIndex = 0;
    let lineNum = 1;
    for (let i = 0; i < text.length && lineNum < scrollToLine.line; i++) {
      if (text.charCodeAt(i) === 10) lineNum++;
      charIndex = i + 1;
    }
    textarea.setSelectionRange(charIndex, charIndex);
    textarea.focus();
    setCurrentLine(scrollToLine.line);
    updateLineHighlight(scrollToLine.line);
    updateVisibleRange();

    // Re-sync line numbers after React re-render
    requestAnimationFrame(() => {
      if (lineNumbersRef.current && textareaRef.current) {
        lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
      }
    });
  }, [scrollToLine, getLineHeight, updateLineHighlight, updateVisibleRange]);

  // Initialize visible range on mount and when content changes
  useLayoutEffect(() => {
    updateVisibleRange();
  }, [content, updateVisibleRange]);

  const lineCount = useMemo(() => {
    if (content.length === 0) return 1;
    let count = 1;
    for (let i = 0; i < content.length; i++) {
      if (content.charCodeAt(i) === 10) count++;
    }
    return count;
  }, [content]);

  const language = filePath && !isUntitled ? getLanguageFromPath(filePath) : 'text';
  const fileName = filePath
    ? isUntitled
      ? filePath.replace('__untitled__:', '')
      : filePath.split('/').pop() || filePath.split('\\').pop() || ''
    : '';
  const hasChanges = content !== originalContent;

  // Virtualized line numbers: only render visible lines
  const lineNumberElements = useMemo(() => {
    const lh = lineHeightRef.current || DEFAULT_LINE_HEIGHT;
    const start = Math.max(0, visibleLineRange.start);
    const end = Math.min(lineCount, visibleLineRange.end);
    const totalHeight = lineCount * lh;
    const topPad = start * lh;
    const bottomPad = Math.max(0, totalHeight - end * lh);

    const elements: React.ReactNode[] = [];
    elements.push(<div key="top-spacer" style={{ height: topPad, flexShrink: 0 }} />);
    for (let i = start; i < end; i++) {
      const lineNum = i + 1;
      elements.push(
        <div
          key={lineNum}
          className={`${styles.lineNumber} ${lineNum === currentLine ? styles.currentLine : ''}`}
        >
          {lineNum}
        </div>
      );
    }
    elements.push(<div key="bottom-spacer" style={{ height: bottomPad, flexShrink: 0 }} />);
    return elements;
  }, [visibleLineRange, lineCount, currentLine]);

  if (!filePath) {
    return (
      <div className={`${styles.textEditor} ${styles.empty}`}>
        <EmptyState
          icon="📝"
          title="选择文件开始编辑"
          description="从左侧文件树中选择一个文件来开始编辑"
          variant="file"
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`${styles.textEditor} ${styles.loading}`}>
        <LoadingSpinner message="正在加载文件内容..." size="medium" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${styles.textEditor} ${styles.error}`}>
        <ErrorState
          icon="⚠️"
          title="文件加载失败"
          message={error}
          size="medium"
          onRetry={() => {
            setError(null);
            setLoading(false);
            if (filePath) {
              const loadContent = async () => {
                setLoading(true);
                try {
                  const fileContent = await window.electron.ipcRenderer.invoke(
                    'read-file',
                    filePath
                  );
                  setContent(fileContent);
                  setOriginalContent(fileContent);
                  currentContentRef.current = fileContent;
                  currentOriginalContentRef.current = fileContent;
                } catch (error) {
                  console.error('Error reading file:', error);
                  setError(`无法读取文件: ${filePath}`);
                  setContent('');
                  setOriginalContent('');
                } finally {
                  setLoading(false);
                }
              };
              loadContent();
            }
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={`${styles.textEditor} ${showGrid ? styles.withGrid : ''} ${
        showRowLines ? styles.withRowLines : ''
      }`}
    >
      <div className={styles.fileHeader}>
        <div className={styles.fileInfo}>
          <span className={styles.fileName}>
            {fileName}
            {hasChanges && <span className={styles.unsavedIndicator}>*</span>}
          </span>
          <span className={styles.languageBadge}>{language}</span>
          {isLargeFile && <span className={styles.largeFileBadge}>大文件</span>}
          {!readOnly && (
            <span className={styles.autoSaveStatus}>
              {autoSaving
                ? '保存中...'
                : hasChanges
                  ? '未保存'
                  : lastSaved
                    ? `${lastSaved.toLocaleTimeString()}`
                    : '已保存'}
            </span>
          )}
        </div>
        <div className={styles.fileActions}>{settingsComponent}</div>
      </div>
      <div className={styles.editorContainer}>
        <div className={styles.lineNumbers} ref={lineNumbersRef}>
          {lineNumberElements}
        </div>
        <div className={styles.editorWrapper}>
          {isFocused && <div ref={lineHighlightRef} className={styles.lineHighlight} />}
          <textarea
            ref={textareaRef}
            className={`${styles.editorContent} language-${language}`}
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onSelect={updateCurrentLine}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            readOnly={readOnly}
            placeholder={readOnly ? '' : '开始输入您的内容...'}
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
};

export default TextEditor;
