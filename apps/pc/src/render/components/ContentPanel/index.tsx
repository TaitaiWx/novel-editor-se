import React, { useEffect, useMemo, useState } from 'react';
import { AiOutlineEye } from 'react-icons/ai';
import { VscCode } from 'react-icons/vsc';
import TabBar from '../TabBar';
import TextEditor from '../TextEditor';
import ChangelogViewer from '../ChangelogViewer';
import SettingsButton from '../SettingsButton';
import ResourceViewer, {
  BinaryContentViewer,
  isPreviewableResourcePath,
  isTextBackedPreviewResourcePath,
} from '../ResourceViewer';
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
  const [viewMode, setViewMode] = useState<'preview' | 'content'>('content');

  const isChangelog = useMemo(
    () => activeTab !== null && activeTab.startsWith('__changelog__:'),
    [activeTab]
  );
  const isPreviewableResource = useMemo(() => isPreviewableResourcePath(activeTab), [activeTab]);
  const isTextBackedPreviewResource = useMemo(
    () => isTextBackedPreviewResourcePath(activeTab),
    [activeTab]
  );
  const canWrapText =
    !isPreviewableResource || (viewMode === 'content' && isTextBackedPreviewResource);

  useEffect(() => {
    setViewMode(isPreviewableResource ? 'preview' : 'content');
  }, [activeTab, isPreviewableResource]);

  useEffect(() => {
    if (!activeTab || (isPreviewableResource && viewMode === 'preview')) {
      onContentChange?.('');
    }
  }, [activeTab, isPreviewableResource, onContentChange, viewMode]);

  const settingsComponent = (
    <SettingsButton
      wordWrap={canWrapText ? wordWrap : undefined}
      onToggleWordWrap={canWrapText ? setWordWrap : undefined}
      items={
        isPreviewableResource
          ? [
              {
                key: 'view-mode',
                label: viewMode === 'preview' ? '展示内容' : '展示预览',
                icon: viewMode === 'preview' ? <VscCode /> : <AiOutlineEye />,
                active: viewMode === 'content',
                onClick: () =>
                  setViewMode((currentMode) => (currentMode === 'preview' ? 'content' : 'preview')),
              },
            ]
          : []
      }
    />
  );

  return (
    <div className={styles.contentPanel}>
      <TabBar
        tabs={openTabs}
        activeTab={activeTab}
        onTabSelect={onTabSelect}
        onTabClose={onTabClose}
      />
      <div className={styles.contentPanelContent}>
        {isChangelog ? (
          <ChangelogViewer />
        ) : isPreviewableResource && viewMode === 'preview' ? (
          <ResourceViewer filePath={activeTab} settingsComponent={settingsComponent} />
        ) : isPreviewableResource && !isTextBackedPreviewResource ? (
          <BinaryContentViewer filePath={activeTab} settingsComponent={settingsComponent} />
        ) : (
          <TextEditor
            filePath={activeTab}
            reloadToken={reloadToken}
            wordWrap={wordWrap}
            encoding={encoding}
            scrollToLine={scrollToLine}
            onContentChange={onContentChange}
            onCursorChange={onCursorChange}
            onSaveUntitled={onSaveUntitled}
            settingsComponent={settingsComponent}
          />
        )}
      </div>
    </div>
  );
};

export default ContentPanel;
