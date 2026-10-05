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
import styles from './App.module.scss';
import { CENTER_MIN, RIGHT_COLLAPSED_WIDTH } from '@/render/app/layoutConstants';
import { useAppController } from '@/render/hooks/useAppController';

/** 更新日志虚拟标签 */
const CHANGELOG_TAB = '__changelog__:更新日志';

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
    fileOps,
    editor,
    projectExport,
    handlePopOutRightPanel,
    contextMenuItems,
    handleAddChapterMaterial,
    handleRemoveChapterMaterial,
    workspaceTabLabels,
    editorCharacterHighlights,
    specialTabContent,
    handleAssistantApplyFix,
    handleAssistantPreviewDiff,
  } = useAppController();

  // ─── 渲染所需字段 ──────────────────────────────────────────────
  const { files, folderPath, isLoading, storyOrderMap, dbReady } = workspaceState;
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
  const {
    inlineDiff,
    diffState,
    pendingApplyQueue,
    assistantScopedCharacters,
    assistantCharacterGenerationStatus,
    assistantScopedLoreEntries,
    assistantScopedMaterials,
  } = aiState;
  const { workspaceCharacters, workspaceLoreEntries, workspaceProjectName, materialUsageMap } =
    entitiesState;
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
    materialFiles,
    linkedMaterialFiles,
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
  const { refreshCurrentFolder, handleOpenLocal, handleOpenSampleData } = loader;
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

        <div className={styles.appMain} ref={appMainRef}>
          {/* 左侧文件面板 */}
          {!focusMode && (
            <div
              ref={sidebarRef}
              className={`${styles.leftPanel} ${sidebarCollapsed ? styles.leftPanelCollapsed : ''}`}
              style={sidebarCollapsed ? undefined : { width: leftPanelWidth }}
            >
              {sidebarCollapsed ? (
                <button
                  className={styles.sidebarToggle}
                  onClick={handleExpandSidebar}
                  title="展开侧边栏"
                >
                  ▶
                </button>
              ) : (
                <FilePanel
                  files={files}
                  characters={workspaceCharacters}
                  characterGenerationStatus={assistantCharacterGenerationStatus}
                  loreEntries={workspaceLoreEntries}
                  materialUsageMap={materialUsageMap}
                  projectName={workspaceProjectName}
                  selectedFile={activeDocumentTab}
                  activeWorkspaceTab={activeWorkspaceTab}
                  folderPath={folderPath}
                  showFileSizes={appSettings.general.showFileSizes}
                  quickOpenShortcut={appSettings.shortcuts.quickOpen}
                  revealFileRequest={filePanelRevealRequest}
                  isLoading={isLoading}
                  onFileSelect={handleFileSelect}
                  onOpenCharacterNode={handleOpenCharacterNode}
                  onOpenLoreNode={handleOpenLoreNode}
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
                  onRenameProject={() => void handleRenameProject()}
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
              )}
            </div>
          )}

          {/* 左侧拖拽把手 */}
          {!focusMode && !sidebarCollapsed && (
            <PanelResizer onMouseDown={handleLeftResizerMouseDown} />
          )}

          {/* 中间内容面板 */}
          <div className={styles.centerPanel} style={{ minWidth: CENTER_MIN }}>
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
                viewportSnapshots={initialViewportSnapshots}
                onViewportSnapshotChange={handleViewportSnapshotChange}
                onTabSelect={setActiveTab}
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
                title="退出聚焦模式 (F11)"
              >
                退出聚焦
              </button>
            )}
          </div>

          {/* 右侧拖拽把手 + 右侧信息面板 */}
          {!focusMode && !rightPanelPoppedOut && (
            <>
              {!rightPanelCollapsed && <PanelResizer onMouseDown={handleRightResizerMouseDown} />}
              <div
                className={styles.rightPanelWrapper}
                style={
                  rightPanelCollapsed
                    ? { width: RIGHT_COLLAPSED_WIDTH }
                    : { width: rightPanelWidth }
                }
              >
                {rightPanelCollapsed ? (
                  <button
                    className={styles.rightPanelToggle}
                    onClick={handleToggleRightPanel}
                    title="展开辅助面板"
                  >
                    ◀
                  </button>
                ) : (
                  <Suspense
                    fallback={<div className={styles.lazyFallback}>正在加载辅助面板...</div>}
                  >
                    <RightPanel
                      content={activeDocumentTab ? editorContent : ''}
                      collapsed={rightPanelCollapsed}
                      enabled={Boolean(folderPath)}
                      scopeKind={currentAssistantScope?.kind}
                      scopeLabel={currentAssistantScope?.label}
                      outlineScope={currentOutlineScope}
                      materialFiles={materialFiles.map((item) => ({
                        path: item.path,
                        name: item.name,
                      }))}
                      linkedMaterialPaths={linkedMaterialFiles.map((item) => item.path)}
                      scopedCharacterGenerationStatus={assistantCharacterGenerationStatus}
                      scopedCharacters={assistantScopedCharacters}
                      scopedLoreEntries={assistantScopedLoreEntries}
                      scopedMaterials={assistantScopedMaterials}
                      onToggle={handleToggleRightPanel}
                      onPopOut={handlePopOutRightPanel}
                      onOpenMaterial={openFileInTab}
                      onAddMaterial={handleAddChapterMaterial}
                      onRemoveMaterial={handleRemoveChapterMaterial}
                      onScrollToLine={handleScrollToLine}
                      onReplaceLineText={handleReplaceLineText}
                      folderPath={folderPath}
                      dbReady={dbReady}
                      currentLine={cursorPosition.line}
                    />
                  </Suspense>
                )}
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
          onOpenChangelog={() => openFileInTab(CHANGELOG_TAB)}
        />

        <AboutDialog
          visible={showAboutDialog}
          onClose={() => setShowAboutDialog(false)}
          onOpenChangelog={() => openFileInTab(CHANGELOG_TAB)}
          onOpenUpdateSettings={() => {
            setSettingsCenterTab('about');
            setShowSettingsCenter(true);
          }}
        />

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
          folderPath={folderPath}
          content={editorContent}
          filePath={activeDocumentTab}
          onApplyFix={handleAssistantApplyFix}
          onOpenFile={openFileInTab}
          onPreviewDiff={handleAssistantPreviewDiff}
          onOpenSettings={() => {
            setShowAIAssistant(false);
            setSettingsCenterTab('ai');
            setShowSettingsCenter(true);
          }}
        />
      </div>
    </AiConfigProvider>
  );
};

export default App;
