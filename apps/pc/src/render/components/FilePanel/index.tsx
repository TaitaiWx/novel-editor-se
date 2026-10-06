import React, { useState, useMemo, useCallback } from 'react';
import { AiOutlineFolderOpen, AiOutlineUser, AiOutlineFolder } from 'react-icons/ai';
import LoadingSpinner from '../LoadingSpinner';
import EmptyState from '../EmptyState';
import FileTree from '../FileTree';
import { isImeComposing } from '../../utils/ime';
import {
  createCharacterWorkspaceTab,
  createLoreWorkspaceTab,
  parseVolumeWorkspaceTab,
  splitWorkspaceFiles,
  WORKSPACE_TAB_CHARACTERS,
  WORKSPACE_TAB_LORE,
  type StoryOrderMap,
} from '../../utils/workspace';
import { buildStoryStructure, getSplitWorkspaceOptions } from '../../utils/storyStructure';
import type { FilePanelProps, ObjectContextMenuTarget } from './types';
import {
  countFiles,
  filterCharacters,
  filterGrowthSheets,
  filterLoreEntries,
  filterTree,
  getCharacterCategoryLabel,
  getFolderName,
  groupCharacters,
  handleRowActivationKey,
  resolvePasteTargetDir,
  shouldShowCharactersSection,
  shouldShowGrowthSection,
  shouldShowLoreSection,
} from './utils';
import { useExternalFileDrop } from './hooks/useExternalFileDrop';
import { useStoryDragReorder } from './hooks/useStoryDragReorder';
import { useFilePanelSearch } from './hooks/useFilePanelSearch';
import { useStoryTreeReveal } from './hooks/useStoryTreeReveal';
import { useWorkScopedNodes } from './hooks/useWorkScopedNodes';
import StoryTreeNode, { type StoryTreeContext } from './StoryTreeNode';
import SectionHeader from './SectionHeader';
import ObjectItemRow from './ObjectItemRow';
import WorkspaceHeader, { buildCreateMenuItems } from './WorkspaceHeader';
import SearchBar from './SearchBar';
import CharacterGenerationHint from './CharacterGenerationHint';
import GrowthSection from './GrowthSection';
import WorkSwitcher from './WorkSwitcher';
import ProjectDocsButton from './ProjectDocsButton';
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
    onCreateGrowthSheet,
    onRefresh,
    onOpenFolder,
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

    const filteredFiles = useMemo(() => {
      if (!searchQuery.trim()) return files;
      return filterTree(files, searchQuery.trim());
    }, [files, searchQuery]);
    const { storyNodes, materialNodes } = useMemo(
      () => splitWorkspaceFiles(filteredFiles, getSplitWorkspaceOptions(projectLayout)),
      [filteredFiles, projectLayout]
    );
    // 正文结构：项目文档 + 作品 / 卷 / 章（`ne init` 项目）或按名称推断的卷（普通文件夹）
    const storyStructure = useMemo(
      () => buildStoryStructure(storyNodes, folderPath, projectLayout, storyOrderMap),
      [folderPath, projectLayout, storyNodes, storyOrderMap]
    );
    const storyDisplayNodes = storyStructure.displayNodes;
    // 项目根目录的说明文档（欢迎使用.md 等）：收在项目名旁的「项目说明」按钮里
    const projectDocNodes = storyStructure.projectDocs;
    const normalizedQuery = searchQuery.trim().toLowerCase();

    // 当前作品：正文 / 资料只显示这部作品（搜索时跨作品显示全部结果）
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
      searching: Boolean(normalizedQuery),
    });
    const materialFileCount = useMemo(() => countFiles(scopedMaterialNodes), [scopedMaterialNodes]);
    const filteredCharacters = useMemo(
      () => filterCharacters(characters, normalizedQuery),
      [characters, normalizedQuery]
    );
    const filteredLoreEntries = useMemo(
      () => filterLoreEntries(loreEntries, normalizedQuery),
      [loreEntries, normalizedQuery]
    );
    const groupedCharacters = useMemo(
      () => groupCharacters(filteredCharacters),
      [filteredCharacters]
    );
    const showCharactersSection = shouldShowCharactersSection(
      normalizedQuery,
      filteredCharacters.length
    );
    const showLoreSection = shouldShowLoreSection(normalizedQuery, filteredLoreEntries.length);
    const filteredGrowthSheets = useMemo(
      () => filterGrowthSheets(growthIndex?.sheets ?? EMPTY_GROWTH_SHEETS, normalizedQuery),
      [growthIndex, normalizedQuery]
    );
    const showGrowthSection =
      Boolean(onOpenGrowth) &&
      shouldShowGrowthSection(normalizedQuery, filteredGrowthSheets.length);

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
              {showSearch && (
                <SearchBar
                  inputRef={searchInputRef}
                  value={searchQuery}
                  onChange={setSearchQuery}
                  onDismiss={closeSearch}
                />
              )}
              <div className={styles.workspaceSection}>
                <WorkspaceHeader
                  workspaceLabel={workspaceLabel}
                  isWorkspaceBusy={isWorkspaceBusy}
                  isLoading={isLoading}
                  hasFolder={Boolean(folderPath)}
                  showSearch={showSearch}
                  quickOpenShortcut={quickOpenShortcut}
                  createMenuItems={createMenuItems}
                  createMenuOpen={createMenuOpen}
                  onCreateMenuOpenChange={setCreateMenuOpen}
                  onRenameProject={onRenameProject}
                  identityExtra={
                    <ProjectDocsButton
                      docs={projectDocNodes}
                      selectedFile={selectedFile}
                      onOpen={handleFileSelectFromSearch}
                      onContextMenu={onContextMenu}
                    />
                  }
                  onOpenFolder={onOpenFolder}
                  onToggleSearch={handleToggleSearch}
                  onCollapse={onCollapse}
                  onRefresh={onRefresh}
                  onContextMenu={(event) => emitObjectContextMenu(event, { kind: 'project-root' })}
                />
                {isProjectMode && workScope && (
                  <WorkSwitcher
                    current={workScope}
                    options={workScopeOptions}
                    chapterCounts={workChapterCounts}
                    onSelect={(path) => onSelectWork?.(path)}
                    onCreate={onCreateWork}
                  />
                )}
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

                  {showCharactersSection && (
                    <section className={styles.objectSection} aria-label="角色">
                      <SectionHeader
                        title="角色"
                        icon={<AiOutlineUser />}
                        count={filteredCharacters.length}
                        active={activeWorkspaceTab === WORKSPACE_TAB_CHARACTERS}
                        singleClickOnly
                        onToggle={() => toggleSection('characters')}
                        onContextMenu={(event) =>
                          emitObjectContextMenu(event, { kind: 'characters-root' })
                        }
                      />
                      {characterGenerationStatus && (
                        <CharacterGenerationHint status={characterGenerationStatus} />
                      )}
                      {!collapsedSections.characters && (
                        <div className={styles.supportNodeChildren}>
                          {filteredCharacters.length === 0 ? (
                            <div className={styles.objectEmpty}>当前筛选条件下没有人物</div>
                          ) : (
                            groupedCharacters.map((group) => {
                              if (group.items.length === 0) return null;
                              return (
                                <div key={group.key} className={styles.objectSubgroup}>
                                  <div className={styles.objectSubgroupLabel}>
                                    <span>{group.label}</span>
                                    <span className={styles.objectSubgroupCount}>
                                      {group.items.length}
                                    </span>
                                  </div>
                                  {group.items.map((item) => (
                                    <ObjectItemRow
                                      key={item.id}
                                      kindLabel="人物"
                                      title={item.name}
                                      meta={`${getCharacterCategoryLabel(item.category)} · ${item.role || '未填写角色定位'}`}
                                      icon={<AiOutlineUser />}
                                      active={
                                        activeWorkspaceTab === createCharacterWorkspaceTab(item)
                                      }
                                      onOpen={() => onOpenCharacterNode(item.id)}
                                      onRename={(name) => onRenameCharacterNode(item.id, name)}
                                      onDelete={() => onDeleteCharacterNode(item.id)}
                                      onContextMenu={(event) =>
                                        emitObjectContextMenu(event, {
                                          kind: 'character-item',
                                          characterId: item.id,
                                        })
                                      }
                                    />
                                  ))}
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </section>
                  )}

                  {showLoreSection && (
                    <section className={styles.objectSection} aria-label="设定">
                      <SectionHeader
                        title="设定"
                        icon={<AiOutlineFolder />}
                        count={filteredLoreEntries.length}
                        active={activeWorkspaceTab === WORKSPACE_TAB_LORE}
                        singleClickOnly
                        onToggle={() => toggleSection('lore')}
                        onContextMenu={(event) =>
                          emitObjectContextMenu(event, { kind: 'lore-root' })
                        }
                      />
                      {!collapsedSections.lore && (
                        <div className={styles.supportNodeChildren}>
                          {filteredLoreEntries.map((item) => (
                            <ObjectItemRow
                              key={item.id}
                              kindLabel="设定"
                              title={item.title}
                              meta={item.summary || '暂无说明'}
                              icon={<AiOutlineFolder />}
                              active={activeWorkspaceTab === createLoreWorkspaceTab(item)}
                              onOpen={() => onOpenLoreNode(item.id)}
                              onRename={(name) => onRenameLoreNode(item.id, name)}
                              onDelete={() => onDeleteLoreNode(item.id)}
                              onContextMenu={(event) =>
                                emitObjectContextMenu(event, {
                                  kind: 'lore-item',
                                  entryId: item.id,
                                })
                              }
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  )}

                  {showGrowthSection && onOpenGrowth && (
                    <GrowthSection
                      sheets={filteredGrowthSheets}
                      initialized={growthIndex?.initialized ?? false}
                      filtering={normalizedQuery.length > 0}
                      collapsed={collapsedSections.growth}
                      activeWorkspaceTab={activeWorkspaceTab}
                      onToggle={() => toggleSection('growth')}
                      onOpen={onOpenGrowth}
                      onCreate={() => onCreateGrowthSheet?.()}
                      onContextMenu={emitObjectContextMenu}
                    />
                  )}

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
