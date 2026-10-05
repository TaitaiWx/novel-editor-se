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
import styles from './App.module.scss';
import { CENTER_MIN, RIGHT_COLLAPSED_WIDTH } from '@/render/app/layoutConstants';
import { useRendererReadyReporting } from '@/render/hooks/useRendererReadyReporting';
import { useAppState } from '@/render/hooks/useAppState';
import { useWorkspaceDerivedState } from '@/render/hooks/useWorkspaceDerivedState';
import { useGeneratedMaterialCleanup } from '@/render/hooks/useGeneratedMaterialCleanup';
import { useStoryOrderSync } from '@/render/hooks/useStoryOrderSync';
import { useEditorSession } from '@/render/hooks/useEditorSession';
import { useAiSessionSync } from '@/render/hooks/useAiSessionSync';
import { usePaneLayout } from '@/render/hooks/usePaneLayout';
import { useTabActions } from '@/render/hooks/useTabActions';
import { useAppSettingsActions } from '@/render/hooks/useAppSettingsActions';
import { useProjectLoader } from '@/render/hooks/useProjectLoader';
import { useWorkspaceCreation } from '@/render/hooks/useWorkspaceCreation';
import { useWorkspaceEntityActions } from '@/render/hooks/useWorkspaceEntityActions';
import { useScopedContentReader } from '@/render/hooks/useScopedContentReader';
import { useFileOperations } from '@/render/hooks/useFileOperations';
import { useEditorInteractions } from '@/render/hooks/useEditorInteractions';
import { useGlobalShortcuts } from '@/render/hooks/useGlobalShortcuts';
import { useProjectExport } from '@/render/hooks/useProjectExport';
import { useAiWindowBridge } from '@/render/hooks/useAiWindowBridge';
import { useRightPanelPopout } from '@/render/hooks/useRightPanelPopout';
import { useSidebarClipboardShortcuts } from '@/render/hooks/useSidebarClipboardShortcuts';
import { useWorkspaceEntities } from '@/render/hooks/useWorkspaceEntities';
import { useLibraryGeneration } from '@/render/hooks/useLibraryGeneration';
import { useScopedAssistantGeneration } from '@/render/hooks/useScopedAssistantGeneration';
import { useContextMenuItems } from '@/render/hooks/useContextMenuItems';
import { useChapterMaterials } from '@/render/hooks/useChapterMaterials';
import { useScopedAssistantArtifacts } from '@/render/hooks/useScopedAssistantArtifacts';
import { useWorkspaceTabContent } from '@/render/hooks/useWorkspaceTabContent';
import { useOpenSettingsTabListener } from '@/render/hooks/useOpenSettingsTabListener';
import { useAssistantDialogHandlers } from '@/render/hooks/useAssistantDialogHandlers';

const VersionTimeline = lazy(() => import('./components/VersionTimeline'));
const DiffEditor = lazy(() => import('./components/DiffEditor'));
const RightPanel = lazy(() => import('./components/RightPanel'));

/**
 * 应用根组件（组合根）。
 *
 * 注意：下列 hook 的调用顺序与拆分前 App.tsx 中代码块的顺序保持一致，
 * 以保证各 useEffect 的执行 / 清理顺序不变。新增或调整 hook 时请保持该顺序。
 */
const App: React.FC = () => {
  // ─── 状态与派生状态 ─────────────────────────────────────────────
  useRendererReadyReporting();
  const state = useAppState();
  const derived = useWorkspaceDerivedState(state);

  // ─── 项目 / 会话同步（effect 顺序敏感） ─────────────────────────
  useGeneratedMaterialCleanup(state);
  const storyOrder = useStoryOrderSync(state);
  const editorSession = useEditorSession(state);
  useAiSessionSync(state);
  const layout = usePaneLayout(state);

  // ─── 动作（无 effect，仅 useCallback / useMemo） ───────────────
  const tabs = useTabActions(state);
  const settingsActions = useAppSettingsActions(state);
  const loader = useProjectLoader({ ...state, ...tabs });
  const creation = useWorkspaceCreation({ ...state, ...tabs, ...loader });
  const entityActions = useWorkspaceEntityActions({ ...state, ...tabs, ...creation });
  const contentReader = useScopedContentReader({ ...state, ...derived });
  const fileOps = useFileOperations({
    ...state,
    ...derived,
    ...tabs,
    ...editorSession,
    ...storyOrder,
    ...loader,
    ...contentReader,
  });
  const editor = useEditorInteractions({ ...state, ...layout, ...tabs, ...loader });

  // ─── 全局事件 / 跨窗口通信 ─────────────────────────────────────
  useGlobalShortcuts({ ...state, ...layout, ...tabs, ...loader, ...creation, ...editor });
  const projectExport = useProjectExport(state);
  useAiWindowBridge({ ...state, ...tabs });
  const { handlePopOutRightPanel } = useRightPanelPopout({ ...state, ...layout });
  useSidebarClipboardShortcuts({ ...state, ...fileOps });
  useWorkspaceEntities(state);

  // ─── AI 生成与右键菜单 ─────────────────────────────────────────
  const libraryGeneration = useLibraryGeneration({
    ...state,
    ...settingsActions,
    ...creation,
    ...loader,
    ...contentReader,
  });
  const scopedGeneration = useScopedAssistantGeneration({
    ...state,
    ...derived,
    ...settingsActions,
    ...creation,
    ...tabs,
    ...loader,
    ...contentReader,
  });
  const { contextMenuItems } = useContextMenuItems({
    ...state,
    ...loader,
    ...creation,
    ...entityActions,
    ...fileOps,
    ...projectExport,
    ...libraryGeneration,
    ...scopedGeneration,
  });

  // ─── 章节资料 / 助手上下文 / 工作区标签内容 ─────────────────────
  const { handleAddChapterMaterial, handleRemoveChapterMaterial } = useChapterMaterials({
    ...state,
    ...derived,
  });
  useScopedAssistantArtifacts({ ...state, ...derived });
  const { workspaceTabLabels, editorCharacterHighlights, specialTabContent } =
    useWorkspaceTabContent({
      ...state,
      ...derived,
      ...tabs,
      ...creation,
      ...entityActions,
      ...editor,
    });
  useOpenSettingsTabListener(state);
  const { handleAssistantApplyFix, handleAssistantPreviewDiff } = useAssistantDialogHandlers(state);

  // ─── 渲染所需字段 ──────────────────────────────────────────────
  const {
    files,
    folderPath,
    isLoading,
    openTabs,
    activeTab,
    initialViewportSnapshots,
    filePanelRevealRequest,
    sidebarCollapsed,
    rightPanelCollapsed,
    rightPanelPoppedOut,
    focusMode,
    editorContent,
    cursorPosition,
    encoding,
    setEncoding,
    contextMenu,
    clipboard,
    creatingType,
    scrollToLine,
    replaceLineRequest,
    transientHighlightLine,
    showShortcuts,
    setShowShortcuts,
    showSettingsCenter,
    setShowSettingsCenter,
    showAIAssistant,
    setShowAIAssistant,
    settingsCenterTab,
    setSettingsCenterTab,
    appSettings,
    workspaceCharacters,
    workspaceLoreEntries,
    workspaceProjectName,
    storyOrderMap,
    materialUsageMap,
    assistantScopedCharacters,
    assistantCharacterGenerationStatus,
    assistantScopedLoreEntries,
    assistantScopedMaterials,
    showVersionHistory,
    setShowVersionHistory,
    showKnowledgeExportDialog,
    setShowKnowledgeExportDialog,
    knowledgeExportOptions,
    setKnowledgeExportOptions,
    editorReloadToken,
    dbReady,
    inlineDiff,
    diffState,
    pendingApplyQueue,
    editorViewRef,
    leftPanelWidth,
    rightPanelWidth,
    setActiveTab,
    sidebarRef,
    appMainRef,
  } = state;
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
