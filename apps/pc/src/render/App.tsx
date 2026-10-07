import React, { Suspense, lazy } from 'react';
import TitleBar from './components/TitleBar';
import FilePanel from './components/FilePanel';
import ContentPanel from './components/ContentPanel';
import { PanelResizer } from './components/PanelResizer';
import { AIAssistantDialog } from './components/RightPanel/AIAssistantDialog';
import { AiConfigProvider } from './components/RightPanel/useAiConfig';
import StatusBar from './components/StatusBar';
import ContextMenu from './components/ContextMenu';
import ShortcutsHelp from './components/ShortcutsHelp';
import AppSettingsCenter from './components/AppSettingsCenter';
import KnowledgeExportDialog from './components/KnowledgeExportDialog';
import AboutDialog from './components/AboutDialog';
import InspirationDialog from './components/InspirationDialog';
import InspirationButton from './components/InspirationButton';
import ContinuationButton from './components/ContinuationButton';
import EditorGrowthRecord from './components/EditorGrowthRecord';
import SceneVideoButton from './components/SceneVideoButton';
import ReferenceButton from './components/ReferenceButton';
import styles from './App.module.scss';
import { VscLayoutSidebarLeft, VscLayoutSidebarRight } from 'react-icons/vsc';
import { CENTER_MIN } from '@/render/app/layoutConstants';
import { useAppController } from '@/render/hooks/useAppController';
import { formatShortcutLabel } from '@/render/utils/appSettings';

const VersionTimeline = lazy(() => import('./components/VersionTimeline'));
const DiffEditor = lazy(() => import('./components/DiffEditor'));
const RightPanel = lazy(() => import('./components/RightPanel'));

/**
 * 应用根组件：只负责渲染。
 *
 * 全部 hook 的调用（及其顺序约束）集中在 useAppController 中，见该文件注释。
 */
const App: React.FC = () => {
  const {
    workspaceState,
    tabsState,
    layoutState,
    editorState,
    aiState,
    entitiesState,
    settingsState,
    uiState,
    derived,
    layout,
    tabs,
    editorSession,
    settingsActions,
    loader,
    creation,
    entityActions,
    growthEntry,
    workScopeApi,
    fileOps,
    editor,
    projectExport,
    handlePopOutRightPanel,
    contextMenuItems,
    assistantContext,
    workspaceTabLabels,
    editorCharacterHighlights,
    referenceFallback,
    referenceSource,
    specialTabContent,
    handleAssistantApplyFix,
    handleAssistantPreviewDiff,
    inspiration,
    editorAssistApi,
  } = useAppController();

  // ─── 渲染所需字段 ──────────────────────────────────────────────
  const { files, folderPath, projectLayout, isLoading, storyOrderMap, dbReady } = workspaceState;
  // 角色 / 设定 / 成长档案 / 资料跟随当前作品（普通文件夹为文件夹本身）
  const { workScopePath } = workspaceState;
  const { openTabs, activeTab, setActiveTab } = tabsState;
  const {
    sidebarCollapsed,
    rightPanelCollapsed,
    rightPanelPoppedOut,
    focusMode,
    leftPanelWidth,
    rightPanelWidth,
    sidebarRef,
    appMainRef,
  } = layoutState;
  const {
    editorContent,
    cursorPosition,
    encoding,
    setEncoding,
    scrollToLine,
    replaceLineRequest,
    transientHighlightLine,
    editorReloadToken,
    initialViewportSnapshots,
    editorViewRef,
  } = editorState;
  const { inlineDiff, diffState, pendingApplyQueue, assistantCharacterGenerationStatus } = aiState;
  const {
    workspaceCharacters,
    workspaceLoreEntries,
    workspaceProjectName,
    workspaceEntitiesPath,
    materialUsageMap,
  } = entitiesState;
  const { appSettings } = settingsState;
  const {
    contextMenu,
    clipboard,
    creatingType,
    filePanelRevealRequest,
    showShortcuts,
    setShowShortcuts,
    showSettingsCenter,
    setShowSettingsCenter,
    showAIAssistant,
    setShowAIAssistant,
    settingsCenterTab,
    setSettingsCenterTab,
    showVersionHistory,
    setShowVersionHistory,
    showKnowledgeExportDialog,
    setShowKnowledgeExportDialog,
    showAboutDialog,
    setShowAboutDialog,
    knowledgeExportOptions,
    setKnowledgeExportOptions,
  } = uiState;
  const {
    activeWorkspaceTab,
    activeUntitledVirtualContent,
    activeDocumentTab,
    currentAssistantScope,
    currentOutlineScope,
  } = derived;
  const {
    handleExpandSidebar,
    handleCollapseSidebar,
    handleLeftResizerMouseDown,
    handleRightResizerMouseDown,
    handleToggleRightPanel,
  } = layout;
  const {
    openFileInTab,
    closeTab,
    toggleFocusMode,
    handleCloseOtherTabs,
    handleCloseAllTabs,
    handleCloseAllAndSave,
  } = tabs;
  const { handleViewportSnapshotChange } = editorSession;
  const { handleAppSettingsChange, handleToggleThousandCharMarkers } = settingsActions;
  const { refreshCurrentFolder, handleOpenLocal, handleOpenFolderPath, handleOpenSampleData } =
    loader;
  const {
    handleCreateCharacter,
    handleCreateLoreEntry,
    handleCreateMaterialDirectory,
    handleCreateStoryItem,
    createTargetPath,
    handleInlineCreate,
    handleCancelCreate,
    handleImportFile,
  } = creation;
  const {
    handleFileSelect,
    handleOpenCharacterNode,
    handleOpenLoreNode,
    handleOpenLore,
    handleOpenCharacters,
    handleRenameProject,
    handleDeleteCharacterNode,
    handleRenameCharacterNode,
    handleDeleteLoreNode,
    handleRenameLoreNode,
  } = entityActions;
  const {
    handleRename,
    handleReorderStoryNode,
    handleCopyFile,
    handlePasteFiles,
    handleDropFiles,
    handleSaveUntitled,
  } = fileOps;
  const {
    handleFormatCurrentChapter,
    handleFileContextMenu,
    handleObjectContextMenu,
    handleBackgroundContextMenu,
    handleContentChange,
    handleCursorChange,
    handleCloseContextMenu,
    handleScrollProcessed,
    handleTransientHighlightProcessed,
    handleScrollToLine,
    handleOpenSourceLocation,
    handleReplaceLineText,
    handleDiffRequest,
    handleCloseDiff,
    handleAcceptFix,
    handleVersionRestore,
  } = editor;
  const { handleExportProject, handleConfirmKnowledgeExport } = projectExport;

  return (
    <AiConfigProvider>
      <div className={`${styles.app} ${focusMode ? styles.focusMode : ''}`}>
        {!focusMode && (
          <TitleBar
            focusMode={focusMode}
            userInitials="U"
            onToggleFocusMode={toggleFocusMode}
            onOpenSettings={() => {
              setSettingsCenterTab('general');
              setShowSettingsCenter(true);
            }}
            onAvatarClick={() => {
              setSettingsCenterTab('general');
              setShowSettingsCenter(true);
            }}
            onShowShortcuts={() => setShowShortcuts(true)}
            onShowAbout={() => setShowAboutDialog(true)}
            onOpenSampleData={handleOpenSampleData}
            onOpenAIAssistant={() => setShowAIAssistant(true)}
            onExportProject={handleExportProject}
          />
        )}

        <div
          className={`${styles.appMain} ${
            !focusMode && appSettings.general.showStatusBar ? styles.appMainWithStatusBar : ''
          }`}
          ref={appMainRef}
        >
          {/* 左侧文件面板卡片；折叠后只保留窗口背景上的展开按钮 */}
          {!focusMode && sidebarCollapsed && (
            <div className={styles.sideRail} data-pane="left-rail">
              <button
                className={styles.railToggle}
                onClick={handleExpandSidebar}
                title="展开侧边栏"
                aria-label="展开侧边栏"
              >
                <VscLayoutSidebarLeft />
              </button>
            </div>
          )}
          {!focusMode && !sidebarCollapsed && (
            <div
              ref={sidebarRef}
              className={styles.leftPanel}
              data-pane="left"
              style={{ width: leftPanelWidth }}
            >
              <FilePanel
                files={files}
                characters={workspaceCharacters}
                entitiesWorkPath={workspaceEntitiesPath}
                characterGenerationStatus={assistantCharacterGenerationStatus}
                loreEntries={workspaceLoreEntries}
                materialUsageMap={materialUsageMap}
                projectName={workspaceProjectName}
                selectedFile={activeDocumentTab}
                activeWorkspaceTab={activeWorkspaceTab}
                folderPath={folderPath}
                projectLayout={projectLayout}
                workScope={workScopeApi.workScope}
                workScopeOptions={workScopeApi.workScopeOptions}
                onSelectWork={workScopeApi.handleSelectWork}
                onCreateWork={() => void workScopeApi.handleCreateWork()}
                showFileSizes={appSettings.general.showFileSizes}
                quickOpenShortcut={appSettings.shortcuts.quickOpen}
                revealFileRequest={filePanelRevealRequest}
                isLoading={isLoading}
                onFileSelect={handleFileSelect}
                onOpenCharacterNode={handleOpenCharacterNode}
                onOpenLoreNode={handleOpenLoreNode}
                onOpenLore={handleOpenLore}
                onOpenCharacters={handleOpenCharacters}
                onDeleteCharacterNode={handleDeleteCharacterNode}
                onDeleteLoreNode={handleDeleteLoreNode}
                onRenameCharacterNode={handleRenameCharacterNode}
                onRenameLoreNode={handleRenameLoreNode}
                onRenameNode={handleRename}
                storyOrderMap={storyOrderMap}
                onReorderStoryNode={(sourcePath, targetPath, mode) =>
                  void handleReorderStoryNode(sourcePath, targetPath, mode)
                }
                onCreateVolume={() => void handleCreateStoryItem('volume')}
                onCreateChapter={() => void handleCreateStoryItem('chapter')}
                onCreateDraftFolder={() => void handleCreateStoryItem('draft-folder')}
                onCreateDraft={() => void handleCreateStoryItem('draft')}
                onCreateCharacter={() => void handleCreateCharacter()}
                onCreateLoreEntry={() => void handleCreateLoreEntry()}
                onCreateMaterialDirectory={() => void handleCreateMaterialDirectory()}
                growthIndex={growthEntry.growthIndex}
                onOpenGrowth={growthEntry.handleOpenGrowth}
                onCreateGrowthSheet={() => void growthEntry.handleCreateGrowthSheet()}
                onRefresh={refreshCurrentFolder}
                onOpenFolder={handleOpenLocal}
                onOpenRecentFolder={(path) => void handleOpenFolderPath(path)}
                onRenameProject={(name) => void handleRenameProject(name)}
                onImportFile={handleImportFile}
                onCollapse={handleCollapseSidebar}
                onContextMenu={handleFileContextMenu}
                onObjectContextMenu={handleObjectContextMenu}
                onBackgroundContextMenu={handleBackgroundContextMenu}
                onCopyFile={handleCopyFile}
                onPasteFiles={handlePasteFiles}
                onDropFiles={handleDropFiles}
                hasClipboard={clipboard.length > 0}
                creatingType={creatingType}
                createTargetPath={createTargetPath}
                onInlineCreate={handleInlineCreate}
                onCancelCreate={handleCancelCreate}
              />
            </div>
          )}

          {/* 左侧拖拽把手（占据左卡片与中间卡片之间的间距） */}
          {!focusMode && !sidebarCollapsed && (
            <PanelResizer onMouseDown={handleLeftResizerMouseDown} label="调整左侧面板宽度" />
          )}

          {/* 中间内容卡片 */}
          <div className={styles.centerPanel} data-pane="center" style={{ minWidth: CENTER_MIN }}>
            {diffState ? (
              <Suspense fallback={<div className={styles.lazyFallback}>正在加载差异编辑器...</div>}>
                <DiffEditor
                  original={diffState.original}
                  modified={diffState.modified}
                  originalLabel={diffState.originalLabel}
                  modifiedLabel={diffState.modifiedLabel}
                  onClose={handleCloseDiff}
                  onAccept={pendingApplyQueue.length > 0 ? handleAcceptFix : undefined}
                />
              </Suspense>
            ) : (
              <ContentPanel
                openTabs={openTabs}
                activeTab={activeTab}
                virtualContent={activeUntitledVirtualContent}
                tabLabels={workspaceTabLabels}
                specialTabContent={specialTabContent}
                focusMode={focusMode}
                reloadToken={editorReloadToken}
                encoding={encoding}
                showThousandCharMarkers={appSettings.general.showThousandCharMarkers}
                thousandCharMarkerStep={appSettings.general.thousandCharMarkerStep}
                formatChapterShortcut={appSettings.shortcuts.formatChapter}
                characterHighlights={editorCharacterHighlights}
                scrollToLine={scrollToLine}
                transientHighlightLine={transientHighlightLine}
                replaceLineRequest={replaceLineRequest}
                inlineDiff={inlineDiff}
                editorViewRef={editorViewRef}
                editorAssist={editorAssistApi.editorAssist}
                editorHeaderActions={
                  <>
                    <InspirationButton shortcut={appSettings.shortcuts.openInspiration} />
                    <ContinuationButton editorViewRef={editorViewRef} />
                    <SceneVideoButton shortcutLabel={formatShortcutLabel('Mod+Alt+V')} />
                    <ReferenceButton fallback={referenceFallback} source={referenceSource} />
                  </>
                }
                emptyStateActions={
                  <InspirationButton
                    variant="primary"
                    shortcut={appSettings.shortcuts.openInspiration}
                  />
                }
                viewportSnapshots={initialViewportSnapshots}
                onViewportSnapshotChange={handleViewportSnapshotChange}
                onTabSelect={(filePath) => {
                  setActiveTab(filePath);
                  workScopeApi.revealWorkForDocument(filePath);
                }}
                onTabClose={closeTab}
                onToggleThousandCharMarkers={handleToggleThousandCharMarkers}
                onFormatCurrentChapter={handleFormatCurrentChapter}
                onCloseOtherTabs={handleCloseOtherTabs}
                onCloseAllTabs={handleCloseAllTabs}
                onCloseAllAndSave={handleCloseAllAndSave}
                onContentChange={handleContentChange}
                onCursorChange={handleCursorChange}
                onSaveUntitled={handleSaveUntitled}
                onScrollProcessed={handleScrollProcessed}
                onTransientHighlightProcessed={handleTransientHighlightProcessed}
              />
            )}
            {focusMode && (
              <button
                className={styles.exitFocusBtn}
                onClick={toggleFocusMode}
                title="退出聚焦模式 (Esc / F11)"
              >
                退出聚焦
              </button>
            )}
          </div>

          {/* 右侧拖拽把手 + 右侧信息面板卡片；折叠后只保留展开按钮 */}
          {!focusMode && !rightPanelPoppedOut && rightPanelCollapsed && (
            <div className={`${styles.sideRail} ${styles.sideRailRight}`} data-pane="right-rail">
              <button
                className={styles.railToggle}
                onClick={handleToggleRightPanel}
                title="展开辅助面板"
                aria-label="展开辅助面板"
              >
                <VscLayoutSidebarRight />
              </button>
            </div>
          )}
          {!focusMode && !rightPanelPoppedOut && !rightPanelCollapsed && (
            <>
              <PanelResizer onMouseDown={handleRightResizerMouseDown} label="调整右侧面板宽度" />
              <div
                className={styles.rightPanelWrapper}
                data-pane="right"
                style={{ width: rightPanelWidth }}
              >
                <Suspense fallback={<div className={styles.lazyFallback}>正在加载辅助面板...</div>}>
                  <RightPanel
                    content={activeDocumentTab ? editorContent : ''}
                    collapsed={rightPanelCollapsed}
                    enabled={Boolean(folderPath)}
                    scopeKind={currentAssistantScope?.kind}
                    scopeLabel={currentAssistantScope?.label}
                    outlineScope={currentOutlineScope}
                    onToggle={handleToggleRightPanel}
                    onPopOut={handlePopOutRightPanel}
                    onScrollToLine={handleScrollToLine}
                    onOpenSourceLocation={handleOpenSourceLocation}
                    onReplaceLineText={handleReplaceLineText}
                    folderPath={workScopePath}
                    dbReady={dbReady}
                  />
                </Suspense>
              </div>
            </>
          )}
        </div>

        {/* 版本历史模态框 */}
        {showVersionHistory && (
          <Suspense
            fallback={
              <div className={styles.lazyOverlay}>
                <div className={styles.lazyModal}>正在加载版本历史...</div>
              </div>
            }
          >
            <VersionTimeline
              visible={showVersionHistory}
              onClose={() => setShowVersionHistory(false)}
              folderPath={folderPath}
              filePath={activeDocumentTab}
              onDiffRequest={handleDiffRequest}
              onRestoreFile={handleVersionRestore}
            />
          </Suspense>
        )}

        {/* 状态栏 */}
        {!focusMode && appSettings.general.showStatusBar && (
          <StatusBar
            content={editorContent}
            currentLine={cursorPosition.line}
            currentColumn={cursorPosition.column}
            filePath={activeDocumentTab}
            encoding={encoding}
            onEncodingChange={setEncoding}
            folderPath={folderPath}
            onToggleVersionHistory={() => setShowVersionHistory((p) => !p)}
          />
        )}

        {/* 右键菜单 */}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextMenuItems}
            onClose={handleCloseContextMenu}
          />
        )}

        {/* 快捷键帮助 */}
        <ShortcutsHelp
          visible={showShortcuts}
          onClose={() => setShowShortcuts(false)}
          onOpenSampleData={handleOpenSampleData}
        />

        <AppSettingsCenter
          visible={showSettingsCenter}
          onClose={() => setShowSettingsCenter(false)}
          initialTab={settingsCenterTab}
          onSettingsChange={handleAppSettingsChange}
          onOpenShortcuts={() => setShowShortcuts(true)}
        />

        <AboutDialog visible={showAboutDialog} onClose={() => setShowAboutDialog(false)} />

        {showKnowledgeExportDialog && (
          <KnowledgeExportDialog
            options={knowledgeExportOptions}
            onOptionsChange={setKnowledgeExportOptions}
            onClose={() => setShowKnowledgeExportDialog(false)}
            onConfirm={() => void handleConfirmKnowledgeExport()}
          />
        )}

        <AIAssistantDialog
          visible={showAIAssistant}
          onClose={() => setShowAIAssistant(false)}
          folderPath={workScopePath}
          content={editorContent}
          filePath={activeDocumentTab}
          onApplyFix={handleAssistantApplyFix}
          onOpenFile={openFileInTab}
          onPreviewDiff={handleAssistantPreviewDiff}
          context={assistantContext}
          onOpenSettings={() => {
            setShowAIAssistant(false);
            setSettingsCenterTab('ai');
            setShowSettingsCenter(true);
          }}
        />

        <EditorGrowthRecord
          request={editorAssistApi.growthRecord}
          workPath={editorAssistApi.assistWorkPath}
          chapter={growthEntry.growthChapter}
          onClose={editorAssistApi.closeGrowthRecord}
        />

        <InspirationDialog
          visible={inspiration.inspirationVisible}
          onClose={inspiration.closeInspiration}
          initialCardId={inspiration.inspirationCardId}
          folderPath={workScopePath}
          dbReady={dbReady}
          content={activeDocumentTab ? editorContent : ''}
          onInsert={inspiration.handleInsertInspiration}
        />
      </div>
    </AiConfigProvider>
  );
};

export default App;
