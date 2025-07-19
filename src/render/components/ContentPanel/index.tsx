import React, { useState, useEffect, memo, useCallback } from 'react';
import PanelHeader from '../PanelHeader';
import TextEditor from '../TextEditor';
import SettingsButton from '../SettingsButton';
import styles from './styles.module.scss';

interface ContentPanelProps {
  selectedFile: string | null;
  onContentChange?: (content: string) => void;
  onCursorPositionChange?: (position: { line: number; column: number }) => void;
  currentLine?: number;
}

const ContentPanel: React.FC<ContentPanelProps> = memo(
  ({ selectedFile, onContentChange, onCursorPositionChange, currentLine }) => {
    const [showGrid, setShowGrid] = useState(false);
    const [showRowLines, setShowRowLines] = useState(false);
    const [isFileLoaded, setIsFileLoaded] = useState(false);

    // 文件切换时重置状态
    useEffect(() => {
      setIsFileLoaded(false);
    }, [selectedFile]);

    // 使用useCallback优化回调函数，避免不必要的重渲染
    const handleContentChange = useCallback(
      (newContent: string) => {
        // 如果是文件首次加载完成，标记为已加载
        if (!isFileLoaded && newContent) {
          setIsFileLoaded(true);
        }

        // 调用父组件的onContentChange
        onContentChange?.(newContent);
      },
      [isFileLoaded, onContentChange]
    );

    const getFileName = useCallback((filePath: string | null) => {
      if (!filePath) return '请选择文件';
      return filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
    }, []);

    // 使用useCallback优化切换函数
    const handleToggleGrid = useCallback((value: boolean) => {
      setShowGrid(value);
    }, []);

    const handleToggleRowLines = useCallback((value: boolean) => {
      setShowRowLines(value);
    }, []);

    return (
      <div className={styles.contentPanel}>
        <PanelHeader
          title={getFileName(selectedFile)}
          indicator={
            selectedFile
              ? {
                  text: '已选择',
                  type: 'success',
                }
              : undefined
          }
          settingsComponent={
            <SettingsButton
              showGrid={showGrid}
              onToggleGrid={handleToggleGrid}
              showRowLines={showRowLines}
              onToggleRowLines={handleToggleRowLines}
            />
          }
        />

        <div className={styles.contentPanelContent}>
          <TextEditor
            filePath={selectedFile}
            showGrid={showGrid}
            showRowLines={showRowLines}
            onContentChange={handleContentChange}
            onCursorPositionChange={onCursorPositionChange}
            currentLine={currentLine}
          />
        </div>
      </div>
    );
  }
);

// 添加显示名称以便调试
ContentPanel.displayName = 'ContentPanel';

export default ContentPanel;
