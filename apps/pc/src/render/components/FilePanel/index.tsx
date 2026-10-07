import React, { useState, useMemo, useCallback } from 'react';
import { AiOutlineFolderOpen } from 'react-icons/ai';
import LoadingSpinner from '../LoadingSpinner';
import EmptyState from '../EmptyState';
import FileTree from '../FileTree';
import { isImeComposing } from '../../utils/ime';
import {
  parseVolumeWorkspaceTab,
  splitWorkspaceFiles,
  type StoryOrderMap,
} from '../../utils/workspace';
import { buildStoryStructure, getSplitWorkspaceOptions } from '../../utils/storyStructure';
import type { FilePanelProps, ObjectContextMenuTarget } from './types';
import {
  countFiles,
  getFolderName,
  groupCharacters,
  handleRowActivationKey,
  resolvePasteTargetDir,
} from './utils';
import { useExternalFileDrop } from './hooks/useExternalFileDrop';
import { useStoryDragReorder } from './hooks/useStoryDragReorder';
import { useFilePanelSearch } from './hooks/useFilePanelSearch';
import { useFilePanelSearchResults } from './hooks/useFilePanelSearchResults';
import { useStoryTreeReveal } from './hooks/useStoryTreeReveal';
import { useWorkScopedNodes } from './hooks/useWorkScopedNodes';
import StoryTreeNode, { type StoryTreeContext } from './StoryTreeNode';
import SectionHeader from './SectionHeader';
import WorkspaceHeader, { buildCreateMenuItems } from './WorkspaceHeader';
import SearchBar from './SearchBar';
import SearchResults, { searchOptionId } from './SearchResults';
import CharacterSection from './CharacterSection';
import LoreSection from './LoreSection';
import WorkSwitcher from './WorkSwitcher';
import type { GrowthSheetSummary } from '../../utils/growthIndex';
import styles from './styles.module.scss';

export type { ObjectContextMenuTarget, ObjectContextMenuEvent } from './types';

// 默认值使用模块级常量：若每次渲染都生成新的 {}，storyDisplayNodes 的 memo 会失效，
// 进而让依赖它的展开 effect 反复 setState，造成无限重渲染。
const EMPTY_STORY_ORDER_MAP: StoryOrderMap = {};
const EMPTY_MATERIAL_USAGE_MAP: Record<string, string> = {};
const EMPTY_GROWTH_SHEETS: GrowthSheetSummary[] = [];

const FilePanel: React.FC<FilePanelProps> = React.memo(
  ({
    files,
    characters,
    characterGenerationStatus = null,
    loreEntries,
    materialUsageMap = EMPTY_MATERIAL_USAGE_MAP,
    projectName,
    selectedFile,
    activeWorkspaceTab,
    folderPath,
    projectLayout = null,
    workScope: workScopeProp,
    workScopeOptions: workScopeOptionsProp,
    onSelectWork,
    onCreateWork,
    storyOrderMap = EMPTY_STORY_ORDER_MAP,
    showFileSizes = true,
    quickOpenShortcut = 'Mod+P',
    revealFileRequest = null,
    isLoading,
    onFileSelect,
    onOpenCharacterNode,
    onOpenLoreNode,
    onOpenLore,
    onOpenCharacters,
    onDeleteCharacterNode,
    onDeleteLoreNode,
    onRenameCharacterNode,
    onRenameLoreNode,
    onRenameNode,
    onReorderStoryNode,
    onCreateVolume,
    onCreateChapter,
    onCreateDraftFolder,
    onCreateDraft,
    onCreateCharacter,
    onCreateLoreEntry,
    onCreateMaterialDirectory,
    growthIndex = null,
    onOpenGrowth,
    onRefresh,
    onOpenFolder,
    onOpenRecentFolder,
    onRenameProject,
    onImportFile,
    onCollapse,
    onContextMenu,
    onObjectContextMenu,
    onBackgroundContextMenu,
    onCopyFile,
    onPasteFiles,
    onDropFiles,
    creatingType,
    createTargetPath,
    onInlineCreate,
    onCancelCreate,
  }) => {
    const {
      searchQuery,
      setSearchQuery,
      showSearch,
      searchInputRef,
      handleToggleSearch,
      closeSearch,
    } = useFilePanelSearch(quickOpenShortcut);
    const [createMenuOpen, setCreateMenuOpen] = useState(false);
    const activeVolumePath = useMemo(
      () => parseVolumeWorkspaceTab(activeWorkspaceTab ?? null),
      [activeWorkspaceTab]
    );
    const shouldShowLoadingState = isLoading && !folderPath && files.length === 0;
    const isWorkspaceBusy = isLoading && Boolean(folderPath);

    const emitObjectContextMenu = useCallback(
      (event: React.MouseEvent, target: ObjectContextMenuTarget) => {
        event.preventDefault();
        event.stopPropagation();
        onObjectContextMenu?.({
          x: event.clientX,
          y: event.clientY,
          target,
        });
      },
      [onObjectContextMenu]
    );

    // ─── 拖放导入（VS Code 风格: Finder/Explorer → 文件面板） ─────────────
    const { isDragOver, handleDragOver, handleDragEnter, handleDragLeave, handleDrop } =
      useExternalFileDrop(onDropFiles);

    const folderName = useMemo(() => getFolderName(folderPath), [folderPath]);
    const workspaceLabel = projectName?.trim() || folderName;

    // 搜索不再过滤树：关键词非空时用独立的分组结果列表替换整棵树（见 SearchResults）
    const { storyNodes, materialNodes } = useMemo(
      () => splitWorkspaceFiles(files, getSplitWorkspaceOptions(projectLayout)),
      [files, projectLayout]
    );
    // 正文结构：项目文档 + 作品 / 卷 / 章（`ne init` 项目）或按名称推断的卷（普通文件夹）
    const storyStructure = useMemo(
      () => buildStoryStructure(storyNodes, folderPath, projectLayout, storyOrderMap),
      [folderPath, projectLayout, storyNodes, storyOrderMap]
    );
    const storyDisplayNodes = storyStructure.displayNodes;
    // 项目根目录的说明文档（欢迎使用.md 等）：头部「搜索」左侧的「项目说明」图标
    const projectDocNodes = storyStructure.projectDocs;
    const searching = searchQuery.trim().length > 0;

    // 当前作品：正文 / 资料只显示这部作品（搜索结果跨作品，见 useFilePanelSearchResults）
    const {
      workScope,
      workScopeOptions,
      isProjectMode,
      scopeToWork,
      scopedStoryNodes,
      scopedMaterialNodes,
      workChapterCounts,
      storyParentPath,
    } = useWorkScopedNodes({
      folderPath,
      projectLayout,
      workScope: workScopeProp,
      workScopeOptions: workScopeOptionsProp,
      storyDisplayNodes,
      materialNodes,
      searching: false,
    });
    const materialFileCount = useMemo(() => countFiles(scopedMaterialNodes), [scopedMaterialNodes]);
    const groupedCharacters = useMemo(() => groupCharacters(characters), [characters]);
    const growthSheets = growthIndex?.sheets ?? EMPTY_GROWTH_SHEETS;

    const {
      revealPath,
      collapsedSections,
      expandedStoryDirs,
      toggleSection,
      toggleStoryDirectory,
      triggerRevealPath,
      registerStoryNodeRef,
    } = useStoryTreeReveal({
      storyDisplayNodes,
      selectedFile,
      activeVolumePath,
      revealFileRequest,
      characterGenerationStatus,
      closeSearch,
    });

    // 搜索结果中选择文件时：关闭搜索、展开目录、选中文件
    const handleFileSelectFromSearch = useCallback(
      (filePath: string) => {
        if (searchQuery.trim()) {
          closeSearch();
          triggerRevealPath(filePath);
        }
        onFileSelect(filePath);
      },
      [searchQuery, closeSearch, onFileSelect, triggerRevealPath]
    );

    const handleOpenGrowthFromSearch = useCallback(
      (name: string) => onOpenGrowth?.(name),
      [onOpenGrowth]
    );
    const searchResults = useFilePanelSearchResults({
      query: searchQuery,
      rootPath: folderPath,
      projectDocs: projectDocNodes,
      storyNodes: storyDisplayNodes,
      materialNodes,
      characters,
      loreEntries,
      growthSheets,
      onOpenFile: handleFileSelectFromSearch,
      onOpenCharacter: onOpenCharacterNode,
      onOpenLore: onOpenLoreNode,
      onOpenGrowth: onOpenGrowth ? handleOpenGrowthFromSearch : undefined,
      closeSearch,
    });

    const handlePanelKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (isImeComposing(e)) return;
        const mod = e.ctrlKey || e.metaKey;
        if (!mod || !selectedFile) return;
        if (e.key === 'c') {
          e.preventDefault();
          e.stopPropagation();
          onCopyFile?.(selectedFile);
        } else if (e.key === 'v') {
          e.preventDefault();
          e.stopPropagation();
          // 文件粘贴到所在目录，目录粘贴到自身
          const targetDir = resolvePasteTargetDir(files, selectedFile);
          if (targetDir) onPasteFiles?.(targetDir);
        }
      },
      [selectedFile, files, onCopyFile, onPasteFiles]
    );

    const createMenuItems = buildCreateMenuItems({
      onCreateVolume,
      onCreateChapter,
      onCreateDraftFolder,
      onCreateDraft,
      onCreateCharacter,
      onCreateLoreEntry,
      onCreateMaterialDirectory,
      onImportFile,
    });

    const {
      storyDropTarget,
      handleStoryDragStart,
      handleStoryDragOver,
      handleStoryDrop,
      handleStoryDragEnd,
    } = useStoryDragReorder(onReorderStoryNode);

    const storyTree: StoryTreeContext = {
      expandedStoryDirs,
      revealPath,
      folderPath,
      activeWorkspaceTab,
      selectedFile,
      storyDropTarget,
      canReorder: Boolean(onReorderStoryNode),
      registerNodeRef: registerStoryNodeRef,
      onToggleDirectory: toggleStoryDirectory,
      onSelectFile: handleFileSelectFromSearch,
      onRenameNode,
      onRowKeyDown: handleRowActivationKey,
      onDragStart: handleStoryDragStart,
      onDragOver: handleStoryDragOver,
      onDrop: handleStoryDrop,
      onDragEnd: handleStoryDragEnd,
      onContextMenu,
      onObjectContextMenu: emitObjectContextMenu,
    };

    return (
      <div className={styles.filePanel} tabIndex={-1} onKeyDown={handlePanelKeyDown}>
        <div
          className={`${styles.filePanelContent}${isDragOver ? ` ${styles.dropTarget}` : ''}`}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onContextMenu={(e) => {
            e.preventDefault();
            onBackgroundContextMenu?.({ x: e.clientX, y: e.clientY });
          }}
        >
          {shouldShowLoadingState ? (
            <LoadingSpinner message="正在加载..." />
          ) : folderPath ? (
            <>
              <div className={styles.workspaceSection}>
                <WorkspaceHeader
                  workspaceLabel={workspaceLabel}
                  isWorkspaceBusy={isWorkspaceBusy}
                  isLoading={isLoading}
                  folderPath={folderPath}
                  showSearch={showSearch}
                  quickOpenShortcut={quickOpenShortcut}
                  createMenuItems={createMenuItems}
                  createMenuOpen={createMenuOpen}
                  onCreateMenuOpenChange={setCreateMenuOpen}
                  onRenameProject={onRenameProject}
                  projectDocs={projectDocNodes}
                  selectedFile={selectedFile}
                  onOpenProjectDoc={handleFileSelectFromSearch}
                  onProjectDocContextMenu={onContextMenu}
                  onOpenRecentFolder={onOpenRecentFolder}
                  onOpenFolder={onOpenFolder}
                  onToggleSearch={handleToggleSearch}
                  onCollapse={onCollapse}
                  onRefresh={onRefresh}
                  onContextMenu={(event) => emitObjectContextMenu(event, { kind: 'project-root' })}
                />
                {showSearch && (
                  <SearchBar
                    inputRef={searchInputRef}
                    value={searchQuery}
                    onChange={setSearchQuery}
                    onDismiss={closeSearch}
                    onNavigate={searchResults.navigate}
                    activeDescendant={
                      searchResults.activeKey ? searchOptionId(searchResults.activeKey) : undefined
                    }
                  />
                )}
                {isProjectMode && workScope && !searching && (
                  <WorkSwitcher
                    current={workScope}
                    options={workScopeOptions}
                    chapterCounts={workChapterCounts}
                    onSelect={(path) => onSelectWork?.(path)}
                    onCreate={onCreateWork}
                  />
                )}
                {searching ? (
                  <SearchResults
                    query={searchQuery}
                    groups={searchResults.groups}
                    activeKey={searchResults.activeKey}
                    contentSearching={searchResults.contentSearching}
                    contentTruncated={searchResults.contentTruncated}
                    contentError={searchResults.contentError}
                    onOpen={searchResults.openItem}
                    onHover={searchResults.setActiveKey}
                    onDismiss={closeSearch}
                  />
                ) : (
                  <div className={styles.workspaceTree}>
                    <section className={styles.objectSection} aria-label="正文">
                      <SectionHeader
                        title="正文"
                        count={
                          scopeToWork && workScope ? workChapterCounts[workScope.path] : undefined
                        }
                        singleClickOnly
                        onToggle={() => toggleSection('story')}
                        onContextMenu={(event) =>
                          emitObjectContextMenu(event, { kind: 'story-root' })
                        }
                      />
                      {!collapsedSections.story &&
                        (scopedStoryNodes.length > 0 ? (
                          <div className={styles.storyTree}>
                            {scopedStoryNodes.map((node) => (
                              <StoryTreeNode
                                key={node.path}
                                node={node}
                                level={0}
                                parentPath={
                                  node.storyKind === 'work'
                                    ? storyStructure.worksParentPath
                                    : storyParentPath
                                }
                                tree={storyTree}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className={styles.objectEmpty}>
                            {scopeToWork && workScope?.kind === 'work'
                              ? '这部作品还没有章节'
                              : '还没有正文文件'}
                          </div>
                        ))}
                    </section>

                    <CharacterSection
                      groups={groupedCharacters}
                      characters={characters}
                      growthSheets={growthSheets}
                      workPath={workScope?.path ?? folderPath}
                      filtering={false}
                      collapsed={collapsedSections.characters}
                      activeWorkspaceTab={activeWorkspaceTab}
                      generationStatus={characterGenerationStatus}
                      onToggle={() => toggleSection('characters')}
                      onOpenCharacter={onOpenCharacterNode}
                      onRenameCharacter={onRenameCharacterNode}
                      onDeleteCharacter={onDeleteCharacterNode}
                      onCreateCharacter={onCreateCharacter}
                      onOpenGrowth={onOpenGrowth}
                      onOpenOverview={onOpenCharacters}
                      onContextMenu={emitObjectContextMenu}
                    />

                    <LoreSection
                      entries={loreEntries}
                      workPath={workScope?.path ?? folderPath}
                      filtering={false}
                      collapsed={collapsedSections.lore}
                      activeWorkspaceTab={activeWorkspaceTab}
                      onToggle={() => toggleSection('lore')}
                      onOpenAll={() => onOpenLore?.()}
                      onOpen={onOpenLoreNode}
                      onRename={onRenameLoreNode}
                      onDelete={onDeleteLoreNode}
                      onCreate={onCreateLoreEntry}
                      onContextMenu={emitObjectContextMenu}
                    />

                    <section className={styles.objectSection} aria-label="资料">
                      <SectionHeader
                        title="资料"
                        icon={<AiOutlineFolderOpen />}
                        count={materialFileCount}
                        onToggle={() => toggleSection('materials')}
                        onContextMenu={(event) =>
                          emitObjectContextMenu(event, { kind: 'materials-root' })
                        }
                      />
                      {!collapsedSections.materials &&
                        (scopedMaterialNodes.length > 0 ? (
                          <div className={styles.supportMaterialsTree}>
                            <FileTree
                              files={scopedMaterialNodes}
                              fill={false}
                              showFileSizes={showFileSizes}
                              showExpandIcon={false}
                              baseIndent={8}
                              itemMetaMap={materialUsageMap}
                              onFileSelect={handleFileSelectFromSearch}
                              selectedFile={selectedFile}
                              onContextMenu={onContextMenu}
                              onBackgroundContextMenu={onBackgroundContextMenu}
                              creatingType={creatingType}
                              createTargetPath={createTargetPath}
                              onInlineCreate={onInlineCreate}
                              onCancelCreate={onCancelCreate}
                              revealPath={revealPath}
                              onRenameNode={onRenameNode}
                            />
                          </div>
                        ) : (
                          <div className={styles.objectEmpty}>
                            导入的图片、文档和其他素材会出现在这里
                          </div>
                        ))}
                    </section>
                  </div>
                )}
              </div>
            </>
          ) : (
            <EmptyState variant="folder" />
          )}
        </div>
      </div>
    );
  }
);

export default FilePanel;
