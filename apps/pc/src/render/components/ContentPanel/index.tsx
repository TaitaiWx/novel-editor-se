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
  reloadToken?: number;
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
  reloadToken,
  encoding,
  scrollToLine,
  onTabSelect,
  onTabClose,
  onContentChange,
  onCursorChange,
  onSaveUntitled,
}) => {
  const [wordWrap, setWordWrap] = useState(false);

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
          reloadToken={reloadToken}
          wordWrap={wordWrap}
          encoding={encoding}
          scrollToLine={scrollToLine}
          onContentChange={onContentChange}
          onCursorChange={onCursorChange}
          onSaveUntitled={onSaveUntitled}
          settingsComponent={<SettingsButton wordWrap={wordWrap} onToggleWordWrap={setWordWrap} />}
        />
      </div>
    </div>
  );
};

export default ContentPanel;
