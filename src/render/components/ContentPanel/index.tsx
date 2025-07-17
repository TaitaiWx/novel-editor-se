import React, { useState, useEffect } from 'react';
import PanelHeader from '../PanelHeader';
import TextEditor from '../TextEditor';
import StatusBarV2 from '../StatusBar/StatusBarV2';
import SettingsButton from '../SettingsButton';
import styles from './styles.module.scss';

interface ContentPanelProps {
  selectedFile: string | null;
  onContentChange?: (content: string) => void;
  currentLine?: number;
}

const ContentPanel: React.FC<ContentPanelProps> = ({ selectedFile, onContentChange, currentLine }) => {
  const [showGrid, setShowGrid] = useState(false);
  const [showRowLines, setShowRowLines] = useState(false);
  const [content, setContent] = useState('');
  const [isFileLoaded, setIsFileLoaded] = useState(false);
  const [cursorPosition, setCursorPosition] = useState<{ line: number; column: number }>({
    line: 1,
    column: 1,
  });

  // 文件切换时重置状态
  useEffect(() => {
    if (selectedFile) {
      // 文件切换时标记为未加载完成，暂停统计
      setIsFileLoaded(false);
      setCursorPosition({ line: 1, column: 1 });
    } else {
      setContent('');
      setIsFileLoaded(false);
      setCursorPosition({ line: 1, column: 1 });
    }
  }, [selectedFile]);

  // 处理内容变化
  const handleContentChange = (newContent: string) => {
    setContent(newContent);
    
    // 如果是文件首次加载完成，标记为已加载
    if (!isFileLoaded && newContent) {
      setIsFileLoaded(true);
    }
    
    // 调用父组件的onContentChange
    if (onContentChange) {
      onContentChange(newContent);
    }
  };

  const getFileName = (filePath: string | null) => {
    if (!filePath) return '请选择文件';
    return filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
  };

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
            onToggleGrid={setShowGrid}
            showRowLines={showRowLines}
            onToggleRowLines={setShowRowLines}
          />
        }
      />

      <div className={styles.contentPanelContent}>
        <TextEditor
          filePath={selectedFile}
          showGrid={showGrid}
          showRowLines={showRowLines}
          onContentChange={handleContentChange}
          onCursorPositionChange={setCursorPosition}
          currentLine={currentLine}
        />
      </div>

      <StatusBarV2
        selectedFile={selectedFile}
        content={content}
        cursorPosition={cursorPosition}
      />
    </div>
  );
};

export default ContentPanel;
