import { useMemo } from 'react';
import { isStoryFilePath } from '@/render/utils/workspace';
import type { WorkspaceEntityActions } from './useWorkspaceEntityActions';
import type { WorkspaceState } from './state/useWorkspaceState';
import type { EntitiesState } from './state/useEntitiesState';
import type { UiState } from './state/useUiState';
import type { FileOperations } from './useFileOperations';
import type { WorkspaceCreationApi } from './useWorkspaceCreation';
import type { LibraryGenerationApi } from './useLibraryGeneration';
import type { ScopedAssistantGenerationApi } from './useScopedAssistantGeneration';
import type { ProjectExportApi } from './useProjectExport';
import type { ProjectLoaderApi } from './useProjectLoader';

export type UseContextMenuItemsContext = Pick<
  WorkspaceEntityActions,
  | 'buildChapterAssistantScope'
  | 'buildProjectAssistantScope'
  | 'buildVolumeAssistantScope'
  | 'handleClearCharacters'
  | 'handleClearLoreEntries'
  | 'handleDeleteCharacterNode'
  | 'handleDeleteLoreNode'
  | 'handleOpenCharacterNode'
  | 'handleOpenCharacters'
  | 'handleOpenLore'
  | 'handleOpenLoreNode'
  | 'handleOpenVolumeNode'
  | 'handleRenameProject'
> &
  Pick<WorkspaceState, 'folderPath'> &
  Pick<EntitiesState, 'workspaceCharacters' | 'workspaceLoreEntries'> &
  Pick<UiState, 'contextMenu'> &
  Pick<
    FileOperations,
    | 'handleClearMaterials'
    | 'handleCopyFile'
    | 'handleDeleteDirectory'
    | 'handleDeleteFile'
    | 'handleDeleteVolumeNode'
    | 'handlePasteFiles'
    | 'handleRename'
    | 'handleSplitStoryFile'
  > &
  Pick<
    WorkspaceCreationApi,
    | 'handleCreateCharacter'
    | 'handleCreateDirectory'
    | 'handleCreateFile'
    | 'handleCreateLoreEntry'
    | 'handleCreateMaterialDirectory'
    | 'handleCreateStoryItem'
    | 'handleImportFile'
  > &
  Pick<
    LibraryGenerationApi,
    'handleGenerateCharacters' | 'handleGenerateLoreEntries' | 'handleGenerateMaterials'
  > &
  Pick<
    ScopedAssistantGenerationApi,
    'handleGenerateScopedCharacters' | 'handleGenerateScopedLore' | 'handleGenerateScopedMaterials'
  > &
  Pick<ProjectExportApi, 'handleOpenKnowledgeExportDialog'> &
  Pick<ProjectLoaderApi, 'refreshCurrentFolder'>;

/**
 * 文件树 / 对象 / 背景右键菜单项
 */
export function useContextMenuItems(ctx: UseContextMenuItemsContext) {
  const {
    buildChapterAssistantScope,
    buildProjectAssistantScope,
    buildVolumeAssistantScope,
    contextMenu,
    folderPath,
    handleClearCharacters,
    handleClearLoreEntries,
    handleClearMaterials,
    handleCopyFile,
    handleCreateCharacter,
    handleCreateDirectory,
    handleCreateFile,
    handleCreateLoreEntry,
    handleCreateMaterialDirectory,
    handleCreateStoryItem,
    handleDeleteCharacterNode,
    handleDeleteDirectory,
    handleDeleteFile,
    handleDeleteLoreNode,
    handleDeleteVolumeNode,
    handleGenerateCharacters,
    handleGenerateLoreEntries,
    handleGenerateMaterials,
    handleGenerateScopedCharacters,
    handleGenerateScopedLore,
    handleGenerateScopedMaterials,
    handleImportFile,
    handleOpenCharacterNode,
    handleOpenCharacters,
    handleOpenKnowledgeExportDialog,
    handleOpenLore,
    handleOpenLoreNode,
    handleOpenVolumeNode,
    handlePasteFiles,
    handleRename,
    handleRenameProject,
    handleSplitStoryFile,
    refreshCurrentFolder,
    workspaceCharacters,
    workspaceLoreEntries,
  } = ctx;

  const contextMenuItems = useMemo(() => {
    if (!contextMenu) return [];
    const menuItem = (
      label: string,
      onClick: () => void,
      options?: { danger?: boolean; disabled?: boolean; separator?: boolean }
    ) => ({
      label,
      onClick,
      danger: options?.danger,
      disabled: options?.disabled,
      separator: options?.separator,
    });

    if (contextMenu.target.kind === 'background') {
      const bgPasteDir = folderPath;
      return [
        ...(folderPath ? [menuItem('修改作品名', () => void handleRenameProject())] : []),
        menuItem('', () => {}, { separator: true }),
        menuItem('新建卷', () => void handleCreateStoryItem('volume')),
        menuItem('新建章', () => void handleCreateStoryItem('chapter')),
        menuItem('新建稿夹', () => void handleCreateStoryItem('draft-folder')),
        menuItem('新建稿', () => void handleCreateStoryItem('draft')),
        menuItem('', () => {}, { separator: true }),
        menuItem('新建人物', () => void handleCreateCharacter()),
        menuItem('新建设定', () => void handleCreateLoreEntry()),
        menuItem('导出角色卡、设定与资料', () => void handleOpenKnowledgeExportDialog()),
        menuItem('', () => {}, { separator: true }),
        menuItem('新建资料目录', () => void handleCreateMaterialDirectory()),
        menuItem('导入 Word / Excel 文稿', () => void handleImportFile?.(), {
          disabled: !handleImportFile,
        }),
        menuItem('', () => {}, { separator: true }),
        menuItem('粘贴', () => bgPasteDir && handlePasteFiles(bgPasteDir), {
          disabled: !folderPath,
        }),
        menuItem('', () => {}, { separator: true }),
        menuItem('刷新', refreshCurrentFolder),
      ];
    }

    if (contextMenu.target.kind === 'object') {
      const { target } = contextMenu.target;
      switch (target.kind) {
        case 'project-root': {
          const scope = buildProjectAssistantScope();
          if (!scope) return [];
          return [
            menuItem('修改作品名', () => void handleRenameProject()),
            menuItem('', () => {}, { separator: true }),
            menuItem('AI 生成人物', () => void handleGenerateScopedCharacters(scope)),
            menuItem('AI 生成设定', () => void handleGenerateScopedLore(scope)),
            menuItem('AI 生成资料', () => void handleGenerateScopedMaterials(scope)),
          ];
        }
        case 'story-root':
          return [
            menuItem('新建卷', () => void handleCreateStoryItem('volume')),
            menuItem('新建章', () => void handleCreateStoryItem('chapter')),
            menuItem('新建稿夹', () => void handleCreateStoryItem('draft-folder')),
            menuItem('新建稿', () => void handleCreateStoryItem('draft')),
          ];
        case 'volume-item': {
          const scope = buildVolumeAssistantScope(target.volumePath);
          return [
            menuItem('查看详情', () => handleOpenVolumeNode(target.volumePath)),
            menuItem('', () => {}, { separator: true }),
            menuItem('AI 生成人物', () => void handleGenerateScopedCharacters(scope)),
            menuItem('AI 生成设定', () => void handleGenerateScopedLore(scope)),
            menuItem('AI 生成资料', () => void handleGenerateScopedMaterials(scope)),
            menuItem('', () => {}, { separator: true }),
            menuItem(
              '删除卷',
              () => void handleDeleteVolumeNode(target.volumePath, target.isSynthetic),
              {
                danger: true,
                disabled: target.isSynthetic,
              }
            ),
          ];
        }
        case 'characters-root':
          return [
            menuItem('查看详情', handleOpenCharacters),
            menuItem('', () => {}, { separator: true }),
            menuItem('新建人物', () => void handleCreateCharacter()),
            menuItem('导出角色卡、设定与资料', () => void handleOpenKnowledgeExportDialog()),
            menuItem('清空人物', () => void handleClearCharacters(), { danger: true }),
          ];
        case 'lore-root':
          return [
            menuItem('查看详情', handleOpenLore),
            menuItem('', () => {}, { separator: true }),
            menuItem('新建设定', () => void handleCreateLoreEntry()),
            menuItem('导出角色卡、设定与资料', () => void handleOpenKnowledgeExportDialog()),
            menuItem('清空设定', () => void handleClearLoreEntries(), { danger: true }),
          ];
        case 'materials-root':
          return [
            menuItem('新建资料目录', () => void handleCreateMaterialDirectory()),
            menuItem('导入 Word / Excel 文稿', () => void handleImportFile?.(), {
              disabled: !handleImportFile,
            }),
            menuItem('', () => {}, { separator: true }),
            menuItem('刷新资料', refreshCurrentFolder),
            menuItem('清空资料', () => void handleClearMaterials(), { danger: true }),
          ];
        case 'character-item': {
          const targetCharacter = workspaceCharacters.find(
            (item) => item.id === target.characterId
          );
          if (!targetCharacter) return [];
          return [
            menuItem('查看详情', () => handleOpenCharacterNode(target.characterId)),
            menuItem('', () => {}, { separator: true }),
            menuItem('删除人物', () => void handleDeleteCharacterNode(target.characterId), {
              danger: true,
            }),
          ];
        }
        case 'lore-item': {
          const targetEntry = workspaceLoreEntries.find((item) => item.id === target.entryId);
          if (!targetEntry) return [];
          return [
            menuItem('查看详情', () => handleOpenLoreNode(target.entryId)),
            menuItem('', () => {}, { separator: true }),
            menuItem('删除设定', () => void handleDeleteLoreNode(target.entryId), {
              danger: true,
            }),
          ];
        }
        default:
          return [];
      }
    }

    const node = contextMenu.target.node;
    const pasteTargetDir =
      node.type === 'directory' ? node.path : node.path.substring(0, node.path.lastIndexOf('/'));
    const items = [
      menuItem('重命名', () => void handleRename(node.path)),
      menuItem('', () => {}, { separator: true }),
      menuItem('复制', () => handleCopyFile(node.path)),
      menuItem('粘贴', () => handlePasteFiles(pasteTargetDir)),
      menuItem('', () => {}, { separator: true }),
      ...(node.type === 'file' && isStoryFilePath(node.path)
        ? [
            menuItem(
              'AI 生成人物',
              () => void handleGenerateScopedCharacters(buildChapterAssistantScope(node.path))
            ),
            menuItem(
              'AI 生成设定',
              () => void handleGenerateScopedLore(buildChapterAssistantScope(node.path))
            ),
            menuItem(
              'AI 生成资料',
              () => void handleGenerateScopedMaterials(buildChapterAssistantScope(node.path))
            ),
            menuItem('', () => {}, { separator: true }),
          ]
        : []),
      ...(node.type === 'file' && isStoryFilePath(node.path)
        ? [menuItem('按章节拆分', () => void handleSplitStoryFile(node.path))]
        : []),
      ...(node.type === 'file' && isStoryFilePath(node.path)
        ? [menuItem('', () => {}, { separator: true })]
        : []),
    ];
    if (node.type === 'file') {
      items.push(menuItem('删除文件', () => handleDeleteFile(node.path), { danger: true }));
    } else {
      items.push(menuItem('删除文件夹', () => handleDeleteDirectory(node.path), { danger: true }));
    }
    return items;
  }, [
    contextMenu,
    buildChapterAssistantScope,
    buildProjectAssistantScope,
    buildVolumeAssistantScope,
    folderPath,
    handleClearCharacters,
    handleClearLoreEntries,
    handleClearMaterials,
    handleCopyFile,
    handleCreateCharacter,
    handleCreateDirectory,
    handleCreateFile,
    handleCreateLoreEntry,
    handleCreateMaterialDirectory,
    handleCreateStoryItem,
    handleDeleteCharacterNode,
    handleDeleteDirectory,
    handleDeleteFile,
    handleDeleteLoreNode,
    handleDeleteVolumeNode,
    handleOpenKnowledgeExportDialog,
    handleGenerateCharacters,
    handleGenerateLoreEntries,
    handleGenerateMaterials,
    handleGenerateScopedCharacters,
    handleGenerateScopedLore,
    handleGenerateScopedMaterials,
    handleImportFile,
    handleOpenCharacterNode,
    handleOpenCharacters,
    handleOpenLore,
    handleOpenLoreNode,
    handleOpenVolumeNode,
    handlePasteFiles,
    handleRenameProject,
    handleRename,
    handleSplitStoryFile,
    refreshCurrentFolder,
    workspaceCharacters,
    workspaceLoreEntries,
  ]);

  return {
    contextMenuItems,
  };
}

export type ContextMenuItemsApi = ReturnType<typeof useContextMenuItems>;
