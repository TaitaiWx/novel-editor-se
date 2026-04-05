import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { AiOutlineAlignLeft, AiOutlineEye } from 'react-icons/ai';
import { VscCode, VscListOrdered } from 'react-icons/vsc';
import type { EditorView } from '@codemirror/view';
import TabBar from '../TabBar';
import { formatShortcutLabel } from '../../utils/appSettings';
import type {
  CharacterHighlightPattern,
  EditorViewportSnapshot,
  InlineDiffRange,
} from '../TextEditor';
import SettingsButton from '../SettingsButton';
import LoadingSpinner from '../LoadingSpinner';
import styles from './styles.module.scss';

const TextEditor = lazy(() => import('../TextEditor'));
const ChangelogViewer = lazy(() => import('../ChangelogViewer'));
const ResourceViewer = lazy(() => import('../ResourceViewer'));
const BinaryContentViewer = lazy(() =>
  import('../ResourceViewer').then((module) => ({ default: module.BinaryContentViewer }))
);
const SpreadsheetViewer = lazy(() => import('../SpreadsheetViewer'));
const PresentationViewer = lazy(() => import('../PresentationViewer'));
const DocumentViewer = lazy(() => import('../DocumentViewer'));

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
  tabLabels?: Record<string, string>;
  specialTabContent?: Record<string, React.ReactNode>;
  focusMode?: boolean;
  reloadToken?: number;
  encoding?: string;
  showThousandCharMarkers?: boolean;
  thousandCharMarkerStep?: number;
  formatChapterShortcut?: string;
  characterHighlights?: CharacterHighlightPattern[];
  scrollToLine?: ScrollToLineRequest | null;
  transientHighlightLine?: TransientHighlightLineRequest | null;
  replaceLineRequest?: ReplaceLineRequest | null;
  inlineDiff?: InlineDiffRange | null;
  editorViewRef?: React.MutableRefObject<EditorView | null>;
  viewportSnapshots?: Record<string, EditorViewportSnapshot>;
  onViewportSnapshotChange?: (filePath: string, snapshot: EditorViewportSnapshot) => void;
  onTabSelect: (filePath: string) => void;
  onTabClose: (filePath: string) => void;
  onToggleThousandCharMarkers?: () => void;
  onFormatCurrentChapter?: () => void;
  onCloseOtherTabs?: (filePath: string) => void;
  onCloseAllTabs?: () => void;
  onCloseAllAndSave?: () => void;
  onContentChange?: (content: string) => void;
  onCursorChange?: (pos: CursorPosition) => void;
  onSaveUntitled?: (untitledPath: string, content: string) => void;
  onScrollProcessed?: () => void;
  onTransientHighlightProcessed?: () => void;
}

const PREVIEWABLE_EXTENSIONS = [
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.pdf',
  '.mp3',
  '.wav',
  '.ogg',
  '.m4a',
  '.aac',
  '.flac',
  '.mp4',
  '.mov',
];

const endsWithAny = (filePath: string | null, extensions: string[]) => {
  if (!filePath) return false;
  const lower = filePath.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
};

const isPreviewableResourcePath = (filePath: string | null) =>
  Boolean(
    filePath &&
      !filePath.startsWith('__untitled__:') &&
      endsWithAny(filePath, PREVIEWABLE_EXTENSIONS)
  );

const isTextBackedPreviewResourcePath = (filePath: string | null) =>
  Boolean(filePath && filePath.toLowerCase().endsWith('.svg'));

const isSpreadsheetPath = (filePath: string | null) =>
  Boolean(filePath && endsWithAny(filePath, ['.xlsx', '.xls']));

const isPresentationPath = (filePath: string | null) =>
  Boolean(filePath && endsWithAny(filePath, ['.pptx', '.ppt']));

const isDocumentPath = (filePath: string | null) =>
  Boolean(filePath && endsWithAny(filePath, ['.docx', '.doc']));

const contentFallback = (
  <div className={styles.contentPanelContent}>
    <LoadingSpinner />
  </div>
);

const ContentPanel: React.FC<ContentPanelProps> = ({
  openTabs,
  activeTab,
  tabLabels,
  specialTabContent,
  focusMode = false,
  reloadToken,
  encoding,
  showThousandCharMarkers = true,
  thousandCharMarkerStep = 1000,
  formatChapterShortcut,
  characterHighlights = [],
  scrollToLine,
  transientHighlightLine,
  replaceLineRequest,
  inlineDiff,
  editorViewRef,
  viewportSnapshots,
  onViewportSnapshotChange,
  onTabSelect,
  onTabClose,
  onToggleThousandCharMarkers,
  onFormatCurrentChapter,
  onCloseOtherTabs,
  onCloseAllTabs,
  onCloseAllAndSave,
  onContentChange,
  onCursorChange,
  onSaveUntitled,
  onScrollProcessed,
  onTransientHighlightProcessed,
}) => {
  const [wordWrap, setWordWrap] = useState(true);
  const [showLineNumbers, setShowLineNumbers] = useState(false);
  const [viewMode, setViewMode] = useState<'preview' | 'content'>('content');
  const specialContent = activeTab ? (specialTabContent?.[activeTab] ?? null) : null;

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
  const supportsEditorDisplayControls = useMemo(
    () =>
      Boolean(
        activeTab &&
          !specialContent &&
          !isChangelog &&
          !isSpreadsheet &&
          !isPresentation &&
          !isDocument &&
          (!isPreviewableResource || (isTextBackedPreviewResource && viewMode === 'content'))
      ),
    [
      activeTab,
      specialContent,
      isChangelog,
      isDocument,
      isPresentation,
      isPreviewableResource,
      isSpreadsheet,
      isTextBackedPreviewResource,
      viewMode,
    ]
  );
  const canFormatCurrentChapter = useMemo(
    () =>
      Boolean(
        activeTab &&
          !specialContent &&
          !isChangelog &&
          !isSpreadsheet &&
          !isPresentation &&
          !isDocument &&
          !isPreviewableResource
      ),
    [
      activeTab,
      specialContent,
      isChangelog,
      isDocument,
      isPresentation,
      isPreviewableResource,
      isSpreadsheet,
    ]
  );
  const canWrapText =
    !isPreviewableResource || (viewMode === 'content' && isTextBackedPreviewResource);

  useEffect(() => {
    setViewMode(isPreviewableResource ? 'preview' : 'content');
  }, [activeTab, isPreviewableResource]);

  useEffect(() => {
    if (
      !activeTab ||
      specialContent ||
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
    specialContent,
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
      items={[
        ...(supportsEditorDisplayControls
          ? [
              {
                key: 'line-numbers',
                label: '显示行号',
                icon: <VscListOrdered />,
                active: showLineNumbers,
                kind: 'toggle' as const,
                onClick: () => setShowLineNumbers((current) => !current),
              },
              {
                key: 'thousand-char-markers',
                label: '显示千字进度标记',
                active: showThousandCharMarkers,
                kind: 'toggle' as const,
                onClick: () => onToggleThousandCharMarkers?.(),
              },
            ]
          : []),
        ...(canFormatCurrentChapter && onFormatCurrentChapter
          ? [
              {
                key: 'format-current-chapter',
                label: '格式化当前章节',
                icon: <AiOutlineAlignLeft />,
                kind: 'action' as const,
                hint: formatChapterShortcut ? formatShortcutLabel(formatChapterShortcut) : undefined,
                onClick: onFormatCurrentChapter,
              },
            ]
          : []),
        ...(isPreviewableResource
          ? [
              {
                key: 'view-mode',
                label: viewMode === 'preview' ? '展示内容' : '展示预览',
                icon: viewMode === 'preview' ? <VscCode /> : <AiOutlineEye />,
                active: viewMode === 'content',
                kind: 'toggle' as const,
                onClick: () =>
                  setViewMode((currentMode) => (currentMode === 'preview' ? 'content' : 'preview')),
              },
            ]
          : []),
      ]}
    />
  );

  return (
    <div className={styles.contentPanel}>
      {!focusMode && (
        <TabBar
          tabs={openTabs}
          activeTab={activeTab}
          tabLabels={tabLabels}
          focusMode={focusMode}
          onTabSelect={onTabSelect}
          onTabClose={onTabClose}
          onCloseOtherTabs={onCloseOtherTabs}
          onCloseAllTabs={onCloseAllTabs}
          onCloseAllAndSave={onCloseAllAndSave}
        />
      )}
      <Suspense fallback={contentFallback}>
        <div className={styles.contentPanelContent}>
          {specialContent ? (
            <div className={styles.specialContentHost}>{specialContent}</div>
          ) : isChangelog ? (
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
              showLineNumbers={showLineNumbers}
              showThousandCharMarkers={showThousandCharMarkers}
              thousandCharMarkerStep={thousandCharMarkerStep}
              encoding={encoding}
              characterHighlights={characterHighlights}
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
      </Suspense>
    </div>
  );
};

export default ContentPanel;
