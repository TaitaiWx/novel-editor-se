import React, { useEffect, useMemo, useState } from 'react';
import { AiOutlineEye } from 'react-icons/ai';
import { VscCode } from 'react-icons/vsc';
import { EditorView } from '@codemirror/view';
import TabBar from '../TabBar';
import TextEditor from '../TextEditor';
import type { EditorViewportSnapshot, InlineDiffRange } from '../TextEditor';
import ChangelogViewer from '../ChangelogViewer';
import SettingsButton from '../SettingsButton';
import ResourceViewer, {
  BinaryContentViewer,
  isPreviewableResourcePath,
  isTextBackedPreviewResourcePath,
} from '../ResourceViewer';
import SpreadsheetViewer, { isSpreadsheetPath } from '../SpreadsheetViewer';
import PresentationViewer, { isPresentationPath } from '../PresentationViewer';
import DocumentViewer, { isDocumentPath } from '../DocumentViewer';
import styles from './styles.module.scss';

interface CursorPosition {
  line: number;
  column: number;
}

interface ScrollToLineRequest {
  line: number;
  id: string;
}

interface ReplaceLineRequest {
  line: number;
  text: string;
  id: number;
}

interface TransientHighlightLineRequest {
  line: number;
  id: string;
}

interface ContentPanelProps {
  openTabs: string[];
  activeTab: string | null;
  focusMode?: boolean;
  reloadToken?: number;
  encoding?: string;
  scrollToLine?: ScrollToLineRequest | null;
  transientHighlightLine?: TransientHighlightLineRequest | null;
  replaceLineRequest?: ReplaceLineRequest | null;
  inlineDiff?: InlineDiffRange | null;
  editorViewRef?: React.MutableRefObject<EditorView | null>;
  viewportSnapshots?: Record<string, EditorViewportSnapshot>;
  onViewportSnapshotChange?: (filePath: string, snapshot: EditorViewportSnapshot) => void;
  onTabSelect: (filePath: string) => void;
  onTabClose: (filePath: string) => void;
  onCloseOtherTabs?: (filePath: string) => void;
  onCloseAllTabs?: () => void;
  onCloseAllAndSave?: () => void;
  onContentChange?: (content: string) => void;
  onCursorChange?: (pos: CursorPosition) => void;
  onSaveUntitled?: (untitledPath: string, content: string) => void;
  onScrollProcessed?: () => void;
  onTransientHighlightProcessed?: () => void;
}

const ContentPanel: React.FC<ContentPanelProps> = ({
  openTabs,
  activeTab,
  focusMode = false,
  reloadToken,
  encoding,
  scrollToLine,
  transientHighlightLine,
  replaceLineRequest,
  inlineDiff,
  editorViewRef,
  viewportSnapshots,
  onViewportSnapshotChange,
  onTabSelect,
  onTabClose,
  onCloseOtherTabs,
  onCloseAllTabs,
  onCloseAllAndSave,
  onContentChange,
  onCursorChange,
  onSaveUntitled,
  onScrollProcessed,
  onTransientHighlightProcessed,
}) => {
  const [wordWrap, setWordWrap] = useState(false);
  const [viewMode, setViewMode] = useState<'preview' | 'content'>('content');

  const isChangelog = useMemo(
    () => activeTab !== null && activeTab.startsWith('__changelog__:'),
    [activeTab]
  );
  const isPreviewableResource = useMemo(() => isPreviewableResourcePath(activeTab), [activeTab]);
  const isSpreadsheet = useMemo(() => isSpreadsheetPath(activeTab), [activeTab]);
  const isPresentation = useMemo(() => isPresentationPath(activeTab), [activeTab]);
  const isDocument = useMemo(() => isDocumentPath(activeTab), [activeTab]);
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
    if (
      !activeTab ||
      (isPreviewableResource && viewMode === 'preview') ||
      isSpreadsheet ||
      isPresentation ||
      isDocument ||
      isChangelog
    ) {
      onContentChange?.('');
    }
  }, [
    activeTab,
    isPreviewableResource,
    isSpreadsheet,
    isPresentation,
    isDocument,
    isChangelog,
    onContentChange,
    viewMode,
  ]);

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
      {!focusMode && (
        <TabBar
          tabs={openTabs}
          activeTab={activeTab}
          focusMode={focusMode}
          onTabSelect={onTabSelect}
          onTabClose={onTabClose}
          onCloseOtherTabs={onCloseOtherTabs}
          onCloseAllTabs={onCloseAllTabs}
          onCloseAllAndSave={onCloseAllAndSave}
        />
      )}
      <div className={styles.contentPanelContent}>
        {isChangelog ? (
          <ChangelogViewer />
        ) : isSpreadsheet ? (
          <SpreadsheetViewer filePath={activeTab} settingsComponent={settingsComponent} />
        ) : isPresentation ? (
          <PresentationViewer filePath={activeTab} settingsComponent={settingsComponent} />
        ) : isDocument ? (
          <DocumentViewer filePath={activeTab} settingsComponent={settingsComponent} />
        ) : isPreviewableResource && viewMode === 'preview' ? (
          <ResourceViewer filePath={activeTab} settingsComponent={settingsComponent} />
        ) : isPreviewableResource && !isTextBackedPreviewResource ? (
          <BinaryContentViewer filePath={activeTab} settingsComponent={settingsComponent} />
        ) : (
          <TextEditor
            filePath={activeTab}
            reloadToken={reloadToken}
            focusMode={focusMode}
            wordWrap={wordWrap}
            encoding={encoding}
            scrollToLine={scrollToLine}
            transientHighlightLine={transientHighlightLine}
            replaceLineRequest={replaceLineRequest}
            inlineDiff={inlineDiff}
            editorViewRef={editorViewRef}
            viewportSnapshots={viewportSnapshots}
            onViewportSnapshotChange={onViewportSnapshotChange}
            onContentChange={onContentChange}
            onCursorChange={onCursorChange}
            onSaveUntitled={onSaveUntitled}
            onScrollProcessed={onScrollProcessed}
            onTransientHighlightProcessed={onTransientHighlightProcessed}
            settingsComponent={settingsComponent}
          />
        )}
      </div>
    </div>
  );
};

export default ContentPanel;
