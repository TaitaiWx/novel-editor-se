import { useCallback, useMemo } from 'react';
import type {
  AssistantContextKind,
  AssistantContextSectionProps,
} from '@/render/components/RightPanel/AssistantContextSection';
import type { AiSessionState } from './state/useAiSessionState';
import type { WorkspaceDerivedState } from './useWorkspaceDerivedState';
import type { ScopedAssistantGenerationApi } from './useScopedAssistantGeneration';
import type { ChapterMaterialsApi } from './useChapterMaterials';
import type { TabActions } from './useTabActions';

export type UseAssistantContextContext = Pick<
  AiSessionState,
  | 'assistantScopedCharacters'
  | 'assistantCharacterGenerationStatus'
  | 'assistantScopedLoreEntries'
  | 'assistantScopedMaterials'
> &
  Pick<WorkspaceDerivedState, 'currentAssistantScope' | 'materialFiles' | 'linkedMaterialFiles'> &
  Pick<
    ScopedAssistantGenerationApi,
    'handleGenerateScopedCharacters' | 'handleGenerateScopedLore' | 'handleGenerateScopedMaterials'
  > &
  Pick<ChapterMaterialsApi, 'handleAddChapterMaterial' | 'handleRemoveChapterMaterial'> &
  Pick<TabActions, 'openFileInTab'>;

/**
 * AI 助手「上下文」分区的数据与动作：当前作用域的人物 / 设定 / 资料上下文，
 * 生成动作复用右键菜单的作用域生成，章节资料关联复用 useChapterMaterials。
 */
export function useAssistantContext(ctx: UseAssistantContextContext): AssistantContextSectionProps {
  const {
    assistantScopedCharacters,
    assistantCharacterGenerationStatus,
    assistantScopedLoreEntries,
    assistantScopedMaterials,
    currentAssistantScope,
    materialFiles,
    linkedMaterialFiles,
    handleGenerateScopedCharacters,
    handleGenerateScopedLore,
    handleGenerateScopedMaterials,
    handleAddChapterMaterial,
    handleRemoveChapterMaterial,
    openFileInTab,
  } = ctx;

  const onGenerate = useCallback(
    (kind: AssistantContextKind) => {
      if (!currentAssistantScope) return;
      if (kind === 'characters') void handleGenerateScopedCharacters(currentAssistantScope);
      else if (kind === 'lore') void handleGenerateScopedLore(currentAssistantScope);
      else void handleGenerateScopedMaterials(currentAssistantScope);
    },
    [
      currentAssistantScope,
      handleGenerateScopedCharacters,
      handleGenerateScopedLore,
      handleGenerateScopedMaterials,
    ]
  );

  const materialOptions = useMemo(
    () => materialFiles.map((item) => ({ path: item.path, name: item.name })),
    [materialFiles]
  );
  const linkedMaterialPaths = useMemo(
    () => linkedMaterialFiles.map((item) => item.path),
    [linkedMaterialFiles]
  );

  return useMemo(
    () => ({
      scope: currentAssistantScope,
      characters: assistantScopedCharacters,
      loreEntries: assistantScopedLoreEntries,
      materials: assistantScopedMaterials,
      characterGenerationStatus: assistantCharacterGenerationStatus,
      materialFiles: materialOptions,
      linkedMaterialPaths,
      onGenerate,
      onOpenMaterial: openFileInTab,
      onAddMaterial: handleAddChapterMaterial,
      onRemoveMaterial: handleRemoveChapterMaterial,
    }),
    [
      currentAssistantScope,
      assistantScopedCharacters,
      assistantScopedLoreEntries,
      assistantScopedMaterials,
      assistantCharacterGenerationStatus,
      materialOptions,
      linkedMaterialPaths,
      onGenerate,
      openFileInTab,
      handleAddChapterMaterial,
      handleRemoveChapterMaterial,
    ]
  );
}
