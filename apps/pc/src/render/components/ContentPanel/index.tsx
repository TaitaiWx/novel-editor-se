import React, { useState } from 'react';
import TabBar from '../TabBar';
import TextEditor from '../TextEditor';
import SettingsButton from '../SettingsButton';
import styles from './styles.module.scss';

interface CursorPosition {
  line: number;
  column: number;
}

interface ScrollToLineRequest {
  line: number;
  id: number;
}

interface ContentPanelProps {
  openTabs: string[];
  activeTab: string | null;
  encoding?: string;
  scrollToLine?: ScrollToLineRequest | null;
  onTabSelect: (filePath: string) => void;
  onTabClose: (filePath: string) => void;
  onContentChange?: (content: string) => void;
  onCursorChange?: (pos: CursorPosition) => void;
  onSaveUntitled?: (untitledPath: string, content: string) => void;
}

const ContentPanel: React.FC<ContentPanelProps> = ({
  openTabs,
  activeTab,
  encoding,
  scrollToLine,
  onTabSelect,
  onTabClose,
  onContentChange,
  onCursorChange,
  onSaveUntitled,
}) => {
  const [showGrid, setShowGrid] = useState(false);
  const [showRowLines, setShowRowLines] = useState(false);

  return (
    <div className={styles.contentPanel}>
      <TabBar
        tabs={openTabs}
        activeTab={activeTab}
        onTabSelect={onTabSelect}
        onTabClose={onTabClose}
      />
      <div className={styles.contentPanelContent}>
        <TextEditor
          filePath={activeTab}
          showGrid={showGrid}
          showRowLines={showRowLines}
          encoding={encoding}
          scrollToLine={scrollToLine}
          onContentChange={onContentChange}
          onCursorChange={onCursorChange}
          onSaveUntitled={onSaveUntitled}
          settingsComponent={
            <SettingsButton
              showGrid={showGrid}
              onToggleGrid={setShowGrid}
              showRowLines={showRowLines}
              onToggleRowLines={setShowRowLines}
            />
          }
        />
      </div>
    </div>
  );
};

export default ContentPanel;
