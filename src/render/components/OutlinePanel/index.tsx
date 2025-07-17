import React, { useState, useEffect, useCallback } from 'react';
import OutlineHeader from './OutlineHeader';
import OutlineTree from '../OutlineTree';
import styles from './styles.module.scss';
import { debounce } from '../../utils/debounce';
import type { OutlineItem } from '../../parsers/types';

interface OutlinePanelProps {
  selectedFile: string | null;
  documentContent: string;
  currentLine: number;
  onNavigateToLine: (lineNumber: number) => void;
  isVisible?: boolean;
  onToggleVisibility?: () => void;
  isCollapsed?: boolean;
  onCollapseChange?: (collapsed: boolean) => void;
}

const OutlinePanel: React.FC<OutlinePanelProps> = ({
  selectedFile,
  documentContent,
  currentLine,
  onNavigateToLine,
  isVisible = true,
  onToggleVisibility,
  isCollapsed = false,
  onCollapseChange,
}) => {
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 防抖的解析函数
  const debouncedParse = useCallback(
    debounce(async (content: string, filePath: string) => {
      try {
        setIsLoading(true);
        setError(null);
        
        const { ParserFactory } = await import('../../parsers');
        const parser = ParserFactory.getParser(filePath);
        const result = parser.parse(content);
        
        setOutline(result);
      } catch (err) {
        console.error('Failed to parse document:', err);
        setError('解析文档失败');
        setOutline([]);
      } finally {
        setIsLoading(false);
      }
    }, 300),
    []
  );

  // 当文档内容变化时，重新解析大纲
  useEffect(() => {
    if (!selectedFile || !documentContent) {
      setOutline([]);
      return;
    }

    debouncedParse(documentContent, selectedFile);
  }, [selectedFile, documentContent, debouncedParse]);

  const getFileName = (filePath: string | null) => {
    if (!filePath) return '文档大纲';
    return filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
  };

  if (isCollapsed) {
    return (
      <div className={styles.outlinePanelCollapsed}>
        <button
          className={styles.expandButton}
          onClick={() => onCollapseChange?.(false)}
          title="展开大纲面板"
        >
          📋
        </button>
      </div>
    );
  }

  return (
    <div className={styles.outlinePanel}>
      <OutlineHeader
        title={getFileName(selectedFile)}
        itemCount={outline.length}
        onCollapse={() => onCollapseChange?.(true)}
        onClose={onToggleVisibility}
      />
      
      <div className={styles.outlinePanelContent}>
        {isLoading ? (
          <div className={styles.loadingState}>
            <div className={styles.loadingSpinner}>⏳</div>
            <div className={styles.loadingText}>正在解析文档...</div>
          </div>
        ) : error ? (
          <div className={styles.errorState}>
            <div className={styles.errorIcon}>❌</div>
            <div className={styles.errorText}>{error}</div>
          </div>
        ) : selectedFile && documentContent ? (
          <OutlineTree
            items={outline}
            currentLine={currentLine}
            onNavigateToLine={onNavigateToLine}
            documentContent={documentContent}
            filePath={selectedFile}
          />
        ) : (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>📋</div>
            <div className={styles.emptyTitle}>选择文件查看大纲</div>
            <div className={styles.emptyDescription}>
              从左侧选择一个文件来生成文档大纲
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OutlinePanel; 