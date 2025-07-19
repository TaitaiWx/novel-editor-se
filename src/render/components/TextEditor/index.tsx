import React, { useEffect, useState, useRef, useCallback } from 'react';
import LoadingSpinner from '../LoadingSpinner';
import ErrorState from '../ErrorState';
import EmptyState from '../EmptyState';
import styles from './styles.module.scss';
import { useFileEventEmitter } from '../../hooks/useFileEvents';

interface TextEditorProps {
  filePath: string | null;
  showGrid?: boolean;
  showRowLines?: boolean;
  readOnly?: boolean;
  onContentChange?: (content: string) => void;
  currentLine?: number;
  onCursorPositionChange?: (position: { line: number; column: number }) => void;
}

// 获取文件类型用于语法高亮类名
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
  onContentChange,
  currentLine,
  onCursorPositionChange,
}) => {
  const [content, setContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [internalCurrentLine, setInternalCurrentLine] = useState<number>(1);
  const [autoSaving, setAutoSaving] = useState<boolean>(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // 文件事件发射器
  const { emitFileLoading, emitFileLoaded, emitFileLoadError } = useFileEventEmitter();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 用于追踪当前编辑的文件，确保文件切换时正确保存
  const currentFilePathRef = useRef<string | null>(null);
  const currentContentRef = useRef<string>('');
  const currentOriginalContentRef = useRef<string>('');

  // 同步滚动
  const handleScroll = useCallback(() => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  // 更新当前行
  const updateCurrentLine = useCallback(() => {
    if (!textareaRef.current) return;

    const textarea = textareaRef.current;
    const cursorPosition = textarea.selectionStart;
    const textBeforeCursor = textarea.value.substring(0, cursorPosition);
    const lineNumber = textBeforeCursor.split('\n').length;
    
    // 计算列数
    const lineStart = textBeforeCursor.lastIndexOf('\n') + 1;
    const column = cursorPosition - lineStart + 1;
    
    setInternalCurrentLine(lineNumber);
    
    // 调用父组件的回调函数
    onCursorPositionChange?.({
      line: lineNumber,
      column: column,
    });
  }, [onCursorPositionChange]);

  // 自动保存文件
  const autoSaveFile = useCallback(async () => {
    const targetPath = currentFilePathRef.current;
    const targetContent = currentContentRef.current;

    if (!targetPath || readOnly || targetContent === currentOriginalContentRef.current) return;

    setAutoSaving(true);
    try {
      await window.electron.ipcRenderer.invoke('write-file', targetPath, targetContent);
      // 只有在保存的是当前文件时才更新状态
      if (targetPath === filePath) {
        setOriginalContent(targetContent);
        setLastSaved(new Date());
        
        // 触发保存完成事件，用于统计
        window.dispatchEvent(
          new CustomEvent('save', {
            detail: {
              filePath: targetPath,
              content: targetContent,
              timestamp: Date.now(),
            },
          })
        );
      }
    } catch (error) {
      console.error('Auto-save failed:', error);
      // 自动保存失败不显示错误，避免干扰用户
    } finally {
      setAutoSaving(false);
    }
  }, [filePath, readOnly]);

  // 处理内容变化
  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      currentContentRef.current = newContent;
      onContentChange?.(newContent);

      // 标记内容变化（用于有效时间计算）
      if (window.statsManager && newContent !== currentOriginalContentRef.current) {
        window.statsManager.markContentChange();
      }

      // 清除之前的自动保存定时器
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }

      // 设置新的自动保存定时器（2秒后保存）
      if (!readOnly) {
        autoSaveTimeoutRef.current = setTimeout(() => {
          autoSaveFile();
        }, 2000);
      }
    },
    [onContentChange, autoSaveFile, readOnly]
  );

  // 监听外部传入的currentLine变化
  useEffect(() => {
    if (currentLine && currentLine !== internalCurrentLine) {
      setInternalCurrentLine(currentLine);
    }
  }, [currentLine, internalCurrentLine]);

  // 快捷键处理（手动强制保存）
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Ctrl+S 或 Cmd+S 手动保存
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        autoSaveFile();
      }
    },
    [autoSaveFile]
  );

  // 组件卸载时清理定时器并保存文件
  useEffect(() => {
    return () => {
      // 清理自动保存定时器
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }

      // 组件卸载时保存当前文件（如果有变化）
      if (
        currentFilePathRef.current &&
        currentContentRef.current !== currentOriginalContentRef.current &&
        !readOnly
      ) {
        // 使用同步方式尝试保存，避免异步问题
        window.electron.ipcRenderer
          .invoke('write-file', currentFilePathRef.current, currentContentRef.current)
          .catch((error) => {
            console.error('Failed to save on unmount:', error);
          });
      }
    };
  }, [readOnly]);

  // 文件切换时的保存逻辑
  useEffect(() => {
    // 保存前一个文件的内容（如果有变化）
    const savePreviousFile = async () => {
      if (
        currentFilePathRef.current &&
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

    // 如果文件路径变化，先保存前一个文件
    if (filePath !== currentFilePathRef.current) {
      savePreviousFile();
    }

    // 更新当前文件信息
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
        currentFilePathRef.current = null;
        currentContentRef.current = '';
        currentOriginalContentRef.current = '';
        return;
      }

      // 发出文件开始加载事件
      emitFileLoading(filePath);
      
      setLoading(true);
      setError(null);

      try {
        const fileContent = await window.electron.ipcRenderer.invoke('read-file', filePath);
        setContent(fileContent);
        setOriginalContent(fileContent);
        setLastSaved(null);

        // 更新当前文件信息
        currentFilePathRef.current = filePath;
        currentContentRef.current = fileContent;
        currentOriginalContentRef.current = fileContent;
        
        // 发出文件加载完成事件
        emitFileLoaded(filePath, fileContent);
        
        // 通知父组件内容已加载
        onContentChange?.(fileContent);
      } catch (error) {
        console.error('Error reading file:', error);
        const errorMessage = `无法读取文件: ${filePath}`;
        setError(errorMessage);
        setContent('');
        setOriginalContent('');
        currentContentRef.current = '';
        currentOriginalContentRef.current = '';
        
        // 发出文件加载失败事件
        emitFileLoadError(filePath, errorMessage);
      } finally {
        setLoading(false);
      }
    };

    loadContent();
  }, [filePath, emitFileLoading, emitFileLoaded, emitFileLoadError, onContentChange]); // 添加 onContentChange 依赖项

  // 监听选择和滚动事件
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.addEventListener('scroll', handleScroll);
    textarea.addEventListener('click', updateCurrentLine);
    textarea.addEventListener('keyup', updateCurrentLine);
    textarea.addEventListener('focus', updateCurrentLine);

    return () => {
      textarea.removeEventListener('scroll', handleScroll);
      textarea.removeEventListener('click', updateCurrentLine);
      textarea.removeEventListener('keyup', updateCurrentLine);
      textarea.removeEventListener('focus', updateCurrentLine);
    };
  }, [handleScroll, updateCurrentLine]);

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
            // 触发重新加载
            if (filePath) {
              const loadContent = async () => {
                // 发出文件开始加载事件
                emitFileLoading(filePath);
                
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
                  
                  // 发出文件加载完成事件
                  emitFileLoaded(filePath, fileContent);
                  
                  // 通知父组件内容已加载
                  onContentChange?.(fileContent);
                } catch (error) {
                  console.error('Error reading file:', error);
                  const errorMessage = `无法读取文件: ${filePath}`;
                  setError(errorMessage);
                  setContent('');
                  setOriginalContent('');
                  
                  // 发出文件加载失败事件
                  emitFileLoadError(filePath, errorMessage);
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

  const language = getLanguageFromPath(filePath);
  const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || '';
  const lines = content.split('\n');
  const hasChanges = content !== originalContent;

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
          <span className={styles.filePath}>{filePath}</span>
        </div>
        <div className={styles.fileStats}>
          <span className={styles.languageBadge}>{language}</span>
          <span className={styles.lineCount}>{lines.length} 行</span>
          <span className={styles.currentLine}>第 {currentLine} 行</span>
          {!readOnly && (
            <span className={styles.autoSaveStatus}>
              {autoSaving
                ? '自动保存中...'
                : hasChanges
                  ? '有未保存更改'
                  : lastSaved
                    ? `已保存 ${lastSaved.toLocaleTimeString()}`
                    : '已保存'}
            </span>
          )}
        </div>
      </div>
      <div className={styles.editorContainer}>
        <div className={styles.lineNumbers} ref={lineNumbersRef}>
          {lines.map((_, index) => (
            <div
              key={index + 1}
              className={`${styles.lineNumber} ${
                index + 1 === currentLine ? styles.currentLine : ''
              }`}
            >
              {index + 1}
            </div>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          className={`${styles.editorContent} language-${language}`}
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onSelect={updateCurrentLine}
          readOnly={readOnly}
          placeholder={readOnly ? '' : '开始输入您的内容...'}
          spellCheck={false}
        />
      </div>
    </div>
  );
};

export default TextEditor;
